import { BadRequestException, Injectable } from "@nestjs/common";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";

type CreditEntryType = "grant" | "debit";
type CreditPurchaseStatus =
  "pending" | "paid" | "failed" | "canceled" | "refunded";
type PaymentWebhookStatus = Exclude<CreditPurchaseStatus, "pending">;

type CreditEntry = {
  id: string;
  userId: string;
  entryType: CreditEntryType;
  amount: number;
  reason: string;
  externalReference?: string;
  createdAt: string;
};

type PrismaCreditEntry = Omit<
  CreditEntry,
  "createdAt" | "externalReference"
> & {
  externalReference: string | null;
  createdAt: Date;
};

type CreditPurchase = {
  id: string;
  provider: string;
  status: CreditPurchaseStatus;
  creditAmount: number;
  paidAmount: number;
  currency: string;
  createdAt: string;
};

type PrismaCreditPurchase = Omit<CreditPurchase, "createdAt"> & {
  userId: string;
  createdAt: Date;
};

const creditPackages = {
  credits_100: {
    creditAmount: 100,
    paidAmount: 9900,
    currency: "KRW",
  },
} as const;

@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async createCheckout(input: {
    userId: string;
    creditPackageId: string;
  }): Promise<{
    checkoutId: string;
    provider: "local";
    checkoutUrl: string;
  }> {
    const selectedPackage =
      creditPackages[input.creditPackageId as keyof typeof creditPackages];

    if (!selectedPackage) {
      throw new BadRequestException("Unknown credit package");
    }

    const purchase = await this.prisma.creditPurchase.create({
      data: {
        userId: input.userId,
        provider: "local",
        status: "pending",
        creditAmount: selectedPackage.creditAmount,
        paidAmount: selectedPackage.paidAmount,
        currency: selectedPackage.currency,
      },
    });

    return {
      checkoutId: purchase.id,
      provider: "local",
      // ponytail: local checkout URL; replace with provider URL when Toss/Stripe is selected.
      checkoutUrl: `https://payments.local/checkout/${purchase.id}`,
    };
  }

  async spendCredits(input: {
    userId: string;
    amount: number;
    reason: string;
  }): Promise<CreditEntry> {
    this.validateEntryInput(input);

    if ((await this.getBalance(input.userId)).balance < input.amount) {
      throw new BadRequestException("Insufficient credits");
    }

    return this.appendEntry("debit", input);
  }

  async getBalance(
    userId: string,
  ): Promise<{ userId: string; balance: number }> {
    const entries = await this.listEntries(userId);

    return {
      userId,
      balance: entries.reduce((balance, entry) => {
        return entry.entryType === "grant"
          ? balance + entry.amount
          : balance - entry.amount;
      }, 0),
    };
  }

  async listEntries(userId: string): Promise<CreditEntry[]> {
    const entries = await this.prisma.creditLedgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return entries.map((entry) => this.toCreditEntry(entry));
  }

  async listEntriesPage(
    userId: string,
    input: PageInput,
  ): Promise<Page<CreditEntry>> {
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.creditLedgerEntry.findFirst({
        where: { id: cursorId, userId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const entries = await this.prisma.creditLedgerEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      entries.map((entry) => this.toCreditEntry(entry)),
      input.limit,
    );
  }

  async listPurchasesPage(
    userId: string,
    input: PageInput,
  ): Promise<Page<CreditPurchase>> {
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.creditPurchase.findFirst({
        where: { id: cursorId, userId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const purchases = await this.prisma.creditPurchase.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      purchases.map((purchase) =>
        this.toCreditPurchase(purchase as PrismaCreditPurchase),
      ),
      input.limit,
    );
  }

  async handlePaymentWebhook(
    provider: string,
    input: { checkoutId?: string; status?: string },
  ): Promise<{ received: true }> {
    if (provider !== "local") {
      throw new BadRequestException("Unsupported payment provider");
    }

    const checkoutId = input.checkoutId?.trim();
    if (!checkoutId) {
      throw new BadRequestException("Payment checkout ID is required");
    }

    const status = this.parsePaymentWebhookStatus(input.status);
    const purchase = (await this.prisma.creditPurchase.findUnique({
      where: { id: checkoutId },
    })) as PrismaCreditPurchase | null;

    if (!purchase) {
      throw new BadRequestException("Credit purchase not found");
    }
    if (purchase.provider !== provider) {
      throw new BadRequestException("Payment provider mismatch");
    }

    await this.prisma.creditPurchase.update({
      where: { id: checkoutId },
      data: { status },
    });

    if (status === "paid") {
      await this.grantPaidPurchaseOnce(purchase);
    }

    return { received: true };
  }

  private async appendEntry(
    entryType: CreditEntryType,
    input: {
      userId: string;
      amount: number;
      reason: string;
      externalReference?: string;
    },
  ): Promise<CreditEntry> {
    this.validateEntryInput(input);

    const entry = await this.prisma.creditLedgerEntry.create({
      data: {
        userId: input.userId,
        entryType,
        amount: input.amount,
        reason: input.reason.trim(),
        externalReference: input.externalReference,
      },
    });
    return this.toCreditEntry(entry);
  }

  private toCreditEntry(entry: PrismaCreditEntry): CreditEntry {
    return {
      id: entry.id,
      userId: entry.userId,
      entryType: entry.entryType,
      amount: entry.amount,
      reason: entry.reason,
      externalReference: entry.externalReference ?? undefined,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private toCreditPurchase(purchase: PrismaCreditPurchase): CreditPurchase {
    return {
      id: purchase.id,
      provider: purchase.provider,
      status: purchase.status,
      creditAmount: purchase.creditAmount,
      paidAmount: purchase.paidAmount,
      currency: purchase.currency,
      createdAt: purchase.createdAt.toISOString(),
    };
  }

  private parsePaymentWebhookStatus(
    status: string | undefined,
  ): PaymentWebhookStatus {
    if (
      status === "paid" ||
      status === "failed" ||
      status === "canceled" ||
      status === "refunded"
    ) {
      return status;
    }

    throw new BadRequestException("Unsupported payment status");
  }

  private async grantPaidPurchaseOnce(purchase: PrismaCreditPurchase) {
    const externalReference = `credit_purchase:${purchase.id}`;
    const existingEntry = await this.prisma.creditLedgerEntry.findFirst({
      where: {
        entryType: "grant",
        externalReference,
      },
      select: { id: true },
    });

    if (existingEntry) {
      return;
    }

    await this.prisma.creditLedgerEntry.create({
      data: {
        userId: purchase.userId,
        entryType: "grant",
        amount: purchase.creditAmount,
        reason: "credit purchase paid",
        externalReference,
      },
    });
  }

  private validateEntryInput(input: { amount: number; reason: string }) {
    if (!input.reason.trim()) {
      throw new BadRequestException("Credit ledger reason is required");
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException("Credit amount must be a positive integer");
    }
  }
}
