import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { CreditsService } from "../credits/credits.service";
import { PrismaService } from "../database/prisma.service";
import {
  MESSAGE_REPLY_PROVIDER,
  MessageReplyError,
  MessageReplyProvider,
} from "./message-reply.provider";
import { MessagesService } from "./messages.service";

type WorkerEnv = Record<string, string | undefined>;

export type MessageReplyWorkerOptions = {
  pollIntervalMs: number;
  concurrency: number;
  maxAttempts: number;
  deadlineMs: number;
  leaseMs: number;
  retryBackoffMs: number;
  enabled: boolean;
};

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const MESSAGE_REPLY_WORKER_OPTIONS = Symbol(
  "MESSAGE_REPLY_WORKER_OPTIONS",
);

export function messageReplyWorkerOptions(
  env: WorkerEnv = process.env,
): MessageReplyWorkerOptions {
  return {
    pollIntervalMs: positiveNumber(env.MESSAGE_REPLY_POLL_INTERVAL_MS, 1_000),
    concurrency: positiveNumber(env.MESSAGE_REPLY_CONCURRENCY, 4),
    maxAttempts: positiveNumber(env.MESSAGE_REPLY_MAX_ATTEMPTS, 3),
    deadlineMs: positiveNumber(env.MESSAGE_REPLY_DEADLINE_MS, 15 * 60_000),
    // Agent 호출 자체가 기본 5분까지 걸리므로 lease는 그보다 넉넉해야 한다.
    // 짧으면 아직 살아서 생성 중인 작업을 다른 tick이 뺏어 이중 호출이 된다.
    leaseMs: positiveNumber(env.MESSAGE_REPLY_LEASE_MS, 6 * 60_000),
    retryBackoffMs: positiveNumber(env.MESSAGE_REPLY_RETRY_BACKOFF_MS, 5_000),
    enabled: env.MESSAGE_REPLY_WORKER_ENABLED !== "false",
  };
}

type ClaimedJob = {
  id: string;
  conversationId: string;
  turnId: string;
  attemptCount: number;
  deadlineAt: Date;
  reservationReference: string | null;
};

/**
 * 저장된 답변 작업을 집어 opod-agent를 호출하고 결과를 확정하는 워커.
 *
 * 주기 tick이 필요한 이유는 두 가지다. 재시도는 `readyAt`이 미래인 작업을 만들고,
 * 프로세스가 죽으면 메모리에 있던 신호가 사라져 `queued` 작업과 만료된 lease를
 * 아무도 집지 않는다. 작업을 DB에 영속화한 의미가 거기에 있다.
 */
@Injectable()
export class MessageReplyWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageReplyWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
    private readonly creditsService: CreditsService,
    @Inject(MESSAGE_REPLY_PROVIDER)
    private readonly replyProvider: MessageReplyProvider,
    @Inject(MESSAGE_REPLY_WORKER_OPTIONS)
    private readonly options: MessageReplyWorkerOptions,
  ) {}

  onModuleInit() {
    if (!this.options.enabled) {
      return;
    }
    this.scheduleNextTick();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 준비된 작업을 한 번 처리한다. 처리한 작업 수를 돌려준다.
   *
   * 테스트는 자동 tick을 끄고 이 메서드를 직접 부른다 — 타이머에 기대면 무엇을
   * 기다리는지가 흐려진다.
   */
  async runOnce(): Promise<number> {
    const claimable = await this.findClaimable();
    const claimed: ClaimedJob[] = [];

    for (const candidate of claimable) {
      const job = await this.claim(candidate.id, candidate.conversationId);
      if (job) {
        claimed.push(job);
      }
    }

    await Promise.allSettled(claimed.map((job) => this.process(job)));
    return claimed.length;
  }

  /**
   * 대화마다 가장 먼저 준비된 작업 하나만 후보로 올린다. 같은 대화의 두 번째
   * 작업을 같은 tick에서 집으면 답변 순서가 뒤집힌다.
   */
  private async findClaimable(): Promise<
    Array<{ id: string; conversationId: string }>
  > {
    const now = new Date();
    const rows = await this.prisma.messageReplyJob.findMany({
      where: {
        OR: [
          { status: "queued", readyAt: { lte: now } },
          // lease가 끊긴 running = 처리하던 프로세스가 죽었다는 뜻.
          { status: "running", leaseExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ readyAt: "asc" }, { id: "asc" }],
      take: this.options.concurrency * 4,
      select: { id: true, conversationId: true },
    });

    const firstPerConversation = new Map<
      string,
      { id: string; conversationId: string }
    >();
    for (const row of rows) {
      if (!firstPerConversation.has(row.conversationId)) {
        firstPerConversation.set(row.conversationId, row);
      }
    }
    return [...firstPerConversation.values()].slice(
      0,
      this.options.concurrency,
    );
  }

  /**
   * 대화 단위 advisory lock 안에서 선점한다. 여러 인스턴스가 같은 대화의 작업을
   * 동시에 집는 것을 막는 지점이라, 상태 재확인도 이 락 안에서 한다.
   */
  private async claim(
    jobId: string,
    conversationId: string,
  ): Promise<ClaimedJob | null> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`message_reply:${conversationId}`}, 0)) AS locked
      `;
      if (!lock?.locked) {
        return null;
      }

      const now = new Date();
      const job = await tx.messageReplyJob.findUnique({ where: { id: jobId } });
      if (!job) {
        return null;
      }
      const ready =
        (job.status === "queued" && job.readyAt <= now) ||
        (job.status === "running" &&
          job.leaseExpiresAt !== null &&
          job.leaseExpiresAt <= now);
      if (!ready) {
        return null;
      }

      // 같은 대화에서 아직 살아 있는 작업이 있으면 직렬 원칙을 지켜 넘어간다.
      const running = await tx.messageReplyJob.count({
        where: {
          conversationId,
          status: "running",
          leaseExpiresAt: { gt: now },
          id: { not: jobId },
        },
      });
      if (running > 0) {
        return null;
      }

      // 처음 실제로 처리에 들어간 시각이 15분 기한의 기준이다. 큐에서 기다린
      // 시간은 사용자 탓이 아니므로 포함하지 않는다.
      const startedAt = job.startedAt ?? now;
      const deadlineAt =
        job.deadlineAt ?? new Date(now.getTime() + this.options.deadlineMs);

      const claimed = await tx.messageReplyJob.update({
        where: { id: jobId },
        data: {
          status: "running",
          attemptCount: { increment: 1 },
          leaseExpiresAt: new Date(now.getTime() + this.options.leaseMs),
          startedAt,
          deadlineAt,
        },
      });

      return {
        id: claimed.id,
        conversationId: claimed.conversationId,
        turnId: claimed.turnId,
        attemptCount: claimed.attemptCount,
        deadlineAt,
        reservationReference: claimed.reservationReference,
      };
    });
  }

  private async process(job: ClaimedJob): Promise<void> {
    if (job.deadlineAt <= new Date()) {
      await this.finalizeFailure(job, "deadline_exceeded");
      return;
    }

    try {
      const context = await this.replyContext(job);
      const reply = await this.replyProvider.createReply(context);
      await this.complete(job, reply);
    } catch (error) {
      await this.handleFailure(job, error);
    }
  }

  /**
   * Agent 문맥은 이 작업의 사용자 메시지 시각까지만 담는다. 뒤에 도착해 대기 중인
   * 메시지를 넣으면 아직 답하지 않은 말에 이미 답한 것처럼 보인다.
   */
  private async replyContext(job: ClaimedJob) {
    const turn = await this.prisma.message.findUniqueOrThrow({
      where: { id: job.turnId },
      include: {
        conversation: { select: { userId: true, characterId: true } },
      },
    });
    const history = await this.prisma.message.findMany({
      where: {
        conversationId: job.conversationId,
        OR: [
          { createdAt: { lt: turn.createdAt } },
          { createdAt: turn.createdAt, id: { lte: turn.id } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return {
      userId: turn.conversation.userId,
      characterId: turn.conversation.characterId,
      conversationId: job.conversationId,
      turnId: job.turnId,
      messages: history.map((message) => ({
        role:
          message.senderType === "user"
            ? ("user" as const)
            : ("assistant" as const),
        content: message.body,
      })),
    };
  }

  /**
   * 답변 저장, 크레딧 캡처, 작업 완료를 한 트랜잭션에 묶는다. 답변만 남고 캡처가
   * 빠지면 공짜 답변이 되고, 반대면 돈만 받고 답이 없다.
   */
  private async complete(job: ClaimedJob, reply: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // running일 때만 닫는다. lease를 뺏긴 뒤 뒤늦게 돌아온 시도가 답변을 한 번
      // 더 붙이는 것을 막는다.
      const closed = await tx.messageReplyJob.updateMany({
        where: { id: job.id, status: "running" },
        data: {
          status: "completed",
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      if (closed.count === 0) {
        return;
      }

      await this.messagesService.appendMessageWithClient(tx, {
        conversationId: job.conversationId,
        senderType: "character",
        body: reply,
        replyJobId: job.id,
      });

      if (job.reservationReference) {
        await this.creditsService.captureReservationWithClient(tx, {
          reference: job.reservationReference,
        });
      }
    });
  }

  private async handleFailure(job: ClaimedJob, error: unknown): Promise<void> {
    const retryable =
      error instanceof MessageReplyError ? error.retryable : false;
    const reason =
      error instanceof MessageReplyError
        ? error.reason
        : error instanceof Error
          ? error.name
          : "unknown";

    const exhausted = job.attemptCount >= this.options.maxAttempts;
    const expired = job.deadlineAt <= new Date();

    if (!retryable || exhausted || expired) {
      await this.finalizeFailure(
        job,
        expired && retryable && !exhausted ? "deadline_exceeded" : reason,
      );
      return;
    }

    await this.prisma.messageReplyJob.updateMany({
      where: { id: job.id, status: "running" },
      data: {
        status: "queued",
        readyAt: new Date(Date.now() + this.options.retryBackoffMs),
        leaseExpiresAt: null,
        failureReason: reason,
      },
    });
  }

  /**
   * 사용자 메시지는 남기고 작업만 닫는다. 예약 해제를 같은 트랜잭션에 넣어야
   * 작업은 실패인데 크레딧은 잠긴 상태가 생기지 않는다.
   */
  private async finalizeFailure(
    job: ClaimedJob,
    reason: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const closed = await tx.messageReplyJob.updateMany({
          where: { id: job.id, status: "running" },
          data: {
            status: "failed",
            failedAt: new Date(),
            failureReason: reason,
            leaseExpiresAt: null,
          },
        });
        if (closed.count === 0) {
          return;
        }
        if (job.reservationReference) {
          await this.creditsService.releaseReservationWithClient(tx, {
            reference: job.reservationReference,
          });
        }
      });
    } finally {
      await this.messagesService.logFailure(new Error(reason), {
        jobId: job.id,
        conversationId: job.conversationId,
        turnId: job.turnId,
        attemptCount: job.attemptCount,
      });
    }
  }

  private scheduleNextTick() {
    if (this.stopped) {
      return;
    }
    // setInterval이 아니라 재귀 setTimeout인 이유: tick이 느려도 다음 tick이
    // 겹쳐 쌓이지 않는다.
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((error: unknown) => {
          this.logger.error(
            `message reply worker tick failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        })
        .finally(() => this.scheduleNextTick());
    }, this.options.pollIntervalMs);
    this.timer.unref?.();
  }
}
