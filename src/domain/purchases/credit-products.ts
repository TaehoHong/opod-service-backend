import { PaymentChannel } from "../payments/payment-provider";
import { creditPackages } from "../credits/credit-pricing";

export const creditProducts = creditPackages;

export type CreditProductId = keyof typeof creditProducts;

export function isCreditProductId(value: string): value is CreditProductId {
  return Object.prototype.hasOwnProperty.call(creditProducts, value);
}

const envPrefix: Record<PaymentChannel, string> = {
  web: "POLAR_PRODUCT_",
  apple: "APPLE_PRODUCT_",
  google: "GOOGLE_PRODUCT_",
};

export function providerProductId(
  productId: CreditProductId,
  channel: PaymentChannel,
): string | undefined {
  const configured =
    process.env[`${envPrefix[channel]}${productId.toUpperCase()}`]?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? undefined : productId;
}

export function internalProductId(
  providerId: string,
  channel: PaymentChannel,
): CreditProductId | undefined {
  return (Object.keys(creditProducts) as CreditProductId[]).find(
    (id) => providerProductId(id, channel) === providerId,
  );
}
