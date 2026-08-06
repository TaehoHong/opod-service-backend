import { PurchasesService } from "./purchases.service";

describe("PurchasesService account binding", () => {
  const service = new PurchasesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  afterEach(() => {
    delete process.env.PURCHASE_ACCOUNT_TOKEN_SECRET;
    delete process.env.NODE_ENV;
  });

  it("creates stable provider-safe tokens without exposing the user ID", () => {
    process.env.PURCHASE_ACCOUNT_TOKEN_SECRET = "test-purchase-secret";
    const first = service.accountToken("01980000-0000-7000-8000-000000000001");
    const replay = service.accountToken("01980000-0000-7000-8000-000000000001");
    const other = service.accountToken("01980000-0000-7000-8000-000000000002");

    expect(first).toEqual(replay);
    expect(first).not.toEqual(other);
    expect(first.apple).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.google).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toContain("01980000");
  });

  it("requires an explicit account-token secret in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => service.accountToken("user-1")).toThrow(
      "Purchase account token is not configured",
    );
  });
});
