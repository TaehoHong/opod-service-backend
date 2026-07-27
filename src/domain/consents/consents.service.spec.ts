import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ConsentsService } from "./consents.service";

type TestDocument = {
  id: string;
  type: string;
  version: string;
  title: string;
  body: string;
  effectiveAt: Date;
};

type TestConsent = {
  userId: string;
  type: string;
  version: string;
  agreed: boolean;
};

// Prisma의 select 계약을 그대로 흉내낸다 — 응답에 새 필드가 새는지도 잡힌다.
function project<T extends object>(row: T, select: Record<string, boolean>) {
  return Object.fromEntries(
    Object.keys(select)
      .filter((field) => select[field])
      .map((field) => [field, row[field as keyof T]]),
  );
}

function createConsentsHarness() {
  const documents: TestDocument[] = [];
  const consents: TestConsent[] = [];

  const prisma = {
    termsDocument: {
      findFirst: jest.fn(async ({ where, select }) => {
        const matches = documents
          .filter(
            (document) =>
              document.type === where.type &&
              document.effectiveAt <= where.effectiveAt.lte,
          )
          .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime());
        return matches[0] ? project(matches[0], select) : null;
      }),
    },
    userConsent: {
      findFirst: jest.fn(async ({ where, select }) => {
        const matches = consents.filter(
          (consent) =>
            consent.userId === where.userId && consent.type === where.type,
        );
        const latest = matches[matches.length - 1];
        return latest ? project(latest, select) : null;
      }),
      createMany: jest.fn(async ({ data }) => {
        consents.push(...data);
        return { count: data.length };
      }),
    },
  };

  const publish = (type: string, version: string, effectiveAt: string) => {
    documents.push({
      id: `${type}-${version}`,
      type,
      version,
      title: `${type} ${version}`,
      body: `${type} 본문 ${version}`,
      effectiveAt: new Date(effectiveAt),
    });
  };

  return {
    service: new ConsentsService(prisma as unknown as PrismaService),
    documents,
    consents,
    publish,
  };
}

describe("ConsentsService", () => {
  it("keeps consent history when marketing consent is withdrawn", async () => {
    const harness = createConsentsHarness();
    harness.publish("marketing", "1.0", "2026-01-01T00:00:00Z");

    await harness.service.updateUserConsents("user-1", [
      { type: "marketing", agreed: true },
    ]);
    const statuses = await harness.service.updateUserConsents("user-1", [
      { type: "marketing", agreed: false },
    ]);

    expect(harness.consents).toEqual([
      { userId: "user-1", type: "marketing", version: "1.0", agreed: true },
      { userId: "user-1", type: "marketing", version: "1.0", agreed: false },
    ]);
    expect(statuses).toContainEqual({
      type: "marketing",
      required: false,
      agreed: false,
      agreedVersion: "1.0",
      currentVersion: "1.0",
      needsConsent: false,
    });
  });

  it("does not append a duplicate record for an unchanged answer", async () => {
    const harness = createConsentsHarness();
    harness.publish("marketing", "1.0", "2026-01-01T00:00:00Z");

    await harness.service.updateUserConsents("user-1", [
      { type: "marketing", agreed: true },
    ]);
    await harness.service.updateUserConsents("user-1", [
      { type: "marketing", agreed: true },
    ]);

    expect(harness.consents).toHaveLength(1);
  });

  it("rejects withdrawal of a required consent", async () => {
    const harness = createConsentsHarness();
    harness.publish("terms_of_service", "1.0", "2026-01-01T00:00:00Z");

    await expect(
      harness.service.updateUserConsents("user-1", [
        { type: "terms_of_service", agreed: false },
      ]),
    ).rejects.toThrow(BadRequestException);
    expect(harness.consents).toEqual([]);
  });

  it("rejects unknown consent types and consents without a document in effect", async () => {
    const harness = createConsentsHarness();
    harness.publish("marketing", "1.0", "2027-01-01T00:00:00Z");

    await expect(
      harness.service.updateUserConsents("user-1", [
        { type: "newsletter", agreed: true },
      ]),
    ).rejects.toThrow(BadRequestException);
    // 아직 시행일이 오지 않은 문서에는 동의를 받을 수 없다.
    await expect(
      harness.service.updateUserConsents("user-1", [
        { type: "marketing", agreed: true },
      ]),
    ).rejects.toThrow(BadRequestException);
    expect(harness.consents).toEqual([]);
  });

  it("flags a required consent as outdated after a new version takes effect", async () => {
    const harness = createConsentsHarness();
    harness.publish("terms_of_service", "1.0", "2026-01-01T00:00:00Z");
    await harness.service.updateUserConsents("user-1", [
      { type: "terms_of_service", agreed: true },
    ]);

    harness.publish("terms_of_service", "2.0", "2026-06-01T00:00:00Z");

    expect(await harness.service.listUserConsents("user-1")).toContainEqual({
      type: "terms_of_service",
      required: true,
      agreed: true,
      agreedVersion: "1.0",
      currentVersion: "2.0",
      needsConsent: true,
    });

    await harness.service.updateUserConsents("user-1", [
      { type: "terms_of_service", agreed: true },
    ]);

    expect(await harness.service.listUserConsents("user-1")).toContainEqual({
      type: "terms_of_service",
      required: true,
      agreed: true,
      agreedVersion: "2.0",
      currentVersion: "2.0",
      needsConsent: false,
    });
  });

  it("exposes only documents already in effect", async () => {
    const harness = createConsentsHarness();
    harness.publish("terms_of_service", "1.0", "2026-01-01T00:00:00Z");
    harness.publish("terms_of_service", "2.0", "2027-01-01T00:00:00Z");
    harness.publish("marketing", "1.0", "2026-01-01T00:00:00Z");

    expect(await harness.service.listEffectiveDocuments()).toEqual([
      {
        type: "terms_of_service",
        version: "1.0",
        title: "terms_of_service 1.0",
        required: true,
        effectiveAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        type: "marketing",
        version: "1.0",
        title: "marketing 1.0",
        required: false,
        effectiveAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    expect(
      await harness.service.findEffectiveDocument("terms_of_service"),
    ).toMatchObject({ version: "1.0", body: "terms_of_service 본문 1.0" });
  });
});
