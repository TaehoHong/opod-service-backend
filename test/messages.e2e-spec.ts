import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";
import { MESSAGE_REPLY_PROVIDER } from "../src/domain/messages/message-reply.provider";
import { registerHuman } from "./human-auth";

describe("message read receipts", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGE_REPLY_PROVIDER)
      .useValue({ createReply: jest.fn().mockResolvedValue("Test reply") })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
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

  it("counts only character replies and clears them on an explicit read", async () => {
    const human = await registerHuman(app);
    const target = await character();

    await request(app.getHttpServer())
      .post("/messages")
      .set(human.authHeaders)
      .send({ characterId: target.id, body: "안녕" })
      .expect(201);

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
    await request(app.getHttpServer())
      .post("/messages")
      .set(human.authHeaders)
      .send({ characterId: target.id, body: "잘 지내?" })
      .expect(201);

    await expect(unreadCountFor(human.authHeaders)).resolves.toBe(1);
  });

  it("orders conversations by last activity, not by when they started", async () => {
    const human = await registerHuman(app);
    const older = await character();
    const newer = await character();

    async function send(characterId: string, body: string) {
      await request(app.getHttpServer())
        .post("/messages")
        .set(human.authHeaders)
        .send({ characterId, body })
        .expect(201);
    }

    async function orderedCharacterIds() {
      const response = await request(app.getHttpServer())
        .get("/messages/conversations")
        .set(human.authHeaders)
        .expect(200);
      return response.body.items.map(
        (item: { character: { id: string } }) => item.character.id,
      );
    }

    await send(older.id, "먼저 시작한 대화");
    await send(newer.id, "나중에 시작한 대화");
    await expect(orderedCharacterIds()).resolves.toEqual([newer.id, older.id]);

    // 먼저 시작한 대화에 새 메시지가 오면 최상단으로 올라와야 한다. 정렬 키가
    // 대화 생성 시각이거나 lastMessageAt을 갱신하지 않으면 순서가 그대로다.
    await send(older.id, "오래된 대화에 새 메시지");
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
