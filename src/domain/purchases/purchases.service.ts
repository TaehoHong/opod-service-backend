import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";
import {
  activeReservationCondition,
  type CreditClient,
  CreditsService,
} from "../credits/credits.service";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lt,
  or,
  sql,
  sum,
  type SQL,
} from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { decodeCursor, PageInput, pageFromRows } from "../database/page";
import {
  creditProducts,
  creditPurchases,
  creditRefund,
  creditReservations,
  paymentLedger,
  paymentProductMappings,
  paymentProviderEvents,
  payments as paymentRows,
} from "../database/schema";
import { NOTIFICATION_TYPES } from "../notifications/notification-types";
import { NotificationsService } from "../notifications/notifications.service";
import { PaymentEvent } from "../payments/payment-provider";
import { PaymentsService } from "../payments/payments.service";

type Tx = CreditClient;
type PurchaseBase = typeof creditPurchases.$inferSelect;
type PaymentRow = typeof paymentRows.$inferSelect;
type PurchaseRow = PurchaseBase & { payment: PaymentRow | null };
type PaymentWithPurchase = PaymentRow & { purchase: PurchaseBase };
type RefundRow = typeof creditRefund.$inferSelect;
type RefundWithPurchase = RefundRow & { purchase: PurchaseRow };

const purchaseWithPayment = {
  purchase: getTableColumns(creditPurchases),
  payment: getTableColumns(paymentRows),
};

const paymentWithPurchase = {
  payment: getTableColumns(paymentRows),
  purchase: getTableColumns(creditPurchases),
};

@Injectable()
export class PurchasesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly payments: PaymentsService,
    private readonly credits: CreditsService,
    private readonly notifications: NotificationsService,
  ) {}

  async listProducts(channel: "web" | "apple" | "google") {
    const provider = await this.payments.providerForChannel(channel);
    const mappings = await this.database.client
      .select({
        mapping: getTableColumns(paymentProductMappings),
        creditProduct: getTableColumns(creditProducts),
      })
      .from(paymentProductMappings)
      .innerJoin(
        creditProducts,
        eq(paymentProductMappings.creditProductId, creditProducts.id),
      )
      .where(
        and(
          eq(paymentProductMappings.channel, channel),
          eq(paymentProductMappings.provider, provider.name),
          eq(paymentProductMappings.environment, provider.environment),
          eq(paymentProductMappings.isActive, true),
          eq(creditProducts.isActive, true),
        ),
      )
      .orderBy(asc(creditProducts.displayOrder), asc(creditProducts.code));
    return mappings.map((mapping) => ({
      id: mapping.creditProduct.code,
      name: mapping.creditProduct.name,
      creditAmount: mapping.creditProduct.creditAmount,
      providerProductId: mapping.mapping.providerProductId,
      ...(mapping.mapping.priceAmount !== null
        ? { priceAmount: mapping.mapping.priceAmount }
        : {}),
      ...(mapping.mapping.currency
        ? { currency: mapping.mapping.currency }
        : {}),
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
    customerIpAddress?: string;
    successUrl?: string;
    returnUrl?: string;
  }) {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey)
      throw new BadRequestException("Idempotency-Key is required");
    this.assertCheckoutRedirects(input.successUrl, input.returnUrl);

    const existing = await this.findPurchaseByIdempotency(
      this.database.client,
      input.userId,
      idempotencyKey,
    );
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
    if (mapping.priceAmount === null || !mapping.currency?.trim()) {
      throw new ConflictException("Credit product price is unavailable");
    }
    const externalProduct = mapping.providerProductId;
    const currency = mapping.currency.trim().toUpperCase();

    const purchase = await this.database.client.transaction(async (tx) => {
      await this.lockPaymentReference(
        tx,
        "checkout",
        `${input.userId}:${idempotencyKey}`,
      );
      const raced = await this.findPurchaseByIdempotency(
        tx,
        input.userId,
        idempotencyKey,
      );
      if (raced) {
        if (raced.productId !== input.productId) {
          throw new ConflictException("Idempotency key conflict");
        }
        return raced;
      }
      const [created] = await tx
        .insert(creditPurchases)
        .values({
          userId: input.userId,
          creditProductId: product.id,
          productId: input.productId,
          creditAmount: product.creditAmount,
          idempotencyKey,
        })
        .returning();
      const [payment] = await tx
        .insert(paymentRows)
        .values({
          purchaseId: created.id,
          channel: "web",
          provider: provider.name,
          providerProductId: externalProduct,
          amount: mapping.priceAmount,
          currency,
        })
        .returning();
      return { ...created, payment };
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

    return this.database.client.transaction(async (tx) => {
      await this.lockPaymentReference(
        tx,
        verified.provider,
        verified.transactionKey,
      );
      const existing = await this.findPayment(
        tx,
        and(
          eq(paymentRows.provider, verified.provider),
          eq(paymentRows.providerTransactionKey, verified.transactionKey),
        ),
      );
      if (existing) {
        if (existing.purchase.userId !== input.userId) {
          throw new ConflictException("Purchase already claimed");
        }
        return this.toPurchase({ ...existing.purchase, payment: existing });
      }
      const [purchaseBase] = await tx
        .insert(creditPurchases)
        .values({
          userId: input.userId,
          creditProductId: product.id,
          productId: input.productId,
          status: "completed",
          creditAmount: product.creditAmount,
          idempotencyKey: `${verified.provider}:${verified.transactionKey}`,
          fulfilledAt: new Date(),
        })
        .returning();
      const [payment] = await tx
        .insert(paymentRows)
        .values({
          purchaseId: purchaseBase.id,
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
        })
        .returning();
      await tx.insert(paymentLedger).values({
        paymentId: payment.id,
        type: "capture",
        direction: "inflow",
        amount: verified.amount,
        currency: verified.currency,
        providerTransactionId: verified.transactionId,
        occurredAt: verified.occurredAt,
      });
      const purchase: PurchaseRow = { ...purchaseBase, payment };
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
    let cursor: { id: string; createdAt: Date } | undefined;
    if (cursorId) {
      [cursor] = await this.database.client
        .select({
          id: creditPurchases.id,
          createdAt: creditPurchases.createdAt,
        })
        .from(creditPurchases)
        .where(
          and(
            eq(creditPurchases.id, cursorId),
            eq(creditPurchases.userId, userId),
          ),
        )
        .limit(1);
      if (!cursor) throw new BadRequestException("Invalid cursor");
    }
    const joined = await this.database.client
      .select(purchaseWithPayment)
      .from(creditPurchases)
      .leftJoin(paymentRows, eq(paymentRows.purchaseId, creditPurchases.id))
      .where(
        and(
          eq(creditPurchases.userId, userId),
          cursor
            ? or(
                lt(creditPurchases.createdAt, cursor.createdAt),
                and(
                  eq(creditPurchases.createdAt, cursor.createdAt),
                  lt(creditPurchases.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(creditPurchases.createdAt), desc(creditPurchases.id))
      .limit(input.limit + 1);
    const rows = joined.map(({ purchase, payment }) => ({
      ...purchase,
      payment,
    }));
    return pageFromRows(
      rows.map((row) => this.toPurchase(row)),
      input.limit,
    );
  }

  async getByCheckoutId(userId: string, checkoutId: string) {
    const normalized = checkoutId.trim();
    if (!normalized) throw new NotFoundException("Purchase not found");
    const [joined] = await this.database.client
      .select(purchaseWithPayment)
      .from(creditPurchases)
      .innerJoin(paymentRows, eq(paymentRows.purchaseId, creditPurchases.id))
      .where(
        and(
          eq(creditPurchases.userId, userId),
          eq(paymentRows.providerCheckoutId, normalized),
        ),
      )
      .limit(1);
    const purchase = joined
      ? ({ ...joined.purchase, payment: joined.payment } as PurchaseRow)
      : null;
    if (!purchase) throw new NotFoundException("Purchase not found");
    const payment = purchase.payment;
    if (
      purchase.status === "pending" &&
      payment &&
      ["pending", "verified", "processing"].includes(payment.status)
    ) {
      const event = await this.payments.reconcileCheckout(payment.provider, {
        checkoutId: normalized,
        purchaseId: purchase.id,
        userId,
        providerProductId: payment.providerProductId,
      });
      if (event) {
        await this.database.client.transaction(async (tx) =>
          this.applyEvent(tx, payment.provider, event),
        );
        const current = await this.requirePurchase(
          this.database.client,
          purchase.id,
        );
        return this.toPurchase(current);
      }
    }
    return this.toPurchase(purchase);
  }

  async refundQuote(userId: string, purchaseId: string) {
    return this.database.client.transaction(async (tx) => {
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
    const prepared = await this.database.client.transaction(async (tx) => {
      await this.lockUser(tx, input.userId);
      const existing = await this.findRefundWithPurchase(
        tx,
        and(
          eq(creditRefund.purchaseId, input.purchaseId),
          eq(creditRefund.idempotencyKey, idempotencyKey),
        ),
      );
      if (existing) return { refund: existing, isNew: false };
      const quote = await this.refundQuoteWithClient(
        tx,
        input.userId,
        input.purchaseId,
      );
      if (!quote.eligible)
        throw new ConflictException("Refund is not eligible");
      const [refundBase] = await tx
        .insert(creditRefund)
        .values({
          purchaseId: input.purchaseId,
          idempotencyKey,
          status: "payment_processing",
          provider: quote.provider,
          creditAmount: quote.refundableCredits,
          promotionAmount: quote.promotionRecoveryCredits,
          freePromotionAmount: quote.freePromotionRecoveryCredits,
          lockedAmount:
            quote.refundableCredits + quote.remainingPromotionCredits,
          recoveryAmount:
            quote.refundableCredits + quote.promotionRecoveryCredits,
          debtAmount: 0,
          grossAmount: quote.grossAmount,
          feeAmount: quote.feeAmount,
          refundAmount: quote.refundAmount,
          currency: quote.currency,
        })
        .returning();
      const purchase = await this.requirePurchase(tx, input.purchaseId);
      const refund: RefundWithPurchase = { ...refundBase, purchase };
      return { refund, isNew: true };
    });
    const refund = prepared.refund;
    if (refund.status === "payment_succeeded") {
      return this.completeRefund(refund.id);
    }
    if (!prepared.isNew || refund.providerRefundId) {
      return this.requireRefund(this.database.client, refund.id);
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
      await this.database.client
        .update(creditRefund)
        .set({ providerRefundId: result.providerRefundId, status })
        .where(eq(creditRefund.id, refund.id));
      if (result.status === "succeeded") return this.completeRefund(refund.id);
      return this.requireRefund(this.database.client, refund.id);
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
    return this.database.client.transaction(async (tx) =>
      this.applyEvent(tx, providerName, event),
    );
  }

  private async applyEvent(tx: Tx, provider: string, event: PaymentEvent) {
    const [inbox] = await tx
      .insert(paymentProviderEvents)
      .values({
        provider,
        externalEventId: event.eventId,
        eventType: event.type,
      })
      .onConflictDoUpdate({
        target: [
          paymentProviderEvents.provider,
          paymentProviderEvents.externalEventId,
        ],
        set: { attempts: sql`${paymentProviderEvents.attempts} + 1` },
      })
      .returning();
    if (inbox.eventType !== event.type) {
      throw new ConflictException("Provider event ID conflict");
    }
    if (inbox.status === "processed") return { processed: true, replay: true };
    if (event.type === "ignored") {
      await tx
        .update(paymentProviderEvents)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(paymentProviderEvents.id, inbox.id));
      return { processed: true };
    }
    let payment = event.purchaseId
      ? await this.findPayment(
          tx,
          and(
            eq(paymentRows.purchaseId, event.purchaseId),
            eq(paymentRows.provider, provider),
          ),
        )
      : null;
    if (!payment && (event.transactionKey || event.transactionId)) {
      const key =
        event.transactionKey ??
        (provider === "google_play" && event.transactionId
          ? createHash("sha256").update(event.transactionId).digest("hex")
          : undefined);
      payment = await this.findPayment(
        tx,
        and(
          eq(paymentRows.provider, provider),
          key
            ? eq(paymentRows.providerTransactionKey, key)
            : eq(paymentRows.providerTransactionId, event.transactionId!),
        ),
      );
    }
    if (!payment) throw new NotFoundException("Payment not found");
    await this.lockUser(tx, payment.purchase.userId);
    await this.lockPaymentReference(tx, provider, payment.id);
    payment = await this.requirePayment(tx, payment.id);
    await tx
      .update(paymentProviderEvents)
      .set({ paymentId: payment.id })
      .where(eq(paymentProviderEvents.id, inbox.id));
    if (event.type === "paid") {
      if (
        event.providerProductId &&
        event.providerProductId !== payment.providerProductId
      ) {
        return this.failProviderEvent(tx, inbox.id, "product_mismatch");
      }
      if (
        event.netAmount !== undefined &&
        event.taxAmount !== undefined &&
        event.amount !== undefined &&
        event.amount !== event.netAmount + event.taxAmount
      ) {
        return this.failProviderEvent(tx, inbox.id, "amount_mismatch");
      }
      const reportedAmounts = [event.netAmount, event.amount].filter(
        (amount): amount is number => amount !== undefined,
      );
      if (
        reportedAmounts.length > 0 &&
        (payment.amount === null || !reportedAmounts.includes(payment.amount))
      ) {
        return this.failProviderEvent(tx, inbox.id, "amount_mismatch");
      }
      if (
        event.currency &&
        (!payment.currency ||
          payment.currency.trim().toUpperCase() !==
            event.currency.trim().toUpperCase())
      ) {
        return this.failProviderEvent(tx, inbox.id, "currency_mismatch");
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
        await tx
          .update(paymentRows)
          .set({
            status: "paid",
            providerTransactionId: event.transactionId,
            netAmount: event.netAmount,
            taxAmount: event.taxAmount,
            providerTransactionKey:
              event.transactionKey ??
              (event.transactionId
                ? createHash("sha256").update(event.transactionId).digest("hex")
                : undefined),
            paidAt: event.occurredAt,
          })
          .where(eq(paymentRows.id, payment.id));
        await tx.insert(paymentLedger).values({
          paymentId: payment.id,
          type: "capture",
          direction: "inflow",
          amount: event.amount ?? payment.amount,
          currency: event.currency ?? payment.currency,
          providerTransactionId: event.transactionId,
          providerEventId: event.eventId,
          occurredAt: event.occurredAt,
        });
        await tx
          .update(creditPurchases)
          .set({ status: "completed", fulfilledAt: new Date() })
          .where(eq(creditPurchases.id, payment.purchaseId));
        // 웹훅은 비동기라 유저가 앱을 떠난 뒤 지급될 수 있다 — 알림 가치가
        // 실제로 있는 몇 안 되는 경로다. 트랜잭션 안에서 만들어야 재전송이
        // inbox(`payment_provider_events`)에서 걸러진다. 커밋 후 별도로 만들면
        // 그 가드를 우회해 배달마다 알림이 쌓인다.
        await this.notifications.createNotificationWithClient(tx, {
          userId: payment.purchase.userId,
          type: NOTIFICATION_TYPES.creditPurchaseCompleted,
          title: "크레딧 충전 완료",
          body: `크레딧 ${payment.purchase.creditAmount}개가 지급되었습니다.`,
          targetType: "purchase",
          targetId: payment.purchaseId,
        });
      }
    } else if (event.type === "failed") {
      if (["pending", "verified", "processing"].includes(payment.status)) {
        await tx
          .update(paymentRows)
          .set({ status: "failed" })
          .where(eq(paymentRows.id, payment.id));
        await tx
          .update(creditPurchases)
          .set({ status: "failed" })
          .where(eq(creditPurchases.id, payment.purchaseId));
      }
    } else if (
      event.type === "refunded" &&
      event.netAmount !== undefined &&
      event.refundedAmount !== undefined
    ) {
      const failed = await this.applyCumulativeRefund(
        tx,
        payment,
        {
          ...event,
          netAmount: event.netAmount,
          refundedAmount: event.refundedAmount,
        },
        inbox.id,
      );
      if (failed) return failed;
    } else if (event.type === "refunded") {
      const [pendingRefund] = await tx
        .select()
        .from(creditRefund)
        .where(
          and(
            eq(creditRefund.purchaseId, payment.purchaseId),
            inArray(creditRefund.status, [
              "payment_processing",
              "payment_succeeded",
            ]),
          ),
        )
        .orderBy(asc(creditRefund.createdAt), asc(creditRefund.id))
        .limit(1);
      if (pendingRefund) {
        await this.completeRefundWithClient(tx, pendingRefund.id, event);
      } else {
        await this.forceReversal(tx, payment, event);
      }
    } else {
      await this.forceReversal(tx, payment, event);
    }
    await tx
      .update(paymentProviderEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(paymentProviderEvents.id, inbox.id));
    return { processed: true };
  }

  private async failProviderEvent(tx: Tx, eventId: string, code: string) {
    await tx
      .update(paymentProviderEvents)
      .set({
        status: "failed",
        lastErrorCode: code,
        processedAt: new Date(),
      })
      .where(eq(paymentProviderEvents.id, eventId));
    return { processed: false, error: code };
  }

  private async applyCumulativeRefund(
    tx: Tx,
    initialPayment: PaymentWithPurchase,
    event: PaymentEvent & { netAmount: number; refundedAmount: number },
    inboxId: string,
  ) {
    if (
      event.netAmount <= 0 ||
      event.refundedAmount <= 0 ||
      event.refundedAmount > event.netAmount ||
      (initialPayment.netAmount !== null &&
        initialPayment.netAmount !== event.netAmount) ||
      (initialPayment.taxAmount !== null &&
        event.taxAmount !== undefined &&
        initialPayment.taxAmount !== event.taxAmount)
    ) {
      return this.failProviderEvent(tx, inboxId, "refund_amount_mismatch");
    }
    if (
      event.currency &&
      (!initialPayment.currency ||
        initialPayment.currency.trim().toUpperCase() !==
          event.currency.trim().toUpperCase())
    ) {
      return this.failProviderEvent(tx, inboxId, "currency_mismatch");
    }

    const [refunded] = await tx
      .select({ amount: sum(paymentLedger.amount).mapWith(Number) })
      .from(paymentLedger)
      .where(
        and(
          eq(paymentLedger.paymentId, initialPayment.id),
          inArray(paymentLedger.type, ["refund", "chargeback"]),
        ),
      );
    let previousRefundedAmount = refunded.amount ?? 0;
    if (event.refundedAmount < previousRefundedAmount) {
      return this.failProviderEvent(tx, inboxId, "refund_amount_mismatch");
    }

    const [pendingRefund] = await tx
      .select()
      .from(creditRefund)
      .where(
        and(
          eq(creditRefund.purchaseId, initialPayment.purchaseId),
          inArray(creditRefund.status, [
            "payment_processing",
            "payment_succeeded",
          ]),
        ),
      )
      .orderBy(asc(creditRefund.createdAt), asc(creditRefund.id))
      .limit(1);
    if (pendingRefund) {
      const increase = event.refundedAmount - previousRefundedAmount;
      if (increase < pendingRefund.refundAmount) {
        return this.failProviderEvent(tx, inboxId, "refund_amount_mismatch");
      }
      await this.completeRefundWithClient(tx, pendingRefund.id, event);
      previousRefundedAmount += pendingRefund.refundAmount;
    }
    if (event.refundedAmount === previousRefundedAmount) return;

    const payment = await this.requirePayment(tx, initialPayment.id);
    const snapshot = await this.credits.getPurchaseCreditSnapshotWithClient(
      tx,
      {
        userId: payment.purchase.userId,
        purchaseId: payment.purchaseId,
      },
    );
    const [recovered] = await tx
      .select({
        creditAmount: sum(creditRefund.creditAmount).mapWith(Number),
        promotionAmount: sum(creditRefund.promotionAmount).mapWith(Number),
        freePromotionAmount: sum(creditRefund.freePromotionAmount).mapWith(
          Number,
        ),
      })
      .from(creditRefund)
      .where(
        and(
          eq(creditRefund.purchaseId, payment.purchaseId),
          eq(creditRefund.status, "completed"),
        ),
      );
    const previousBaseRecovery = Math.max(0, recovered.creditAmount ?? 0);
    const previousPaidPromotionRecovery = Math.max(
      0,
      (recovered.promotionAmount ?? 0) - (recovered.freePromotionAmount ?? 0),
    );
    const originalPaidCredits =
      snapshot.originalPaid + snapshot.originalPaidPromotion;
    const targetPaidRecovery = Math.floor(
      (originalPaidCredits * event.refundedAmount) / event.netAmount,
    );
    const targetBaseRecovery = Math.floor(
      (snapshot.originalPaid * event.refundedAmount) / event.netAmount,
    );
    const targetPaidPromotionRecovery = targetPaidRecovery - targetBaseRecovery;
    const baseRecovery = Math.max(0, targetBaseRecovery - previousBaseRecovery);
    const paidPromotionRecovery = Math.max(
      0,
      targetPaidPromotionRecovery - previousPaidPromotionRecovery,
    );
    const paidRecovery = baseRecovery + paidPromotionRecovery;
    const freePromotionRecovery = Math.max(
      0,
      snapshot.remainingPromotion - snapshot.remainingPaidPromotion,
    );
    const recoveryAmount = paidRecovery + freePromotionRecovery;
    const availablePaidCredits =
      snapshot.remainingPaid + snapshot.remainingPaidPromotion;
    const debtAmount = Math.max(0, paidRecovery - availablePaidCredits);
    const refundIncrease = event.refundedAmount - previousRefundedAmount;
    const [refund] = await tx
      .insert(creditRefund)
      .values({
        purchaseId: payment.purchaseId,
        idempotencyKey: `provider:${event.eventId}`,
        status: "completed",
        reason: "provider_reversal",
        provider: payment.provider,
        creditAmount: baseRecovery,
        promotionAmount: paidPromotionRecovery + freePromotionRecovery,
        freePromotionAmount: freePromotionRecovery,
        lockedAmount: 0,
        recoveryAmount,
        debtAmount,
        grossAmount: refundIncrease,
        feeAmount: 0,
        refundAmount: refundIncrease,
        currency: event.currency ?? payment.currency ?? "UNKNOWN",
        providerTransactionId: event.transactionId,
        completedAt: event.occurredAt,
      })
      .returning();
    if (recoveryAmount > 0) {
      await this.credits.recordRefundRecoveryWithClient(tx, {
        userId: payment.purchase.userId,
        purchaseId: payment.purchaseId,
        amount: recoveryAmount,
        refundId: refund.id,
        reason: "provider partial refund",
      });
    }
    const fullyRefunded = event.refundedAmount === event.netAmount;
    await tx
      .update(paymentRows)
      .set({
        netAmount: event.netAmount,
        taxAmount: event.taxAmount,
        status:
          payment.status === "refunded"
            ? "refunded"
            : fullyRefunded
              ? "reversed"
              : "partially_refunded",
        ...(fullyRefunded ? { refundedAt: event.occurredAt } : {}),
      })
      .where(eq(paymentRows.id, payment.id));
    await tx.insert(paymentLedger).values({
      paymentId: payment.id,
      type: "refund",
      direction: "outflow",
      amount: refundIncrease,
      currency: event.currency ?? payment.currency,
      providerTransactionId: event.transactionId,
      providerEventId: event.eventId,
      details: {
        cumulativeRefundedAmount: event.refundedAmount,
        refundedTaxAmount: event.refundedTaxAmount,
      },
      occurredAt: event.occurredAt,
    });
    if (payment.purchase.status !== "refunded") {
      await tx
        .update(creditPurchases)
        .set({ status: fullyRefunded ? "reversed" : "completed" })
        .where(eq(creditPurchases.id, payment.purchaseId));
    }
  }

  private async forceReversal(
    tx: Tx,
    payment: PaymentWithPurchase,
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
    const [refund] = await tx
      .insert(creditRefund)
      .values({
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
      })
      .returning();
    if (recovery > 0) {
      await this.credits.recordRefundRecoveryWithClient(tx, {
        userId: payment.purchase.userId,
        purchaseId: payment.purchaseId,
        amount: recovery,
        refundId: refund.id,
        reason: "provider reversal",
      });
    }
    await tx
      .update(paymentRows)
      .set({
        status: "reversed",
        refundedAt: new Date(),
      })
      .where(eq(paymentRows.id, payment.id));
    await tx.insert(paymentLedger).values({
      paymentId: payment.id,
      type: "chargeback",
      direction: "outflow",
      amount: event.amount ?? payment.amount,
      currency: event.currency ?? payment.currency,
      providerTransactionId: event.transactionId,
      providerEventId: event.eventId,
      occurredAt: event.occurredAt,
    });
    await tx
      .update(creditPurchases)
      .set({ status: "reversed" })
      .where(eq(creditPurchases.id, payment.purchaseId));
  }

  private async completeRefund(refundId: string) {
    return this.database.client.transaction((tx) =>
      this.completeRefundWithClient(tx, refundId),
    );
  }

  private async completeRefundWithClient(
    tx: Tx,
    refundId: string,
    event?: PaymentEvent,
  ) {
    let refund = await this.requireRefundWithPurchase(tx, refundId);
    const initialPayment = refund.purchase.payment;
    if (!initialPayment) throw new ConflictException("Payment not found");
    await this.lockUser(tx, refund.purchase.userId);
    await this.lockPaymentReference(
      tx,
      initialPayment.provider,
      initialPayment.id,
    );
    refund = await this.requireRefundWithPurchase(tx, refundId);
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
    await tx.insert(paymentLedger).values({
      paymentId: payment.id,
      type: "refund",
      direction: "outflow",
      amount: refund.refundAmount,
      currency: event?.currency ?? refund.currency,
      providerTransactionId: refund.providerRefundId,
      providerEventId: event?.eventId,
      occurredAt: event?.occurredAt ?? new Date(),
    });
    await tx
      .update(paymentRows)
      .set({
        status: "refunded",
        refundedAt: event?.occurredAt ?? new Date(),
      })
      .where(eq(paymentRows.id, payment.id));
    await tx
      .update(creditPurchases)
      .set({ status: "refunded" })
      .where(eq(creditPurchases.id, refund.purchaseId));
    // 위 `refund.status === "completed"` 가드를 통과한 경로만 여기 닿으므로
    // 환불 1건당 알림 1건이다.
    await this.notifications.createNotificationWithClient(tx, {
      userId: refund.purchase.userId,
      type: NOTIFICATION_TYPES.creditRefundCompleted,
      title: "환불 완료",
      body: "환불이 정상 처리되었습니다.",
      targetType: "refund",
      targetId: refund.id,
    });
    const [completed] = await tx
      .update(creditRefund)
      .set({
        status: "completed",
        providerTransactionId: event?.transactionId,
        completedAt: event?.occurredAt ?? new Date(),
      })
      .where(eq(creditRefund.id, refund.id))
      .returning();
    return completed;
  }

  private async refundQuoteWithClient(
    tx: Tx,
    userId: string,
    purchaseId: string,
  ) {
    const purchase = await this.findPurchase(
      tx,
      and(
        eq(creditPurchases.id, purchaseId),
        eq(creditPurchases.userId, userId),
      ),
    );
    if (!purchase) throw new NotFoundException("Purchase not found");
    if (purchase.payment?.channel !== "web")
      throw new ConflictException("Store managed refund");
    const [{ value: activeReservations }] = await tx
      .select({ value: count() })
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.userId, userId),
          activeReservationCondition(),
        ),
      );
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
    const paymentAmount =
      purchase.payment.provider === "polar"
        ? purchase.payment.netAmount
        : purchase.payment.amount;
    if (purchase.payment.provider === "polar" && paymentAmount === null) {
      throw new ConflictException("Payment refund amount is unavailable");
    }
    const grossAmount =
      eligible && paymentAmount
        ? Math.floor(
            (paymentAmount * remainingEligibleCredits) /
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
        paidBalance - refundableCredits - snapshot.remainingPaidPromotion,
      remainingPromotionCredits: snapshot.remainingPromotion,
      promotionRecoveryCredits: snapshot.remainingPromotion,
      freePromotionRecoveryCredits:
        snapshot.remainingPromotion - snapshot.remainingPaidPromotion,
      expectedDebtIncrease: 0,
    };
  }

  private toPurchase(row: PurchaseRow) {
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

  private assertCheckoutRedirects(successUrl?: string, returnUrl?: string) {
    if (successUrl) {
      const url = this.checkoutRedirectUrl(successUrl);
      if (
        url.pathname !== "/profile/payment-return" ||
        url.searchParams.size !== 1 ||
        url.searchParams.get("checkout_id") !== "{CHECKOUT_ID}" ||
        url.hash
      ) {
        throw new BadRequestException("Checkout success URL is invalid");
      }
    }
    if (returnUrl) {
      const url = this.checkoutRedirectUrl(returnUrl);
      if (url.pathname !== "/profile" || url.search || url.hash) {
        throw new BadRequestException("Checkout return URL is invalid");
      }
    }
  }

  private checkoutRedirectUrl(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException("Checkout redirect URL is invalid");
    }
    const configured = process.env.WEB_APP_URL?.trim();
    const allowedOrigins = new Set(["https://opod-web.vercel.app"]);
    if (configured) {
      try {
        const configuredUrl = new URL(configured);
        if (
          configuredUrl.protocol !== "http:" &&
          configuredUrl.protocol !== "https:"
        ) {
          throw new Error("unsupported protocol");
        }
        allowedOrigins.add(configuredUrl.origin);
      } catch {
        throw new ConflictException("Web app URL is invalid");
      }
    }
    const local =
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:");
    if (!local && !allowedOrigins.has(url.origin)) {
      throw new BadRequestException("Checkout redirect origin is invalid");
    }
    return url;
  }

  private async lockUser(tx: Tx, userId: string) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credits:${userId}`}, 0))`,
    );
  }

  private async lockPaymentReference(tx: Tx, provider: string, key: string) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payment:${provider}:${key}`}, 0))`,
    );
  }

  private async ensureCheckout(
    purchase: PurchaseRow,
    input: {
      userId: string;
      customerIpAddress?: string;
      successUrl?: string;
      returnUrl?: string;
    },
  ) {
    if (!purchase.payment) throw new ConflictException("Payment not found");
    if (
      purchase.payment.amount === null ||
      !purchase.payment.currency?.trim()
    ) {
      throw new ConflictException("Credit product price is unavailable");
    }
    if (purchase.payment.providerCheckoutId) {
      return {
        ...this.toPurchase(purchase),
        checkoutUrl: purchase.payment.providerCheckoutUrl,
      };
    }

    const claimed = await this.database.client
      .update(paymentRows)
      .set({ status: "processing" })
      .where(
        and(
          eq(paymentRows.id, purchase.payment.id),
          eq(paymentRows.status, "pending"),
          isNull(paymentRows.providerCheckoutId),
        ),
      )
      .returning({ id: paymentRows.id });
    const checkoutInput = {
      purchaseId: purchase.id,
      userId: input.userId,
      providerProductId: purchase.payment.providerProductId,
      currency: purchase.payment.currency ?? undefined,
      customerIpAddress: input.customerIpAddress,
      successUrl: input.successUrl,
      returnUrl: input.returnUrl,
    };
    let checkout = await this.payments.findCheckout(
      purchase.payment.provider,
      checkoutInput,
    );
    if (!checkout) {
      if (claimed.length === 0) {
        const current = await this.requirePaymentBase(
          this.database.client,
          purchase.payment.id,
        );
        if (Date.now() - current.updatedAt.getTime() < 30_000) {
          throw new ConflictException("Checkout is being prepared");
        }
      }
      checkout = await this.payments.createCheckout(
        purchase.payment.provider,
        checkoutInput,
      );
    }
    await this.database.client.transaction(async (tx) => {
      await tx
        .update(paymentRows)
        .set({
          providerCheckoutId: checkout.checkoutId,
          providerCheckoutUrl: checkout.checkoutUrl,
        })
        .where(eq(paymentRows.id, purchase.payment!.id));
      await tx
        .update(paymentRows)
        .set({ status: "pending" })
        .where(
          and(
            eq(paymentRows.id, purchase.payment!.id),
            eq(paymentRows.status, "processing"),
          ),
        );
    });
    const current = await this.requirePurchase(
      this.database.client,
      purchase.id,
    );
    return {
      ...this.toPurchase(current),
      checkoutUrl: current.payment?.providerCheckoutUrl ?? checkout.checkoutUrl,
    };
  }

  private async findPurchase(
    client: Tx,
    condition: SQL | undefined,
  ): Promise<PurchaseRow | null> {
    const [row] = await client
      .select(purchaseWithPayment)
      .from(creditPurchases)
      .leftJoin(paymentRows, eq(paymentRows.purchaseId, creditPurchases.id))
      .where(condition)
      .limit(1);
    return row ? { ...row.purchase, payment: row.payment } : null;
  }

  private findPurchaseByIdempotency(
    client: Tx,
    userId: string,
    idempotencyKey: string,
  ) {
    return this.findPurchase(
      client,
      and(
        eq(creditPurchases.userId, userId),
        eq(creditPurchases.idempotencyKey, idempotencyKey),
      ),
    );
  }

  private async requirePurchase(client: Tx, id: string): Promise<PurchaseRow> {
    const purchase = await this.findPurchase(
      client,
      eq(creditPurchases.id, id),
    );
    if (!purchase) throw new NotFoundException("Purchase not found");
    return purchase;
  }

  private async findPayment(
    client: Tx,
    condition: SQL | undefined,
  ): Promise<PaymentWithPurchase | null> {
    const [row] = await client
      .select(paymentWithPurchase)
      .from(paymentRows)
      .innerJoin(
        creditPurchases,
        eq(paymentRows.purchaseId, creditPurchases.id),
      )
      .where(condition)
      .limit(1);
    return row ? { ...row.payment, purchase: row.purchase } : null;
  }

  private async requirePayment(client: Tx, id: string) {
    const payment = await this.findPayment(client, eq(paymentRows.id, id));
    if (!payment) throw new NotFoundException("Payment not found");
    return payment;
  }

  private async requirePaymentBase(client: Tx, id: string) {
    const [payment] = await client
      .select()
      .from(paymentRows)
      .where(eq(paymentRows.id, id))
      .limit(1);
    if (!payment) throw new NotFoundException("Payment not found");
    return payment;
  }

  private async findRefundWithPurchase(
    client: Tx,
    condition: SQL | undefined,
  ): Promise<RefundWithPurchase | null> {
    const [row] = await client
      .select({
        refund: getTableColumns(creditRefund),
        purchase: getTableColumns(creditPurchases),
        payment: getTableColumns(paymentRows),
      })
      .from(creditRefund)
      .innerJoin(
        creditPurchases,
        eq(creditRefund.purchaseId, creditPurchases.id),
      )
      .leftJoin(paymentRows, eq(paymentRows.purchaseId, creditPurchases.id))
      .where(condition)
      .limit(1);
    return row
      ? { ...row.refund, purchase: { ...row.purchase, payment: row.payment } }
      : null;
  }

  private async requireRefundWithPurchase(client: Tx, id: string) {
    const refund = await this.findRefundWithPurchase(
      client,
      eq(creditRefund.id, id),
    );
    if (!refund) throw new NotFoundException("Refund not found");
    return refund;
  }

  private async requireRefund(client: Tx, id: string): Promise<RefundRow> {
    const [refund] = await client
      .select()
      .from(creditRefund)
      .where(eq(creditRefund.id, id))
      .limit(1);
    if (!refund) throw new NotFoundException("Refund not found");
    return refund;
  }

  private async resolveProduct(
    code: string,
    channel: "web" | "apple" | "google",
  ) {
    const [product] = await this.database.client
      .select()
      .from(creditProducts)
      .where(eq(creditProducts.code, code))
      .limit(1);
    if (!product) throw new BadRequestException("Unknown credit product");
    if (!product.isActive)
      throw new ConflictException("Credit product is unavailable");
    const provider = await this.payments.providerForChannel(channel);
    const [mapping] = await this.database.client
      .select()
      .from(paymentProductMappings)
      .where(
        and(
          eq(paymentProductMappings.creditProductId, product.id),
          eq(paymentProductMappings.channel, channel),
          eq(paymentProductMappings.provider, provider.name),
          eq(paymentProductMappings.environment, provider.environment),
          eq(paymentProductMappings.isActive, true),
        ),
      )
      .limit(1);
    if (!mapping) throw new ConflictException("Credit product is unavailable");
    return { product, mapping, provider };
  }
}
