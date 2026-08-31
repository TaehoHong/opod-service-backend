import { messageReplyJobs, messages } from "../database/schema";
import { MessageReplyError } from "./message-reply.provider";
import {
  MessageReplyWorker,
  MessageReplyWorkerOptions,
  messageReplyWorkerOptions,
} from "./message-reply.worker";

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
    readyAt: turnCreatedAt,
    leaseExpiresAt: null,
    startedAt: null,
    deadlineAt: null,
    reservationReference: "chat_reply:test",
    ...overrides,
  };
}

function dynamicQuery(run: () => unknown | Promise<unknown>) {
  const query: Record<string, unknown> = {};
  for (const method of [
    "from",
    "groupBy",
    "innerJoin",
    "leftJoin",
    "limit",
    "orderBy",
    "returning",
    "set",
    "values",
    "where",
  ]) {
    query[method] = jest.fn(() => query);
  }
  query.then = (
    resolve: (value: unknown) => unknown,
    reject: (error: unknown) => unknown,
  ) => Promise.resolve().then(run).then(resolve, reject);
  return query;
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
  const history = options.history ?? [
    {
      id: "message-human",
      senderType: "user" as const,
      body: "hello",
    },
  ];
  const updateSets: Array<Record<string, unknown>> = [];
  const casUpdate = jest.fn().mockResolvedValue(true);
  const historySelect = jest.fn();
  let selectedTable: unknown;
  let selection: Record<string, unknown> | undefined;
  let claimRead = 0;

  const client: Record<string, unknown> = {
    select: jest.fn((fields?: Record<string, unknown>) => {
      selection = fields;
      return dynamicQuery(async () => {
        if (selectedTable === messageReplyJobs) {
          if (selection?.value)
            return [{ value: options.runningSiblings ?? 0 }];
          if (selection?.conversationId) {
            return jobs.map(({ id, conversationId }) => ({
              id,
              conversationId,
            }));
          }
          return [jobs[Math.min(claimRead++, jobs.length - 1)]];
        }
        if (selectedTable === messages) {
          if (selection?.conversation) {
            return [
              {
                id: "message-human",
                createdAt: turnCreatedAt,
                conversation: { userId: "human-1", characterId: "ai-1" },
              },
            ];
          }
          historySelect();
          return history;
        }
        return [];
      });
    }),
    update: jest.fn(() => {
      let data: Record<string, unknown> = {};
      const query = dynamicQuery(async () => {
        updateSets.push(data);
        if (data.status === "running") {
          const current = jobs[Math.min(claimRead - 1, jobs.length - 1)];
          return [
            {
              ...current,
              ...data,
              attemptCount: current.attemptCount + 1,
            },
          ];
        }
        return (await casUpdate()) ? [{ id: "job-1" }] : [];
      }) as Record<string, jest.Mock>;
      query.set.mockImplementation((value: Record<string, unknown>) => {
        data = value;
        return query;
      });
      return query;
    }),
    execute: jest.fn().mockResolvedValue({ rows: [{ locked: true }] }),
  };
  const originalSelect = client.select as jest.Mock;
  client.select = jest.fn((fields?: Record<string, unknown>) => {
    const query = originalSelect(fields) as Record<string, jest.Mock>;
    query.from.mockImplementation((table: unknown) => {
      selectedTable = table;
      return query;
    });
    return query;
  });
  const transaction = jest.fn((run: (tx: unknown) => unknown) => run(client));
  const database = { client: { ...client, transaction } };

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
  const worker = new MessageReplyWorker(
    database as never,
    messagesService as never,
    creditsService as never,
    replyProvider,
    { ...messageReplyWorkerOptions({}), enabled: false, ...options.worker },
  );
  return {
    worker,
    casUpdate,
    updateSets,
    historySelect,
    messagesService,
    creditsService,
    replyProvider,
  };
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
    expect(
      harness.creditsService.captureReservationWithClient,
    ).toHaveBeenCalledWith(expect.anything(), { reference: "chat_reply:test" });
  });

  it("does not append a second reply when the job is no longer running", async () => {
    const harness = createHarness({});
    harness.casUpdate.mockResolvedValue(false);
    await harness.worker.runOnce();
    expect(
      harness.messagesService.appendMessageWithClient,
    ).not.toHaveBeenCalled();
    expect(
      harness.creditsService.captureReservationWithClient,
    ).not.toHaveBeenCalled();
  });

  it("sends only the messages selected up to the turn being answered", async () => {
    const harness = createHarness({
      history: [
        {
          id: "message-human",
          senderType: "user",
          body: "hello",
        },
      ],
    });
    await harness.worker.runOnce();
    expect(harness.historySelect).toHaveBeenCalledTimes(1);
    expect(harness.replyProvider.createReply).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "hello" }],
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
    expect(harness.updateSets).toContainEqual(
      expect.objectContaining({
        status: "queued",
        failureReason: "timeout",
        leaseExpiresAt: null,
      }),
    );
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
    expect(harness.updateSets).toContainEqual(
      expect.objectContaining({ status: "failed", failureReason: "http_400" }),
    );
    expect(
      harness.creditsService.releaseReservationWithClient,
    ).toHaveBeenCalledWith(expect.anything(), { reference: "chat_reply:test" });
  });

  it("gives up after the attempt cap even for retryable failures", async () => {
    const harness = createHarness({
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
    expect(harness.updateSets).toContainEqual(
      expect.objectContaining({ status: "failed" }),
    );
    expect(
      harness.creditsService.releaseReservationWithClient,
    ).toHaveBeenCalled();
  });

  it("closes a job whose deadline has passed instead of calling the agent", async () => {
    const harness = createHarness({
      jobs: [
        job({
          status: "running",
          leaseExpiresAt: turnCreatedAt,
          startedAt: turnCreatedAt,
          deadlineAt: new Date("2026-06-30T00:15:00.000Z"),
        }),
      ],
    });
    await harness.worker.runOnce();
    expect(harness.replyProvider.createReply).not.toHaveBeenCalled();
    expect(harness.updateSets).toContainEqual(
      expect.objectContaining({
        status: "failed",
        failureReason: "deadline_exceeded",
      }),
    );
  });

  it("reclaims a job whose worker died mid-generation", async () => {
    const harness = createHarness({
      jobs: [
        job({
          status: "running",
          attemptCount: 1,
          leaseExpiresAt: turnCreatedAt,
          startedAt: turnCreatedAt,
          deadlineAt: farFuture,
        }),
      ],
    });
    await expect(harness.worker.runOnce()).resolves.toBe(1);
    expect(harness.replyProvider.createReply).toHaveBeenCalled();
  });

  it("skips a conversation that already has a live job", async () => {
    const harness = createHarness({ runningSiblings: 1 });
    await expect(harness.worker.runOnce()).resolves.toBe(0);
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
    expect(messageReplyWorkerOptions({}).leaseMs).toBeGreaterThan(300_000);
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
