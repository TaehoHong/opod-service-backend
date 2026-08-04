import { readFileSync } from "node:fs";
import { creditPackages } from "./credit-pricing";

describe("payment/refund use-case coverage", () => {
  it("classifies all 58 money cases by their current verification level", () => {
    const document = readFileSync(
      "docs/payment-refund-test-usecases.md",
      "utf8",
    );
    const [useCases, matrix] = document.split("## 구현 검증 매트릭스");
    const idPattern = "(?:PAY|REF|COM|FOR|NEG|LOCK|REC)-\\d{2}";
    const useCaseIds = [
      ...useCases.matchAll(new RegExp(`^\\|\\s+(${idPattern})\\s+\\|`, "gm")),
    ].map((match) => match[1]);
    const rows = [
      ...matrix.matchAll(
        new RegExp(
          `^\\|\\s+(${idPattern})\\s+\\|\\s+(자동화|부분 자동화|운영 검증|후속 범위)\\s+\\|`,
          "gm",
        ),
      ),
    ].map((match) => ({ id: match[1], status: match[2] }));

    expect(rows).toHaveLength(58);
    expect(rows.map((row) => row.id)).toEqual(useCaseIds);
    expect(rows.some((row) => row.status === "자동화")).toBe(true);
    expect(rows.some((row) => row.status === "운영 검증")).toBe(true);
    expect(rows.some((row) => row.status === "후속 범위")).toBe(true);
  });

  it("keeps the four tested purchase packages at their agreed amounts", () => {
    expect(creditPackages).toEqual({
      credits_500: {
        creditAmount: 500,
        paidAmount: 4900,
        currency: "KRW",
      },
      credits_1050: {
        creditAmount: 1050,
        paidAmount: 9900,
        currency: "KRW",
      },
      credits_3300: {
        creditAmount: 3300,
        paidAmount: 29000,
        currency: "KRW",
      },
      credits_5750: {
        creditAmount: 5750,
        paidAmount: 49000,
        currency: "KRW",
      },
    });
  });
});
