import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";
import {
  MESSAGE_REPLY_PROVIDER,
  MessageReplyError,
} from "../src/domain/messages/message-reply.provider";
import { MessageReplyWorker } from "../src/domain/messages/message-reply.worker";
import { registerHuman } from "./human-auth";

describe("asynchronous DM replies", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: MessageReplyWorker;
  const createReply = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGE_REPLY_PROVIDER)
      .useValue({ createReply })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    worker = app.get(MessageReplyWorker);
  });

  afterAll(() => app.close());

  beforeEach(() => {
    createReply.mockReset();
    createReply.mockResolvedValue("Test reply");
  });

  async function character() {
    return prisma.character.create({
      data: {
        publicId: `soi-${randomUUID()}`,
        displayName: "소이",
        bio: "film photos",
      },
    });
  }

  async function send(
    authHeaders: Record<string, string>,
    characterId: string,
    body: string,
  ) {
    const response = await request(app.getHttpServer())
      .post("/messages")
      .set(authHeaders)
      .send({ characterId, body })
      .expect(201);
    return response.body as {
      conversationId: string;
      messages: Array<{ id: string; turnId: string; replyStatus: string }>;
    };
  }

  async function messagesFor(
    authHeaders: Record<string, string>,
    characterId: string,
  ) {
    const response = await request(app.getHttpServer())
      .get("/messages")
      .query({ characterId })
      .set(authHeaders)
      .expect(200);
    return response.body.items as Array<{
      senderType: string;
      body: string;
      turnId?: string;
      replyStatus?: string;
    }>;
  }

  async function unreadCountFor(authHeaders: Record<string, string>) {
    const response = await request(app.getHttpServer())
      .get("/messages/conversations")
      .set(authHeaders)
      .expect(200);
    return response.body.items[0].unreadCount as number;
  }

  it("returns the user message before the reply exists, then fills it in", async () => {
    const human = await registerHuman(app);
    const target = await character();

    const sent = await send(human.authHeaders, target.id, "안녕");

    // POST가 답변을 기다리면 요청 하나가 생성 시간 전체를 붙든다.
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0]).toMatchObject({ replyStatus: "pending" });
    expect(createReply).not.toHaveBeenCalled();
    await expect(messagesFor(human.authHeaders, target.id)).resolves.toEqual([
      expect.objectContaining({ senderType: "user", replyStatus: "pending" }),
    ]);

    await worker.runOnce();

    // 앱은 cursor 조회로 답변을 발견한다.
    await expect(messagesFor(human.authHeaders, target.id)).resolves.toEqual([
      expect.objectContaining({ senderType: "user", replyStatus: "completed" }),
      expect.objectContaining({
        senderType: "character",
        body: "Test reply",
        replyStatus: "completed",
      }),
    ]);
    await expect(unreadCountFor(human.authHeaders)).resolves.toBe(1);
  });

  it("charges one credit usage per turn, once", async () => {
    const human = await registerHuman(app);
    const target = await character();

    await send(human.authHeaders, target.id, "안녕");
    await worker.runOnce();
    // 이미 끝난 작업을 다시 집으면 답변과 차감이 한 번 더 일어난다.
    await worker.runOnce();

    await expect(
      prisma.creditLedger.count({
        where: { userId: human.user.id, type: "usage", reason: "chat_reply" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.message.count({
        where: {
          senderType: "character",
          conversation: { userId: human.user.id },
        },
      }),
    ).resolves.toBe(1);
  });

  it("answers a conversation's turns in order, one at a time", async () => {
    const human = await registerHuman(app);
    const target = await character();

    const first = await send(human.authHeaders, target.id, "첫 번째");
    const second = await send(human.authHeaders, target.id, "두 번째");

    // 한 tick에 같은 대화의 작업을 둘 다 집으면 답변 순서가 뒤집힌다.
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(createReply).toHaveBeenCalledTimes(1);
    // 대기 중인 두 번째 메시지는 첫 번째 턴의 문맥에 들어가면 안 된다.
    expect(
      createReply.mock.calls[0][0].messages.map(
        (message: { content: string }) => message.content,
      ),
    ).toEqual(["첫 번째"]);

    await expect(worker.runOnce()).resolves.toBe(1);

    // 답변이 늦게 오므로 전사는 [질문1, 질문2, 답변1, 답변2] 순이 된다. 어느
    // 답변이 어느 질문의 것인지는 순서가 아니라 turnId가 말해준다.
    const transcript = await messagesFor(human.authHeaders, target.id);
    expect(
      transcript.map((message) => [message.senderType, message.turnId]),
    ).toEqual([
      ["user", first.messages[0].turnId],
      ["user", second.messages[0].turnId],
      ["character", first.messages[0].turnId],
      ["character", second.messages[0].turnId],
    ]);
  });

  it("keeps the user message and releases credits when a turn fails for good", async () => {
    const human = await registerHuman(app);
    const target = await character();
    createReply.mockRejectedValue(new MessageReplyError("http_400", false));

    const sent = await send(human.authHeaders, target.id, "안녕");
    await worker.runOnce();

    await expect(messagesFor(human.authHeaders, target.id)).resolves.toEqual([
      expect.objectContaining({ senderType: "user", replyStatus: "failed" }),
    ]);
    // 실패해도 유저가 쓴 말은 사라지지 않는다.
    await expect(
      prisma.creditReservation.findFirst({
        where: { userId: human.user.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "released" });
    await expect(
      prisma.creditLedger.count({
        where: { userId: human.user.id, type: "usage" },
      }),
    ).resolves.toBe(0);

    // 재시도는 새 예약으로 다시 큐에 넣는다.
    createReply.mockResolvedValue("다시 안녕");
    await request(app.getHttpServer())
      .post("/messages/retry")
      .set(human.authHeaders)
      .send({ turnId: sent.messages[0].turnId })
      .expect(202)
      .expect((response) => {
        expect(response.body).toEqual({
          turnId: sent.messages[0].turnId,
          replyStatus: "pending",
        });
      });

    await worker.runOnce();
    await expect(messagesFor(human.authHeaders, target.id)).resolves.toEqual([
      expect.objectContaining({ senderType: "user", replyStatus: "completed" }),
      expect.objectContaining({ body: "다시 안녕" }),
    ]);
    await expect(
      prisma.creditLedger.count({
        where: { userId: human.user.id, type: "usage", reason: "chat_reply" },
      }),
    ).resolves.toBe(1);
  });

  it("retries a transient failure and stops at the attempt cap", async () => {
    const human = await registerHuman(app);
    const target = await character();
    createReply.mockRejectedValue(new MessageReplyError("timeout", true));

    const sent = await send(human.authHeaders, target.id, "안녕");
    const jobId = { turnId: sent.messages[0].turnId };

    // 백오프 때문에 다음 tick이 바로 집지 않는다. 준비 시각을 당겨 재시도를 몬다.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await prisma.messageReplyJob.updateMany({
        where: jobId,
        data: { readyAt: new Date() },
      });
      await worker.runOnce();
    }

    const job = await prisma.messageReplyJob.findUniqueOrThrow({
      where: jobId,
    });
    // 무한 재시도는 크레딧을 잡아둔 채 Agent만 계속 부른다.
    expect(job).toMatchObject({ status: "failed", attemptCount: 3 });
    expect(createReply).toHaveBeenCalledTimes(3);

    // 소진된 작업은 다음 tick이 다시 집지 않는다.
    await expect(worker.runOnce()).resolves.toBe(0);
  });

  it("refuses a retry that is not the user's failed turn", async () => {
    const human = await registerHuman(app);
    const other = await registerHuman(app);
    const target = await character();

    const sent = await send(human.authHeaders, target.id, "안녕");

    // 남의 대화는 존재 자체를 알리지 않는다.
    await request(app.getHttpServer())
      .post("/messages/retry")
      .set(other.authHeaders)
      .send({ turnId: sent.messages[0].turnId })
      .expect(404);

    // 아직 처리 중인 턴은 다시 넣을 수 없다.
    await request(app.getHttpServer())
      .post("/messages/retry")
      .set(human.authHeaders)
      .send({ turnId: sent.messages[0].turnId })
      .expect(409);

    await worker.runOnce();

    // 성공한 턴도 마찬가지다.
    await request(app.getHttpServer())
      .post("/messages/retry")
      .set(human.authHeaders)
      .send({ turnId: sent.messages[0].turnId })
      .expect(409);
  });

  it("requires authentication to retry", async () => {
    await request(app.getHttpServer())
      .post("/messages/retry")
      .send({ turnId: randomUUID() })
      .expect(401);
  });
});

describe("message read receipts", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: MessageReplyWorker;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGE_REPLY_PROVIDER)
      .useValue({ createReply: jest.fn().mockResolvedValue("Test reply") })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    worker = app.get(MessageReplyWorker);
  });

  afterAll(() => app.close());

  async function character() {
    return prisma.character.create({
      data: {
        publicId: `soi-${randomUUID()}`,
        displayName: "소이",
        bio: "film photos",
      },
    });
  }

  async function unreadCountFor(authHeaders: Record<string, string>) {
    const response = await request(app.getHttpServer())
      .get("/messages/conversations")
      .set(authHeaders)
      .expect(200);
    return response.body.items[0].unreadCount as number;
  }

  async function sendAndAnswer(
    authHeaders: Record<string, string>,
    characterId: string,
    body: string,
  ) {
    await request(app.getHttpServer())
      .post("/messages")
      .set(authHeaders)
      .send({ characterId, body })
      .expect(201);
    await worker.runOnce();
  }

  it("counts only character replies and clears them on an explicit read", async () => {
    const human = await registerHuman(app);
    const target = await character();

    await sendAndAnswer(human.authHeaders, target.id, "안녕");

    // 유저가 보낸 메시지까지 세면 대화를 시작하는 순간 배지가 붙는다.
    // 답장 1건만 미읽음이어야 한다.
    await expect(unreadCountFor(human.authHeaders)).resolves.toBe(1);

    await request(app.getHttpServer())
      .post("/messages/read")
      .set(human.authHeaders)
      .send({ characterId: target.id })
      .expect(201)
      .expect((response) => {
        expect(response.body).toEqual({
          conversationId: expect.any(String),
          lastReadAt: expect.any(String),
        });
      });

    await expect(unreadCountFor(human.authHeaders)).resolves.toBe(0);

    // 읽은 뒤 도착한 답장은 다시 미읽음이다. 워터마크를 갱신하지 않으면
    // 이 단언이 0으로 깨진다.
    await sendAndAnswer(human.authHeaders, target.id, "잘 지내?");

    await expect(unreadCountFor(human.authHeaders)).resolves.toBe(1);
  });

  it("orders conversations by last activity, not by when they started", async () => {
    const human = await registerHuman(app);
    const older = await character();
    const newer = await character();

    async function orderedCharacterIds() {
      const response = await request(app.getHttpServer())
        .get("/messages/conversations")
        .set(human.authHeaders)
        .expect(200);
      return response.body.items.map(
        (item: { character: { id: string } }) => item.character.id,
      );
    }

    await sendAndAnswer(human.authHeaders, older.id, "먼저 시작한 대화");
    await sendAndAnswer(human.authHeaders, newer.id, "나중에 시작한 대화");
    await expect(orderedCharacterIds()).resolves.toEqual([newer.id, older.id]);

    // 먼저 시작한 대화에 새 메시지가 오면 최상단으로 올라와야 한다. 정렬 키가
    // 대화 생성 시각이거나 lastMessageAt을 갱신하지 않으면 순서가 그대로다.
    await sendAndAnswer(human.authHeaders, older.id, "오래된 대화에 새 메시지");
    await expect(orderedCharacterIds()).resolves.toEqual([older.id, newer.id]);
  });

  it("rejects a read for a conversation the user has not started", async () => {
    const human = await registerHuman(app);
    const target = await character();

    await request(app.getHttpServer())
      .post("/messages/read")
      .set(human.authHeaders)
      .send({ characterId: target.id })
      .expect(404);
  });
});
