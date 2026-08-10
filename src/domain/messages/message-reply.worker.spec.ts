import { MessageReplyError } from "./message-reply.provider";
import {
  MessageReplyWorker,
  MessageReplyWorkerOptions,
  messageReplyWorkerOptions,
} from "./message-reply.worker";

type WorkerCtor = new (
  prisma: unknown,
  messagesService: unknown,
  creditsService: unknown,
  replyProvider: unknown,
  options: MessageReplyWorkerOptions,
) => MessageReplyWorker;

const turnCreatedAt = new Date("2026-06-30T00:00:00.000Z");
const farFuture = new Date("2099-01-01T00:00:00.000Z");

type JobRow = {
  id: string;
  conversationId: string;
  turnId: string;
  status: "queued" | "running" | "completed" | "failed";
  attemptCount: number;
  readyAt: Date;
  leaseExpiresAt: Date | null;
  startedAt: Date | null;
  deadlineAt: Date | null;
  reservationReference: string | null;
};

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    conversationId: "conversation-1",
    turnId: "message-human",
    status: "queued",
    attemptCount: 0,
    readyAt: new Date("2026-06-30T00:00:00.000Z"),
    leaseExpiresAt: null,
    startedAt: null,
    deadlineAt: null,
    reservationReference: "chat_reply:test",
    ...overrides,
  };
}

function createHarness(options: {
  jobs?: JobRow[];
  history?: Array<{
    id: string;
    senderType: "user" | "character";
    body: string;
  }>;
  reply?: jest.Mock;
  runningSiblings?: number;
  worker?: Partial<MessageReplyWorkerOptions>;
}) {
  const jobs = options.jobs ?? [job()];
  const claimUpdate = jest.fn(
    async ({ where, data }: { where: { id: string }; data: JobRow }) => {
      const found = jobs.find((row) => row.id === where.id)!;
      return {
        ...found,
        ...data,
        attemptCount: found.attemptCount + 1,
      };
    },
  );
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: Record<string, any> = {
    messageReplyJob: {
      findMany: jest.fn().mockResolvedValue(
        jobs.map((row) => ({
          id: row.id,
          conversationId: row.conversationId,
        })),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        jobs.find((row) => row.id === where.id),
      ),
      count: jest.fn().mockResolvedValue(options.runningSiblings ?? 0),
      update: claimUpdate,
      updateMany,
    },
    message: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: "message-human",
        createdAt: turnCreatedAt,
        conversation: { userId: "human-1", characterId: "ai-1" },
      }),
      findMany: jest
        .fn()
        .mockResolvedValue(
          options.history ?? [
            { id: "message-human", senderType: "user", body: "hello" },
          ],
        ),
    },
    // advisory lock은 항상 잡히는 것으로 둔다. 락 경합 자체는 e2e가 본다.
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: jest.fn((run: (tx: any) => unknown) => run(prisma)),
  };

  const messagesService = {
    appendMessageWithClient: jest.fn().mockResolvedValue({ id: "message-ai" }),
    logFailure: jest.fn().mockResolvedValue(undefined),
  };
  const creditsService = {
    captureReservationWithClient: jest.fn().mockResolvedValue(undefined),
    releaseReservationWithClient: jest.fn().mockResolvedValue(undefined),
  };
  const replyProvider = {
    createReply:
      options.reply ?? jest.fn().mockResolvedValue("provider says hi"),
  };

  const worker = new (MessageReplyWorker as unknown as WorkerCtor)(
    prisma,
    messagesService,
    creditsService,
    replyProvider,
    { ...messageReplyWorkerOptions({}), enabled: false, ...options.worker },
  );

  return { worker, prisma, messagesService, creditsService, replyProvider };
}

describe("MessageReplyWorker", () => {
  it("stores the reply and captures credits as one unit", async () => {
    const harness = createHarness({});

    await expect(harness.worker.runOnce()).resolves.toBe(1);

    expect(
      harness.messagesService.appendMessageWithClient,
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: "conversation-1",
        senderType: "character",
        body: "provider says hi",
        replyJobId: "job-1",
      }),
    );
    // 답변만 남고 캡처가 빠지면 공짜 답변이 된다.
    expect(
      harness.creditsService.captureReservationWithClient,
    ).toHaveBeenCalledWith(expect.anything(), {
      reference: "chat_reply:test",
    });
  });

  it("does not append a second reply when the job is no longer running", async () => {
    const harness = createHarness({});
    // lease를 뺏긴 뒤 뒤늦게 돌아온 시도를 흉내낸다.
    harness.prisma.messageReplyJob.updateMany.mockResolvedValue({ count: 0 });

    await harness.worker.runOnce();

    expect(
      harness.messagesService.appendMessageWithClient,
    ).not.toHaveBeenCalled();
    expect(
      harness.creditsService.captureReservationWithClient,
    ).not.toHaveBeenCalled();
  });

  it("sends only the messages up to the turn being answered", async () => {
    const harness = createHarness({});

    await harness.worker.runOnce();

    // 뒤에 대기 중인 메시지를 문맥에 넣으면 아직 답하지 않은 말에 이미 답한
    // 것처럼 보이고, 그 메시지는 자기 차례에 다시 답을 받는다.
    expect(harness.prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: "conversation-1",
          OR: [
            { createdAt: { lt: turnCreatedAt } },
            { createdAt: turnCreatedAt, id: { lte: "message-human" } },
          ],
        }),
      }),
    );
  });

  it("requeues a retryable failure with a later ready time", async () => {
    const harness = createHarness({
      reply: jest
        .fn()
        .mockRejectedValue(new MessageReplyError("timeout", true)),
    });

    await harness.worker.runOnce();

    const [[requeue]] = harness.prisma.messageReplyJob.updateMany.mock.calls;
    expect(requeue.data).toMatchObject({
      status: "queued",
      failureReason: "timeout",
      leaseExpiresAt: null,
    });
    expect(
      harness.creditsService.releaseReservationWithClient,
    ).not.toHaveBeenCalled();
  });

  it("does not retry a failure that would fail the same way again", async () => {
    const harness = createHarness({
      reply: jest
        .fn()
        .mockRejectedValue(new MessageReplyError("http_400", false)),
    });

    await harness.worker.runOnce();

    const [[closed]] = harness.prisma.messageReplyJob.updateMany.mock.calls;
    expect(closed.data).toMatchObject({
      status: "failed",
      failureReason: "http_400",
    });
    // 실패로 닫으면서 예약을 풀지 않으면 크레딧이 영영 잠긴다.
    expect(
      harness.creditsService.releaseReservationWithClient,
    ).toHaveBeenCalledWith(expect.anything(), { reference: "chat_reply:test" });
  });

  it("gives up after the attempt cap even for retryable failures", async () => {
    const harness = createHarness({
      // claim이 3으로 올려놓는 마지막 시도.
      jobs: [
        job({
          attemptCount: 2,
          startedAt: turnCreatedAt,
          deadlineAt: farFuture,
        }),
      ],
      reply: jest
        .fn()
        .mockRejectedValue(new MessageReplyError("timeout", true)),
      worker: { maxAttempts: 3 },
    });

    await harness.worker.runOnce();

    const [[closed]] = harness.prisma.messageReplyJob.updateMany.mock.calls;
    expect(closed.data).toMatchObject({ status: "failed" });
    expect(
      harness.creditsService.releaseReservationWithClient,
    ).toHaveBeenCalled();
  });

  it("closes a job whose deadline has passed instead of calling the agent", async () => {
    const harness = createHarness({
      jobs: [
        job({
          status: "running",
          leaseExpiresAt: new Date("2026-06-30T00:00:00.000Z"),
          startedAt: turnCreatedAt,
          deadlineAt: new Date("2026-06-30T00:15:00.000Z"),
        }),
      ],
    });

    await harness.worker.runOnce();

    expect(harness.replyProvider.createReply).not.toHaveBeenCalled();
    const [[closed]] = harness.prisma.messageReplyJob.updateMany.mock.calls;
    expect(closed.data).toMatchObject({
      status: "failed",
      failureReason: "deadline_exceeded",
    });
  });

  it("reclaims a job whose worker died mid-generation", async () => {
    const harness = createHarness({
      jobs: [
        job({
          status: "running",
          attemptCount: 1,
          leaseExpiresAt: new Date("2026-06-30T00:00:00.000Z"),
          startedAt: turnCreatedAt,
          deadlineAt: farFuture,
        }),
      ],
    });

    // lease가 끊긴 running을 다시 집지 못하면 그 답변은 영원히 오지 않는다.
    await expect(harness.worker.runOnce()).resolves.toBe(1);
    expect(harness.replyProvider.createReply).toHaveBeenCalled();
  });

  it("skips a conversation that already has a live job", async () => {
    const harness = createHarness({ runningSiblings: 1 });

    await expect(harness.worker.runOnce()).resolves.toBe(0);
    // 같은 대화에서 두 작업이 동시에 돌면 답변 순서가 뒤집힌다.
    expect(harness.replyProvider.createReply).not.toHaveBeenCalled();
  });

  it("claims at most one job per conversation in a tick", async () => {
    const harness = createHarness({
      jobs: [
        job({ id: "job-1" }),
        job({ id: "job-2", turnId: "message-human-2" }),
      ],
    });

    await expect(harness.worker.runOnce()).resolves.toBe(1);
  });
});

describe("messageReplyWorkerOptions", () => {
  it("keeps the lease longer than a full agent generation", () => {
    // lease가 Agent timeout보다 짧으면 아직 생성 중인 작업을 다른 tick이 뺏어
    // 같은 턴을 두 번 호출한다.
    const options = messageReplyWorkerOptions({});
    expect(options.leaseMs).toBeGreaterThan(300_000);
  });

  it.each([
    ["unset", undefined],
    ["not a number", "soon"],
    ["zero", "0"],
    ["negative", "-1"],
  ])("falls back to the default attempt cap when %s", (_label, value) => {
    expect(
      messageReplyWorkerOptions({ MESSAGE_REPLY_MAX_ATTEMPTS: value })
        .maxAttempts,
    ).toBe(3);
  });

  it("can be disabled so a process runs the API without the worker", () => {
    expect(
      messageReplyWorkerOptions({ MESSAGE_REPLY_WORKER_ENABLED: "false" })
        .enabled,
    ).toBe(false);
  });
});
