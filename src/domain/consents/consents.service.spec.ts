import { BadRequestException } from "@nestjs/common";
import { queryReturning } from "../../../test/drizzle-mock";
import { consentTypes, ConsentsService } from "./consents.service";

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

function project<T extends object>(row: T, fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.keys(fields).map((field) => [field, row[field as keyof T]]),
  );
}

function createConsentsHarness() {
  const documents: TestDocument[] = [];
  const consents: TestConsent[] = [];
  let documentCall = 0;
  let consentCall = 0;

  const select = jest.fn((fields: Record<string, unknown>) => {
    if ("title" in fields) {
      const type =
        "body" in fields
          ? "terms_of_service"
          : consentTypes[documentCall++ % consentTypes.length];
      const document = documents
        .filter(
          (candidate) =>
            candidate.type === type && candidate.effectiveAt <= new Date(),
        )
        .sort((left, right) =>
          right.effectiveAt.getTime() === left.effectiveAt.getTime()
            ? right.id.localeCompare(left.id)
            : right.effectiveAt.getTime() - left.effectiveAt.getTime(),
        )[0];
      return queryReturning(document ? [project(document, fields)] : []);
    }

    const type = consentTypes[consentCall++ % consentTypes.length];
    const row = consents
      .filter(
        (candidate) => candidate.userId === "user-1" && candidate.type === type,
      )
      .at(-1);
    return queryReturning(row ? [project(row, fields)] : []);
  });
  const insertQuery = queryReturning(undefined);
  insertQuery.values.mockImplementation((values: TestConsent[]) => {
    consents.push(...values);
    return insertQuery;
  });
  const service = new (
    ConsentsService as new (database: unknown) => ConsentsService
  )({
    client: { insert: jest.fn().mockReturnValue(insertQuery), select },
  });
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

  return { consents, publish, service };
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

  it("rejects unknown consent types and documents not yet in effect", async () => {
    const harness = createConsentsHarness();
    harness.publish("marketing", "1.0", "2027-01-01T00:00:00Z");

    await expect(
      harness.service.updateUserConsents("user-1", [
        { type: "newsletter", agreed: true },
      ]),
    ).rejects.toThrow(BadRequestException);
    await expect(
      harness.service.updateUserConsents("user-1", [
        { type: "marketing", agreed: true },
      ]),
    ).rejects.toThrow(BadRequestException);
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
