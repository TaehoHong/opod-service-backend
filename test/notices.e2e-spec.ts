import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";

describe("notices", () => {
  let app: INestApplication;

  const dayMs = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const prisma = app.get(PrismaService);
    await prisma.notice.deleteMany();
    await prisma.notice.createMany({
      data: [
        {
          title: "고정 공지",
          body: "점검 안내",
          isPinned: true,
          publishedAt: new Date(Date.now() - 3 * dayMs),
        },
        {
          title: "최신 공지",
          body: "업데이트 소식",
          publishedAt: new Date(Date.now() - 1 * dayMs),
        },
        {
          title: "지난 공지",
          body: "이전 소식",
          publishedAt: new Date(Date.now() - 2 * dayMs),
        },
        {
          title: "초안 공지",
          body: "아직 발행 전",
          publishedAt: null,
        },
        {
          title: "예약 공지",
          body: "내일 발행",
          publishedAt: new Date(Date.now() + 1 * dayMs),
        },
      ],
    });
  });

  afterAll(async () => {
    await app.get(PrismaService).notice.deleteMany();
    await app.close();
  });

  it("lists published notices with pinned separated, without auth", async () => {
    const response = await request(app.getHttpServer())
      .get("/notices")
      .expect(200);

    expect(
      response.body.pinned.map((item: { title: string }) => item.title),
    ).toEqual(["고정 공지"]);
    expect(
      response.body.items.map((item: { title: string }) => item.title),
    ).toEqual(["최신 공지", "지난 공지"]);
    expect(response.body.nextCursor).toBeUndefined();

    // 목록에는 본문이 포함되지 않는다.
    expect(response.body.items[0].body).toBeUndefined();
    expect(response.body.items[0]).toMatchObject({
      isPinned: false,
      publishedAt: expect.any(String),
    });
  });

  it("returns a published notice with its body and hides unpublished ones", async () => {
    const prisma = app.get(PrismaService);
    const published = await prisma.notice.findFirst({
      where: { title: "최신 공지" },
    });
    const draft = await prisma.notice.findFirst({
      where: { title: "초안 공지" },
    });
    const scheduled = await prisma.notice.findFirst({
      where: { title: "예약 공지" },
    });

    const response = await request(app.getHttpServer())
      .get(`/notices/${published?.id}`)
      .expect(200);
    expect(response.body).toMatchObject({
      id: published?.id,
      title: "최신 공지",
      body: "업데이트 소식",
      isPinned: false,
      publishedAt: expect.any(String),
    });

    await request(app.getHttpServer()).get(`/notices/${draft?.id}`).expect(404);
    await request(app.getHttpServer())
      .get(`/notices/${scheduled?.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .get("/notices/0198f7a0-0000-7000-8000-000000000000")
      .expect(404);
    await request(app.getHttpServer()).get("/notices/bad-id").expect(404);
  });

  it("paginates general notices and omits pinned on cursor pages", async () => {
    const firstPage = await request(app.getHttpServer())
      .get("/notices?limit=1")
      .expect(200);

    expect(firstPage.body.pinned).toHaveLength(1);
    expect(
      firstPage.body.items.map((item: { title: string }) => item.title),
    ).toEqual(["최신 공지"]);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app.getHttpServer())
      .get(`/notices?limit=1&cursor=${firstPage.body.nextCursor}`)
      .expect(200);

    expect(secondPage.body.pinned).toBeUndefined();
    expect(
      secondPage.body.items.map((item: { title: string }) => item.title),
    ).toEqual(["지난 공지"]);
  });
});
