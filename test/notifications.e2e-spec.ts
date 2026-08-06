import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";
import { registerHuman } from "./human-auth";

describe("notifications", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists notifications for a user", async () => {
    const human = await registerHuman(app);

    await request(app.getHttpServer())
      .get("/notifications")
      .set(human.authHeaders)
      .expect(200)
      .expect({ items: [] });
  });

  it("marks an owned notification as read", async () => {
    const human = await registerHuman(app);
    const otherHuman = await registerHuman(app);
    const notification = await prisma.notification.create({
      data: {
        userId: human.user.id,
        type: "message",
        title: "New message",
      },
    });

    await request(app.getHttpServer())
      .patch(`/notifications/${notification.id}/read`)
      .set(human.authHeaders)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          id: notification.id,
          readAt: expect.any(String),
        });
      });

    await expect(
      prisma.notification.findUnique({ where: { id: notification.id } }),
    ).resolves.toMatchObject({ readAt: expect.any(Date) });

    await request(app.getHttpServer())
      .patch(`/notifications/${notification.id}/read`)
      .set(otherHuman.authHeaders)
      .expect(404);
  });

  it("materializes follow notifications once, only for content after the follow", async () => {
    const human = await registerHuman(app);
    const character = await prisma.character.create({
      data: {
        publicId: `soi-${randomUUID()}`,
        displayName: "소이",
        bio: "film photos",
      },
    });
    const beforeFollow = await prisma.post.create({
      data: { characterId: character.id, content: "before the follow" },
    });

    await request(app.getHttpServer())
      .post("/follows")
      .set(human.authHeaders)
      .send({ characterId: character.id })
      .expect(201);

    const afterFollow = await prisma.post.create({
      data: { characterId: character.id, content: "after the follow" },
    });
    const media = await prisma.media.create({
      data: {
        mediaType: "image",
        url: `https://cdn.example.com/${randomUUID()}.jpg`,
      },
    });
    const liveStory = await prisma.story.create({
      data: {
        characterId: character.id,
        mediaId: media.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const expiredStory = await prisma.story.create({
      data: {
        characterId: character.id,
        mediaId: media.id,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await request(app.getHttpServer())
      .post("/notifications/sync")
      .set(human.authHeaders)
      .expect(201)
      .expect({ created: 2, truncated: false });

    const targets = await prisma.notification.findMany({
      where: { userId: human.user.id },
      select: { type: true, targetId: true },
    });
    expect(targets).toEqual(
      expect.arrayContaining([
        { type: "character.new_post", targetId: afterFollow.id },
        { type: "character.new_story", targetId: liveStory.id },
      ]),
    );
    // 팔로우 이전 게시글과 만료된 스토리는 대상이 아니다.
    const targetIds = targets.map((row) => row.targetId);
    expect(targetIds).not.toContain(beforeFollow.id);
    expect(targetIds).not.toContain(expiredStory.id);

    // 워터마크를 전진시키지 않으면 sync를 부를 때마다 같은 게시글로 알림이
    // 쌓인다. 이 두 단언이 그 결함을 잡는다.
    await request(app.getHttpServer())
      .post("/notifications/sync")
      .set(human.authHeaders)
      .expect(201)
      .expect({ created: 0, truncated: false });
    await expect(
      prisma.notification.count({ where: { userId: human.user.id } }),
    ).resolves.toBe(2);
  });

  it("stops materializing after an unfollow", async () => {
    const human = await registerHuman(app);
    const character = await prisma.character.create({
      data: {
        publicId: `arin-${randomUUID()}`,
        displayName: "아린",
        bio: "playful",
      },
    });

    await request(app.getHttpServer())
      .post("/follows")
      .set(human.authHeaders)
      .send({ characterId: character.id })
      .expect(201);
    await request(app.getHttpServer())
      .delete("/follows")
      .set(human.authHeaders)
      .send({ characterId: character.id })
      .expect(200);

    await prisma.post.create({
      data: { characterId: character.id, content: "after the unfollow" },
    });

    await request(app.getHttpServer())
      .post("/notifications/sync")
      .set(human.authHeaders)
      .expect(201)
      .expect({ created: 0, truncated: false });
  });
});
