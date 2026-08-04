import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, createHmac } from "node:crypto";
import { CreditsService } from "../credits/credits.service";
import { decodeCursor, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";
import { PaymentEvent } from "../payments/payment-provider";
import { PaymentsService } from "../payments/payments.service";

type Tx = Prisma.TransactionClient;

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly credits: CreditsService,
  ) {}

  async listProducts(channel: "web" | "apple" | "google") {
    const provider = await this.payments.providerForChannel(channel);
    const mappings = await this.prisma.paymentProductMapping.findMany({
      where: {
        channel,
        provider: provider.name,
        environment: provider.environment,
        isActive: true,
        creditProduct: { isActive: true },
      },
      include: { creditProduct: true },
      orderBy: [
        { creditProduct: { displayOrder: "asc" } },
        { creditProduct: { code: "asc" } },
      ],
    });
    return mappings.map((mapping) => ({
      id: mapping.creditProduct.code,
      name: mapping.creditProduct.name,
      creditAmount: mapping.creditProduct.creditAmount,
      providerProductId: mapping.providerProductId,
      ...(mapping.priceAmount !== null
        ? { priceAmount: mapping.priceAmount }
        : {}),
      ...(mapping.currency ? { currency: mapping.currency } : {}),
    }));
  }

  accountToken(userId: string) {
    const secret =
      process.env.PURCHASE_ACCOUNT_TOKEN_SECRET?.trim() ||
      (process.env.NODE_ENV === "production" ? "" : "opod-development");
    if (!secret)
      throw new ConflictException("Purchase account token is not configured");
    const digest = createHmac("sha256", secret).update(userId).digest();
    const uuid = Buffer.from(digest.subarray(0, 16));
    uuid[6] = (uuid[6] & 0x0f) | 0x50;
    uuid[8] = (uuid[8] & 0x3f) | 0x80;
    const hex = uuid.toString("hex");
    return {
      apple: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
      google: digest.toString("hex"),
    };
  }

  async createCheckout(input: {
    userId: string;
    productId: string;
    idempotencyKey: string;
    successUrl?: string;
    returnUrl?: string;
  }) {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey)
      throw new BadRequestException("Idempotency-Key is required");

    const existing = await this.prisma.creditPurchase.findUnique({
      where: {
        userId_idempotencyKey: { userId: input.userId, idempotencyKey },
      },
      include: { payment: true },
    });
    if (existing) {
      if (existing.productId !== input.productId) {
        throw new ConflictException("Idempotency key conflict");
      }
      return this.ensureCheckout(existing, input);
    }

    const { product, mapping, provider } = await this.resolveProduct(
      input.productId,
      "web",
    );
    const externalProduct = mapping.providerProductId;

    const purchase = await this.prisma.$transaction(async (tx) => {
      await this.lockPaymentReference(
        tx,
        "checkout",
        `${input.userId}:${idempotencyKey}`,
      );
      const raced = await tx.creditPurchase.findUnique({
        where: {
          userId_idempotencyKey: { userId: input.userId, idempotencyKey },
        },
        include: { payment: true },
      });
      if (raced) {
        if (raced.productId !== input.productId) {
          throw new ConflictException("Idempotency key conflict");
        }
        return raced;
      }
      return tx.creditPurchase.create({
        data: {
          userId: input.userId,
          creditProductId: product.id,
          productId: input.productId,
          creditAmount: product.creditAmount,
          idempotencyKey,
          payment: {
            create: {
              channel: "web",
              provider: provider.name,
              providerProductId: externalProduct,
              amount: mapping.priceAmount,
              currency: mapping.currency,
            },
          },
        },
        include: { payment: true },
      });
    });
    return this.ensureCheckout(purchase, input);
  }

  async verifyInApp(input: {
    userId: string;
    channel: "apple" | "google";
    productId: string;
    proof: string;
  }) {
    const { product, mapping } = await this.resolveProduct(
      input.productId,
      input.channel,
    );
    const externalProduct = mapping.providerProductId;
    const token = this.accountToken(input.userId)[input.channel];
    const verified = await this.payments.verifyPurchase(input.channel, {
      proof: input.proof,
      expectedAccountToken: token,
      expectedProductId: externalProduct,
    });
    if (verified.revoked) throw new ConflictException("Purchase was revoked");

    return this.prisma.$transaction(async (tx) => {
      await this.lockPaymentReference(
        tx,
        verified.provider,
        verified.transactionKey,
      );
      const existing = await tx.payment.findUnique({
        where: {
          provider_providerTransactionKey: {
            provider: verified.provider,
            providerTransactionKey: verified.transactionKey,
          },
        },
        include: { purchase: true },
      });
      if (existing) {
        if (existing.purchase.userId !== input.userId) {
          throw new ConflictException("Purchase already claimed");
        }
        return this.toPurchase({ ...existing.purchase, payment: existing });
      }
      const purchase = await tx.creditPurchase.create({
        data: {
          userId: input.userId,
          creditProductId: product.id,
          productId: input.productId,
          status: "completed",
          creditAmount: product.creditAmount,
          idempotencyKey: `${verified.provider}:${verified.transactionKey}`,
          fulfilledAt: new Date(),
          payment: {
            create: {
              channel: input.channel,
              provider: verified.provider,
              status: "paid",
              amount: verified.amount,
              currency: verified.currency,
              providerTransactionId: verified.transactionId,
              providerTransactionKey: verified.transactionKey,
              providerProductId: externalProduct,
              providerEnvironment: verified.environment,
              paidAt: verified.occurredAt,
              ledger: {
                create: {
                  type: "capture",
                  direction: "inflow",
                  amount: verified.amount,
                  currency: verified.currency,
                  providerTransactionId: verified.transactionId,
                  occurredAt: verified.occurredAt,
                },
              },
            },
          },
        },
        include: { payment: true },
      });
      await this.credits.grantCreditsWithClient(tx, {
        userId: input.userId,
        amount: product.creditAmount,
        reason: "credit purchase",
        creditKind: "paid",
        purchaseId: purchase.id,
        externalReference: `credit_purchase:${purchase.id}`,
      });
      return this.toPurchase(purchase);
    });
  }

  async list(userId: string, input: PageInput) {
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.creditPurchase.findFirst({
        where: { id: cursorId, userId },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }
    const rows = await this.prisma.creditPurchase.findMany({
      where: { userId },
      include: { payment: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      rows.map((row) => this.toPurchase(row)),
      input.limit,
    );
  }

  async refundQuote(userId: string, purchaseId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      return this.refundQuoteWithClient(tx, userId, purchaseId);
    });
  }

  async requestRefund(input: {
    userId: string;
    purchaseId: string;
    idempotencyKey: string;
  }) {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey)
      throw new BadRequestException("Idempotency-Key is required");
    const prepared = await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, input.userId);
      const existing = await tx.creditRefund.findUnique({
        where: {
          purchaseId_idempotencyKey: {
            purchaseId: input.purchaseId,
            idempotencyKey,
          },
        },
        include: { purchase: { include: { payment: true } } },
      });
      if (existing) return { refund: existing, isNew: false };
      const quote = await this.refundQuoteWithClient(
        tx,
        input.userId,
        input.purchaseId,
      );
      if (!quote.eligible)
        throw new ConflictException("Refund is not eligible");
      const refund = await tx.creditRefund.create({
        data: {
          purchaseId: input.purchaseId,
          idempotencyKey,
          status: "payment_processing",
          provider: quote.provider,
          creditAmount: quote.refundableCredits,
          promotionAmount: quote.promotionRecoveryCredits,
          lockedAmount:
            quote.refundableCredits + quote.remainingPromotionCredits,
          recoveryAmount:
            quote.refundableCredits + quote.promotionRecoveryCredits,
          debtAmount:
            quote.promotionRecoveryCredits - quote.remainingPromotionCredits,
          grossAmount: quote.grossAmount,
          feeAmount: quote.feeAmount,
          refundAmount: quote.refundAmount,
          currency: quote.currency,
        },
        include: { purchase: { include: { payment: true } } },
      });
      return { refund, isNew: true };
    });
    const refund = prepared.refund;
    if (refund.status === "payment_succeeded") {
      return this.completeRefund(refund.id);
    }
    if (!prepared.isNew || refund.providerRefundId) {
      return this.prisma.creditRefund.findUniqueOrThrow({
        where: { id: refund.id },
      });
    }
    const payment = refund.purchase.payment;
    if (!payment?.providerTransactionId)
      throw new ConflictException("Payment cannot be refunded");
    try {
      const result = await this.payments.requestRefund(payment.provider, {
        providerTransactionId: payment.providerTransactionId,
        amount: refund.refundAmount,
        refundId: refund.id,
      });
      const status =
        result.status === "succeeded"
          ? "payment_succeeded"
          : result.status === "processing"
            ? "payment_processing"
            : result.status;
      await this.prisma.creditRefund.update({
        where: { id: refund.id },
        data: { providerRefundId: result.providerRefundId, status },
      });
      if (result.status === "succeeded") return this.completeRefund(refund.id);
      return this.prisma.creditRefund.findUniqueOrThrow({
        where: { id: refund.id },
      });
    } catch (error) {
      // 결과가 불명확하므로 processing과 lock을 유지한다.
      throw error;
    }
  }

  async applyProviderEvent(
    providerName: string,
    input: { body: Buffer; headers: Record<string, string> },
  ) {
    const event = await this.payments.verifyEvent(providerName, input);
    return this.prisma.$transaction(async (tx) =>
      this.applyEvent(tx, providerName, event),
    );
  }

  private async applyEvent(tx: Tx, provider: string, event: PaymentEvent) {
    const inbox = await tx.paymentProviderEvent.upsert({
      where: {
        provider_externalEventId: { provider, externalEventId: event.eventId },
      },
      create: {
        provider,
        externalEventId: event.eventId,
        eventType: event.type,
      },
      update: { attempts: { increment: 1 } },
    });
    if (inbox.eventType !== event.type) {
      throw new ConflictException("Provider event ID conflict");
    }
    if (inbox.status === "processed") return { processed: true, replay: true };
    if (event.type === "ignored") {
      await tx.paymentProviderEvent.update({
        where: { id: inbox.id },
        data: { status: "processed", processedAt: new Date() },
      });
      return { processed: true };
    }
    let payment = event.purchaseId
      ? await tx.payment.findFirst({
          where: { purchaseId: event.purchaseId, provider },
          include: { purchase: true },
        })
      : null;
    if (!payment && (event.transactionKey || event.transactionId)) {
      const key =
        event.transactionKey ??
        (provider === "google_play" && event.transactionId
          ? createHash("sha256").update(event.transactionId).digest("hex")
          : undefined);
      payment = await tx.payment.findFirst({
        where: key
          ? { provider, providerTransactionKey: key }
          : { provider, providerTransactionId: event.transactionId },
        include: { purchase: true },
      });
    }
    if (!payment) throw new NotFoundException("Payment not found");
    await this.lockUser(tx, payment.purchase.userId);
    await this.lockPaymentReference(tx, provider, payment.id);
    payment = await tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { purchase: true },
    });
    await tx.paymentProviderEvent.update({
      where: { id: inbox.id },
      data: { paymentId: payment.id },
    });
    if (event.type === "paid") {
      if (
        event.providerProductId &&
        event.providerProductId !== payment.providerProductId
      ) {
        return this.failProviderEvent(tx, inbox.id, "product_mismatch");
      }
      if (
        payment.amount !== null &&
        event.amount !== undefined &&
        payment.amount !== event.amount
      ) {
        return this.failProviderEvent(tx, inbox.id, "amount_mismatch");
      }
      if (
        payment.status === "paid" &&
        event.transactionId &&
        payment.providerTransactionId &&
        event.transactionId !== payment.providerTransactionId
      ) {
        return this.failProviderEvent(tx, inbox.id, "duplicate_capture");
      }
      if (payment.status !== "paid") {
        if (!["pending", "verified", "processing"].includes(payment.status)) {
          return this.failProviderEvent(tx, inbox.id, "invalid_transition");
        }
        await this.credits.grantCreditsWithClient(tx, {
          userId: payment.purchase.userId,
          amount: payment.purchase.creditAmount,
          reason: "credit purchase",
          creditKind: "paid",
          purchaseId: payment.purchaseId,
          externalReference: `credit_purchase:${payment.purchaseId}`,
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "paid",
            providerTransactionId: event.transactionId,
            providerTransactionKey:
              event.transactionKey ??
              (event.transactionId
                ? createHash("sha256").update(event.transactionId).digest("hex")
                : undefined),
            paidAt: event.occurredAt,
            ledger: {
              create: {
                type: "capture",
                direction: "inflow",
                amount: event.amount ?? payment.amount,
                currency: event.currency ?? payment.currency,
                providerTransactionId: event.transactionId,
                providerEventId: event.eventId,
                occurredAt: event.occurredAt,
              },
            },
          },
        });
        await tx.creditPurchase.update({
          where: { id: payment.purchaseId },
          data: { status: "completed", fulfilledAt: new Date() },
        });
      }
    } else if (event.type === "failed") {
      if (["pending", "verified", "processing"].includes(payment.status)) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "failed" },
        });
        await tx.creditPurchase.update({
          where: { id: payment.purchaseId },
          data: { status: "failed" },
        });
      }
    } else if (event.type === "refunded") {
      const pendingRefund = await tx.creditRefund.findFirst({
        where: {
          purchaseId: payment.purchaseId,
          status: { in: ["payment_processing", "payment_succeeded"] },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (pendingRefund) {
        await this.completeRefundWithClient(tx, pendingRefund.id, event);
      } else {
        await this.forceReversal(tx, payment, event);
      }
    } else {
      await this.forceReversal(tx, payment, event);
    }
    await tx.paymentProviderEvent.update({
      where: { id: inbox.id },
      data: { status: "processed", processedAt: new Date() },
    });
    return { processed: true };
  }

  private async failProviderEvent(tx: Tx, eventId: string, code: string) {
    await tx.paymentProviderEvent.update({
      where: { id: eventId },
      data: {
        status: "failed",
        lastErrorCode: code,
        processedAt: new Date(),
      },
    });
    return { processed: false, error: code };
  }

  private async forceReversal(
    tx: Tx,
    payment: Prisma.PaymentGetPayload<{ include: { purchase: true } }>,
    event: PaymentEvent,
  ) {
    if (payment.status === "reversed" || payment.status === "refunded") return;
    const snapshot = await this.credits.getPurchaseCreditSnapshotWithClient(
      tx,
      {
        userId: payment.purchase.userId,
        purchaseId: payment.purchaseId,
      },
    );
    const recovery = snapshot.originalPaid + snapshot.originalPromotion;
    const locked = snapshot.remainingPaid + snapshot.remainingPromotion;
    const refund = await tx.creditRefund.create({
      data: {
        purchaseId: payment.purchaseId,
        idempotencyKey: `provider:${event.eventId}`,
        status: "completed",
        reason: "provider_reversal",
        provider: payment.provider,
        creditAmount: snapshot.originalPaid,
        promotionAmount: snapshot.originalPromotion,
        lockedAmount: locked,
        recoveryAmount: recovery,
        debtAmount: Math.max(0, recovery - locked),
        grossAmount: event.amount ?? payment.amount ?? 0,
        feeAmount: 0,
        refundAmount: event.amount ?? payment.amount ?? 0,
        currency: event.currency ?? payment.currency ?? "UNKNOWN",
        providerTransactionId: event.transactionId,
        completedAt: new Date(),
      },
    });
    if (recovery > 0) {
      await this.credits.recordRefundRecoveryWithClient(tx, {
        userId: payment.purchase.userId,
        purchaseId: payment.purchaseId,
        amount: recovery,
        refundId: refund.id,
        reason: "provider reversal",
      });
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "reversed",
        refundedAt: new Date(),
        ledger: {
          create: {
            type: "chargeback",
            direction: "outflow",
            amount: event.amount ?? payment.amount,
            currency: event.currency ?? payment.currency,
            providerTransactionId: event.transactionId,
            providerEventId: event.eventId,
            occurredAt: event.occurredAt,
          },
        },
      },
    });
    await tx.creditPurchase.update({
      where: { id: payment.purchaseId },
      data: { status: "reversed" },
    });
  }

  private async completeRefund(refundId: string) {
    return this.prisma.$transaction((tx) =>
      this.completeRefundWithClient(tx, refundId),
    );
  }

  private async completeRefundWithClient(
    tx: Tx,
    refundId: string,
    event?: PaymentEvent,
  ) {
    let refund = await tx.creditRefund.findUniqueOrThrow({
      where: { id: refundId },
      include: { purchase: { include: { payment: true } } },
    });
    const initialPayment = refund.purchase.payment;
    if (!initialPayment) throw new ConflictException("Payment not found");
    await this.lockUser(tx, refund.purchase.userId);
    await this.lockPaymentReference(tx, initialPayment.provider, initialPayment.id);
    refund = await tx.creditRefund.findUniqueOrThrow({
      where: { id: refundId },
      include: { purchase: { include: { payment: true } } },
    });
    if (refund.status === "completed") return refund;
    const payment = refund.purchase.payment;
    if (!payment) throw new ConflictException("Payment not found");
    await this.credits.recordRefundRecoveryWithClient(tx, {
      userId: refund.purchase.userId,
      purchaseId: refund.purchaseId,
      amount: refund.recoveryAmount,
      refundId: refund.id,
      reason: "user refund",
    });
    await tx.paymentLedger.create({
      data: {
        paymentId: payment.id,
        type: "refund",
        direction: "outflow",
        amount: event?.amount ?? refund.refundAmount,
        currency: event?.currency ?? refund.currency,
        providerTransactionId: refund.providerRefundId,
        providerEventId: event?.eventId,
        occurredAt: event?.occurredAt ?? new Date(),
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "refunded",
        refundedAt: event?.occurredAt ?? new Date(),
      },
    });
    await tx.creditPurchase.update({
      where: { id: refund.purchaseId },
      data: { status: "refunded" },
    });
    return tx.creditRefund.update({
      where: { id: refund.id },
      data: {
        status: "completed",
        providerTransactionId: event?.transactionId,
        completedAt: event?.occurredAt ?? new Date(),
      },
    });
  }

  private async refundQuoteWithClient(
    tx: Tx,
    userId: string,
    purchaseId: string,
  ) {
    const purchase = await tx.creditPurchase.findFirst({
      where: { id: purchaseId, userId },
      include: { payment: true },
    });
    if (!purchase) throw new NotFoundException("Purchase not found");
    if (purchase.payment?.channel !== "web")
      throw new ConflictException("Store managed refund");
    const activeReservations = await tx.creditReservation.count({
      where: { userId, status: "reserved", expiresAt: { gt: new Date() } },
    });
    if (activeReservations > 0)
      throw new ConflictException("Credit usage is in progress");
    const snapshot = await this.credits.getPurchaseCreditSnapshotWithClient(
      tx,
      { userId, purchaseId },
    );
    const refundableCredits =
      snapshot.locked === 0 ? snapshot.remainingPaid : 0;
    const originalEligibleCredits =
      snapshot.originalPaid + snapshot.originalPaidPromotion;
    const remainingEligibleCredits =
      refundableCredits + snapshot.remainingPaidPromotion;
    const eligible =
      purchase.status === "completed" &&
      snapshot.locked === 0 &&
      originalEligibleCredits > 0 &&
      remainingEligibleCredits * 2 >= originalEligibleCredits;
    const grossAmount =
      eligible && purchase.payment.amount
        ? Math.floor(
            (purchase.payment.amount * remainingEligibleCredits) /
              originalEligibleCredits,
          )
        : 0;
    const feeAmount = Math.floor(grossAmount * 0.05);
    const paidBalance = await this.credits.getPaidBalanceWithClient(tx, userId);
    return {
      purchaseId,
      provider: purchase.payment.provider,
      currency: purchase.payment.currency ?? "KRW",
      originalCredits: originalEligibleCredits,
      remainingCredits: remainingEligibleCredits,
      lockedCredits: snapshot.locked,
      refundableCredits,
      minimumCredits: Math.ceil(originalEligibleCredits / 2),
      eligible,
      grossAmount,
      feeAmount,
      refundAmount: grossAmount - feeAmount,
      paidBalanceAfterRefund:
        paidBalance - refundableCredits - snapshot.originalPromotion,
      remainingPromotionCredits: snapshot.remainingPromotion,
      promotionRecoveryCredits: snapshot.originalPromotion,
      expectedDebtIncrease: Math.max(
        0,
        snapshot.originalPromotion - snapshot.remainingPromotion,
      ),
    };
  }

  private toPurchase(
    row: Prisma.CreditPurchaseGetPayload<{ include: { payment: true } }>,
  ) {
    return {
      id: row.id,
      productId: row.productId,
      status: row.status,
      creditAmount: row.creditAmount,
      createdAt: row.createdAt.toISOString(),
      payment: row.payment
        ? {
            channel: row.payment.channel,
            provider: row.payment.provider,
            status: row.payment.status,
            amount: row.payment.amount ?? undefined,
            currency: row.payment.currency ?? undefined,
          }
        : undefined,
    };
  }

  private async lockUser(tx: Tx, userId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`credits:${userId}`}, 0))`;
  }

  private async lockPaymentReference(tx: Tx, provider: string, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment:${provider}:${key}`}, 0))`;
  }

  private async ensureCheckout(
    purchase: Prisma.CreditPurchaseGetPayload<{ include: { payment: true } }>,
    input: {
      userId: string;
      successUrl?: string;
      returnUrl?: string;
    },
  ) {
    if (!purchase.payment) throw new ConflictException("Payment not found");
    if (purchase.payment.providerCheckoutId) {
      return {
        ...this.toPurchase(purchase),
        checkoutUrl: purchase.payment.providerCheckoutUrl,
      };
    }

    const claimed = await this.prisma.payment.updateMany({
      where: {
        id: purchase.payment.id,
        status: "pending",
        providerCheckoutId: null,
      },
      data: { status: "processing" },
    });
    const checkoutInput = {
      purchaseId: purchase.id,
      userId: input.userId,
      providerProductId: purchase.payment.providerProductId,
      successUrl: input.successUrl,
      returnUrl: input.returnUrl,
    };
    let checkout = await this.payments.findCheckout(
      purchase.payment.provider,
      checkoutInput,
    );
    if (!checkout) {
      if (claimed.count === 0) {
        const current = await this.prisma.payment.findUniqueOrThrow({
          where: { id: purchase.payment.id },
        });
        if (Date.now() - current.updatedAt.getTime() < 30_000) {
          throw new ConflictException("Checkout is being prepared");
        }
      }
      checkout = await this.payments.createCheckout(
        purchase.payment.provider,
        checkoutInput,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: purchase.payment!.id },
        data: {
          providerCheckoutId: checkout.checkoutId,
          providerCheckoutUrl: checkout.checkoutUrl,
        },
      });
      await tx.payment.updateMany({
        where: { id: purchase.payment!.id, status: "processing" },
        data: { status: "pending" },
      });
    });
    const current = await this.prisma.creditPurchase.findUniqueOrThrow({
      where: { id: purchase.id },
      include: { payment: true },
    });
    return {
      ...this.toPurchase(current),
      checkoutUrl: current.payment?.providerCheckoutUrl ?? checkout.checkoutUrl,
    };
  }

  private async resolveProduct(
    code: string,
    channel: "web" | "apple" | "google",
  ) {
    const product = await this.prisma.creditProduct.findUnique({
      where: { code },
    });
    if (!product) throw new BadRequestException("Unknown credit product");
    if (!product.isActive)
      throw new ConflictException("Credit product is unavailable");
    const provider = await this.payments.providerForChannel(channel);
    const mapping = await this.prisma.paymentProductMapping.findFirst({
      where: {
        creditProductId: product.id,
        channel,
        provider: provider.name,
        environment: provider.environment,
        isActive: true,
      },
    });
    if (!mapping)
      throw new ConflictException("Credit product is unavailable");
    return { product, mapping, provider };
  }
}
