// Pricing policy source of truth: docs/credit-policy.md (1 credit = KRW 10 web).

export const creditActionPrices = {
  chat_reply: 2,
} as const;

export type CreditActionType = keyof typeof creditActionPrices;

export const freeCreditTtlDays = 30;
export const signupBonusCredits = 100;
export const dailyCheckInCredits = 10;

// Nth check-in within a calendar month (KST) -> extra bonus credits.
export const checkInMilestoneBonuses: Readonly<Record<number, number>> = {
  7: 20,
  14: 30,
  30: 50,
};

export const reservationTtlMs = 5 * 60 * 1000;
