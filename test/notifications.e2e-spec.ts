import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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
});
