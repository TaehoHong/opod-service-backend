import { readFileSync } from "node:fs";
import { creditPackages } from "./credit-pricing";

describe("payment/refund use-case coverage", () => {
  it("classifies all 58 money cases and only defers provider-owned cases", () => {
    const document = readFileSync(
      "docs/payment-refund-test-usecases.md",
      "utf8",
    );
    const [useCases, matrix] = document.split("## 구현 검증 매트릭스");
    const idPattern = "(?:PAY|REF|COM|FOR|NEG|LOCK|REC)-\\d{2}";
    const useCaseIds = [
      ...useCases.matchAll(new RegExp(`^\\| (${idPattern}) \\|`, "gm")),
    ].map((match) => match[1]);
    const rows = [
      ...matrix.matchAll(
        new RegExp(
          `^\\| (${idPattern}) \\| (자동화|관리자 자동화|PG 단계) \\|`,
          "gm",
        ),
      ),
    ].map((match) => ({ id: match[1], status: match[2] }));

    expect(rows).toHaveLength(58);
    expect(rows.map((row) => row.id)).toEqual(useCaseIds);
    expect(
      rows.filter((row) => row.status === "PG 단계").map((row) => row.id),
    ).toEqual([
      "PAY-09",
      "PAY-10",
      "FOR-01",
      "FOR-02",
      "FOR-03",
      "FOR-04",
      "FOR-05",
      "FOR-06",
      "FOR-07",
      "REC-05",
      "REC-08",
    ]);
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
