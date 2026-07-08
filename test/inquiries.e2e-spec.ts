import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";
import { registerHuman } from "./human-auth";

describe("inquiries", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a submitted inquiry for the authenticated user", async () => {
    const human = await registerHuman(app);

    const response = await request(app.getHttpServer())
      .post("/inquiries")
      .set(human.authHeaders)
      .send({ category: "credit", body: "결제했는데 크레딧이 안 들어와요." })
      .expect(201);

    expect(response.body).toMatchObject({
      id: expect.any(String),
      category: "credit",
      body: "결제했는데 크레딧이 안 들어와요.",
      status: "submitted",
      answeredAt: null,
      createdAt: expect.any(String),
    });
  });

  it("rejects invalid inputs and missing auth", async () => {
    const human = await registerHuman(app);

    await request(app.getHttpServer())
      .post("/inquiries")
      .send({ category: "etc", body: "no auth" })
      .expect(401);

    await request(app.getHttpServer())
      .post("/inquiries")
      .set(human.authHeaders)
      .send({ category: "unknown", body: "hello" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/inquiries")
      .set(human.authHeaders)
      .send({ category: "etc", body: "  " })
      .expect(400);

    await request(app.getHttpServer())
      .post("/inquiries")
      .set(human.authHeaders)
      .send({ category: "etc", body: "x".repeat(2001) })
      .expect(400);
  });

  it("lists only the caller's inquiries, newest first, with pagination", async () => {
    const human = await registerHuman(app);
    const other = await registerHuman(app);

    for (const body of ["첫 문의", "둘째 문의", "셋째 문의"]) {
      await request(app.getHttpServer())
        .post("/inquiries")
        .set(human.authHeaders)
        .send({ category: "etc", body })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post("/inquiries")
      .set(other.authHeaders)
      .send({ category: "etc", body: "남의 문의" })
      .expect(201);

    await request(app.getHttpServer()).get("/inquiries").expect(401);

    const firstPage = await request(app.getHttpServer())
      .get("/inquiries?limit=2")
      .set(human.authHeaders)
      .expect(200);

    expect(
      firstPage.body.items.map((item: { body: string }) => item.body),
    ).toEqual(["셋째 문의", "둘째 문의"]);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app.getHttpServer())
      .get(`/inquiries?limit=2&cursor=${firstPage.body.nextCursor}`)
      .set(human.authHeaders)
      .expect(200);

    expect(
      secondPage.body.items.map((item: { body: string }) => item.body),
    ).toEqual(["첫 문의"]);
    expect(secondPage.body.nextCursor).toBeUndefined();
  });

  it("returns own inquiry detail with the answer, hiding others' inquiries", async () => {
    const human = await registerHuman(app);
    const other = await registerHuman(app);

    const created = await request(app.getHttpServer())
      .post("/inquiries")
      .set(human.authHeaders)
      .send({ category: "credit", body: "결제했는데 크레딧이 안 들어와요." })
      .expect(201);
    const inquiryId = created.body.id as string;

    // 미답변 상세: answerBody는 null.
    const beforeAnswer = await request(app.getHttpServer())
      .get(`/inquiries/${inquiryId}`)
      .set(human.authHeaders)
      .expect(200);
    expect(beforeAnswer.body).toMatchObject({
      id: inquiryId,
      status: "submitted",
      answerBody: null,
      answeredAt: null,
    });

    // 어드민 답변 기록을 시뮬레이션 (opod-admin이 수행하는 계약 — 정책 §5.3).
    await app.get(PrismaService).inquiry.update({
      where: { id: inquiryId },
      data: {
        status: "answered",
        answerBody: "확인 후 크레딧을 지급해 드렸어요.",
        answeredAt: new Date(),
      },
    });

    const afterAnswer = await request(app.getHttpServer())
      .get(`/inquiries/${inquiryId}`)
      .set(human.authHeaders)
      .expect(200);
    expect(afterAnswer.body).toMatchObject({
      status: "answered",
      answerBody: "확인 후 크레딧을 지급해 드렸어요.",
      answeredAt: expect.any(String),
    });

    // 타인 문의는 존재를 노출하지 않는다.
    await request(app.getHttpServer())
      .get(`/inquiries/${inquiryId}`)
      .set(other.authHeaders)
      .expect(404);
    await request(app.getHttpServer())
      .get("/inquiries/0198f7a0-0000-7000-8000-000000000000")
      .set(human.authHeaders)
      .expect(404);
    await request(app.getHttpServer())
      .get("/inquiries/bad-id")
      .set(human.authHeaders)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/inquiries/${inquiryId}`)
      .expect(401);
  });

  it("deletes a submitted inquiry but protects answered ones", async () => {
    const human = await registerHuman(app);
    const other = await registerHuman(app);

    const submitted = await request(app.getHttpServer())
      .post("/inquiries")
      .set(human.authHeaders)
      .send({ category: "etc", body: "삭제할 문의" })
      .expect(201);
    const answered = await request(app.getHttpServer())
      .post("/inquiries")
      .set(human.authHeaders)
      .send({ category: "etc", body: "답변받을 문의" })
      .expect(201);

    await app.get(PrismaService).inquiry.update({
      where: { id: answered.body.id },
      data: {
        status: "answered",
        answerBody: "답변입니다.",
        answeredAt: new Date(),
      },
    });

    // 타인은 삭제 불가 — 존재도 노출하지 않음.
    await request(app.getHttpServer())
      .delete(`/inquiries/${submitted.body.id}`)
      .set(other.authHeaders)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/inquiries/${submitted.body.id}`)
      .expect(401);

    // submitted 상태는 삭제 가능.
    await request(app.getHttpServer())
      .delete(`/inquiries/${submitted.body.id}`)
      .set(human.authHeaders)
      .expect(200)
      .expect({ deleted: true });
    await request(app.getHttpServer())
      .get(`/inquiries/${submitted.body.id}`)
      .set(human.authHeaders)
      .expect(404);

    // 답변된 문의는 분쟁처리 기록 — 삭제 거절, 데이터 유지.
    await request(app.getHttpServer())
      .delete(`/inquiries/${answered.body.id}`)
      .set(human.authHeaders)
      .expect(409);
    await request(app.getHttpServer())
      .get(`/inquiries/${answered.body.id}`)
      .set(human.authHeaders)
      .expect(200);

    await request(app.getHttpServer())
      .delete("/inquiries/bad-id")
      .set(human.authHeaders)
      .expect(404);
  });

  it("limits a user to 10 inquiries per day", async () => {
    const human = await registerHuman(app);

    for (let index = 0; index < 10; index++) {
      await request(app.getHttpServer())
        .post("/inquiries")
        .set(human.authHeaders)
        .send({ category: "etc", body: `문의 ${index + 1}` })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post("/inquiries")
      .set(human.authHeaders)
      .send({ category: "etc", body: "11번째 문의" })
      .expect(429);

    // 다른 유저는 영향 없음.
    const other = await registerHuman(app);
    await request(app.getHttpServer())
      .post("/inquiries")
      .set(other.authHeaders)
      .send({ category: "etc", body: "다른 유저 문의" })
      .expect(201);
  });
});
