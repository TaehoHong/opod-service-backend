import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

export const consentTypes = [
  "terms_of_service",
  "privacy",
  "age_14",
  "marketing",
] as const;

export type ConsentType = (typeof consentTypes)[number];

// 선택 동의 — 나머지는 필수라서 미동의로는 가입할 수 없고 철회도 막는다.
const optionalConsentTypes: ConsentType[] = ["marketing"];

export type TermsDocumentSummary = {
  type: ConsentType;
  version: string;
  title: string;
  required: boolean;
  effectiveAt: Date;
};

export type TermsDocumentDetail = TermsDocumentSummary & { body: string };

export type ConsentStatus = {
  type: ConsentType;
  required: boolean;
  agreed: boolean;
  agreedVersion: string | null;
  currentVersion: string | null;
  needsConsent: boolean;
};

export type ConsentRecord = {
  type: ConsentType;
  version: string;
  agreed: boolean;
};

type ConsentInput = { type: ConsentType; agreed: boolean };

type ConsentClient = Pick<PrismaService, "userConsent">;

const documentSummaryFields = {
  type: true,
  version: true,
  title: true,
  effectiveAt: true,
} as const;

@Injectable()
export class ConsentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listEffectiveDocuments(): Promise<TermsDocumentSummary[]> {
    const documents = await this.effectiveDocuments();
    return consentTypes
      .map((type) => documents.get(type))
      .filter((document): document is TermsDocumentSummary => !!document);
  }

  async findEffectiveDocument(
    type: unknown,
  ): Promise<TermsDocumentDetail | null> {
    const consentType = this.requiredConsentType(type);
    const document = (await this.prisma.termsDocument.findFirst({
      where: { type: consentType, effectiveAt: { lte: new Date() } },
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
      select: { ...documentSummaryFields, body: true },
    })) as Omit<TermsDocumentDetail, "required"> | null;
    return document
      ? { ...document, required: this.isRequired(document.type) }
      : null;
  }

  async listUserConsents(userId: string): Promise<ConsentStatus[]> {
    const [documents, latest] = await Promise.all([
      this.effectiveDocuments(),
      this.latestConsents(userId),
    ]);

    return consentTypes.map((type) => {
      const currentVersion = documents.get(type)?.version ?? null;
      const row = latest.get(type);
      const agreed = row?.agreed ?? false;
      const required = this.isRequired(type);
      return {
        type,
        required,
        agreed,
        agreedVersion: row?.version ?? null,
        currentVersion,
        // 시행 중인 문서가 없으면 요구할 버전 자체가 없다. 선택 항목은
        // 미동의도 정상 상태이므로 재동의를 요구하지 않는다.
        needsConsent:
          required &&
          currentVersion !== null &&
          !(agreed && row?.version === currentVersion),
      };
    });
  }

  // 회원가입 요청의 동의 항목을 검증하고 서버가 아는 현재 버전을 붙인다.
  // 클라이언트가 버전을 보내지 않으므로 증빙 버전을 위조할 수 없다.
  async resolveRegistrationConsents(value: unknown): Promise<ConsentRecord[]> {
    const inputs = this.parseConsentInputs(value);
    const documents = await this.effectiveDocuments();

    const missing = consentTypes.filter(
      (type) =>
        this.isRequired(type) &&
        documents.has(type) &&
        !inputs.some((input) => input.type === type && input.agreed),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Consent is required: ${missing.join(", ")}`,
      );
    }

    return this.toConsentRecords(inputs, documents);
  }

  async updateUserConsents(
    userId: string,
    value: unknown,
  ): Promise<ConsentStatus[]> {
    const inputs = this.parseConsentInputs(value);
    if (!inputs.length) {
      throw new BadRequestException("consents is required");
    }

    const withdrawnRequired = inputs.filter(
      (input) => !input.agreed && this.isRequired(input.type),
    );
    if (withdrawnRequired.length) {
      throw new BadRequestException(
        `Required consent cannot be withdrawn: ${withdrawnRequired
          .map((input) => input.type)
          .join(", ")}`,
      );
    }

    const [documents, latest] = await Promise.all([
      this.effectiveDocuments(),
      this.latestConsents(userId),
    ]);
    const records = this.toConsentRecords(inputs, documents);

    // 같은 버전에 같은 응답을 다시 보내면 이력을 늘리지 않는다.
    // ponytail: 동시 요청은 잠그지 않는다 — 서로 다른 값이 겹치면 최신 행이
    // 이기고, 두 요청 모두 증빙으로 남는다.
    const changed = records.filter((record) => {
      const row = latest.get(record.type);
      return (
        !row || row.agreed !== record.agreed || row.version !== record.version
      );
    });
    if (changed.length) {
      await this.recordConsents(this.prisma, userId, changed);
    }

    return this.listUserConsents(userId);
  }

  async recordConsents(
    client: ConsentClient,
    userId: string,
    records: ConsentRecord[],
  ): Promise<void> {
    if (!records.length) {
      return;
    }
    await client.userConsent.createMany({
      data: records.map((record) => ({ userId, ...record })),
    });
  }

  private async effectiveDocuments(): Promise<
    Map<ConsentType, TermsDocumentSummary>
  > {
    const now = new Date();
    const documents = await Promise.all(
      consentTypes.map(
        (type) =>
          this.prisma.termsDocument.findFirst({
            where: { type, effectiveAt: { lte: now } },
            orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
            select: documentSummaryFields,
          }) as Promise<Omit<TermsDocumentSummary, "required"> | null>,
      ),
    );

    return new Map(
      documents
        .filter((document) => !!document)
        .map((document) => [
          document.type,
          { ...document, required: this.isRequired(document.type) },
        ]),
    );
  }

  private async latestConsents(
    userId: string,
  ): Promise<Map<ConsentType, { version: string; agreed: boolean }>> {
    const rows = await Promise.all(
      consentTypes.map(
        (type) =>
          this.prisma.userConsent.findFirst({
            where: { userId, type },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { type: true, version: true, agreed: true },
          }) as Promise<{
            type: ConsentType;
            version: string;
            agreed: boolean;
          } | null>,
      ),
    );

    return new Map(rows.filter((row) => !!row).map((row) => [row.type, row]));
  }

  private toConsentRecords(
    inputs: ConsentInput[],
    documents: Map<ConsentType, TermsDocumentSummary>,
  ): ConsentRecord[] {
    return inputs.map((input) => {
      const document = documents.get(input.type);
      if (!document) {
        throw new BadRequestException(
          `Consent document is not available: ${input.type}`,
        );
      }
      return {
        type: input.type,
        version: document.version,
        agreed: input.agreed,
      };
    });
  }

  private parseConsentInputs(value: unknown): ConsentInput[] {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new BadRequestException("consents must be an array");
    }

    const inputs = value.map((item) => {
      const entry = item as { type?: unknown; agreed?: unknown } | null;
      if (typeof entry?.agreed !== "boolean") {
        throw new BadRequestException("consents[].agreed must be a boolean");
      }
      return {
        type: this.requiredConsentType(entry.type),
        agreed: entry.agreed,
      };
    });

    const types = new Set(inputs.map((input) => input.type));
    if (types.size !== inputs.length) {
      throw new BadRequestException("consents must not repeat the same type");
    }
    return inputs;
  }

  private requiredConsentType(value: unknown): ConsentType {
    if (!consentTypes.includes(value as ConsentType)) {
      throw new BadRequestException("consent type is invalid");
    }
    return value as ConsentType;
  }

  private isRequired(type: ConsentType): boolean {
    return !optionalConsentTypes.includes(type);
  }
}
