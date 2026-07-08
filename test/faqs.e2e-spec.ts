import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";

describe("faqs", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const prisma = app.get(PrismaService);
    await prisma.faq.deleteMany();
    await prisma.faq.createMany({
      data: [
        {
          category: "credit",
          question: "크레딧은 어떻게 충전하나요?",
          answer: "크레딧 탭에서 충전할 수 있어요.",
          sortOrder: 1,
          isPublished: true,
        },
        {
          category: "account",
          question: "비밀번호를 잊었어요.",
          answer: "고객센터로 문의해 주세요.",
          sortOrder: 0,
          isPublished: true,
        },
        {
          category: "credit",
          question: "아직 준비 중인 질문",
          answer: "초안입니다.",
          sortOrder: 2,
          isPublished: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await app.get(PrismaService).faq.deleteMany();
    await app.close();
  });

  it("lists only published faqs sorted by sortOrder without auth", async () => {
    const response = await request(app.getHttpServer())
      .get("/faqs")
      .expect(200);

    expect(response.body.items).toHaveLength(2);
    expect(
      response.body.items.map((item: { question: string }) => item.question),
    ).toEqual(["비밀번호를 잊었어요.", "크레딧은 어떻게 충전하나요?"]);
    expect(response.body.items[0]).toMatchObject({
      category: "account",
      answer: "고객센터로 문의해 주세요.",
      sortOrder: 0,
    });
  });

  it("filters faqs by category", async () => {
    const response = await request(app.getHttpServer())
      .get("/faqs?category=credit")
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].question).toBe("크레딧은 어떻게 충전하나요?");
  });

  it("returns an empty list for an unknown category", async () => {
    await request(app.getHttpServer())
      .get("/faqs?category=unknown")
      .expect(200)
      .expect({ items: [] });
  });
});
