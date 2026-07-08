import { BadRequestException, HttpException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { InquiriesService } from "./inquiries.service";

type TestInquiry = {
  id: string;
  userId: string;
  category: string;
  body: string;
  status: string;
  answerBody: string | null;
  answeredAt: Date | null;
  createdAt: Date;
};

function createInquiriesHarness() {
  const inquiries: TestInquiry[] = [];

  const service = new InquiriesService({
    inquiry: {
      count: jest.fn(async ({ where }) => {
        return inquiries.filter(
          (inquiry) =>
            inquiry.userId === where.userId &&
            inquiry.createdAt >= where.createdAt.gte,
        ).length;
      }),
      create: jest.fn(async ({ data }) => {
        const inquiry: TestInquiry = {
          id: `inquiry-${inquiries.length + 1}`,
          status: "submitted",
          answerBody: null,
          answeredAt: null,
          createdAt: new Date(),
          ...data,
        };
        inquiries.push(inquiry);
        return inquiry;
      }),
    },
  } as unknown as PrismaService);

  return { service, inquiries };
}

describe("InquiriesService", () => {
  it("creates a submitted inquiry with trimmed body", async () => {
    const { service } = createInquiriesHarness();

    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "credit",
        body: "  결제했는데 크레딧이 안 들어와요.  ",
      }),
    ).resolves.toMatchObject({
      category: "credit",
      body: "결제했는데 크레딧이 안 들어와요.",
      status: "submitted",
    });
  });

  it("rejects invalid categories and bodies", async () => {
    const { service } = createInquiriesHarness();

    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "unknown",
        body: "hello",
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createInquiry({ userId: "user-1", category: "etc", body: "  " }),
    ).rejects.toThrow("body is required");

    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "etc",
        body: "x".repeat(2001),
      }),
    ).rejects.toThrow("body must be at most 2000 characters");
  });

  it("enforces the daily limit per user in KST, ignoring older days", async () => {
    const { service, inquiries } = createInquiriesHarness();

    for (let index = 0; index < 10; index++) {
      await service.createInquiry({
        userId: "user-1",
        category: "etc",
        body: `문의 ${index + 1}`,
      });
    }

    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "etc",
        body: "11번째 문의",
      }),
    ).rejects.toThrow(HttpException);
    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "etc",
        body: "11번째 문의",
      }),
    ).rejects.toMatchObject({ status: 429 });

    // 다른 유저는 영향 없음.
    await expect(
      service.createInquiry({
        userId: "user-2",
        category: "etc",
        body: "다른 유저 문의",
      }),
    ).resolves.toMatchObject({ status: "submitted" });

    // 어제 작성분은 오늘 카운트에서 제외된다.
    for (const inquiry of inquiries) {
      if (inquiry.userId === "user-1") {
        inquiry.createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }
    }
    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "etc",
        body: "새 날의 문의",
      }),
    ).resolves.toMatchObject({ status: "submitted" });
  });
});
