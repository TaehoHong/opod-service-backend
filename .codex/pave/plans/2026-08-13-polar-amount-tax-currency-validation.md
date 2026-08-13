# Polar 금액·세금·통화 검증 계획

## 상태

- 상위 우선순위: Polar 작업 2번
- 범위: 금액·세금·통화 검증 한 항목만
- 조사 완료: 2026-08-13
- 구현 승인: 2026-08-13 사용자 확인
- blocking decision: 0개

## 현재 동작

- checkout 생성 시 DB `payment_product_mappings.price_amount`와 `currency`를
  `payments.amount`, `payments.currency` snapshot으로 저장한다.
- Polar checkout 생성 요청에는 통화를 전달하지 않아, Polar가 Backend 서버 IP를
  기준으로 다른 통화를 선택할 수 있다.
- `order.paid.total_amount`만 내부 `payments.amount`와 직접 비교한다.
- Polar의 세금 포함 가격은 등록 가격과 `total_amount`가 같고, 세금 별도 가격은 등록
  가격과 `net_amount`가 같으므로 현재 비교는 정상적인 세금 별도 결제를 거절할 수
  있다.
- webhook 통화는 원장에 기록하지만 내부 snapshot과 비교하지 않는다.

## 목표 동작

1. web checkout은 amount와 currency가 모두 설정된 활성 mapping만 허용한다.
2. Polar checkout 생성 시 mapping currency를 소문자로 정규화해 명시한다.
3. `order.paid`에서 `net_amount`, `tax_amount`, `total_amount`, `currency`를 검증·정규화한다.
4. 내부 등록 가격은 다음 중 하나와 같을 때만 정상으로 본다.
   - 세금 포함: `priceAmount === totalAmount`
   - 세금 별도: `priceAmount === netAmount`
5. `totalAmount === netAmount + taxAmount`가 아니면 지급하지 않는다.
6. 통화는 대소문자를 무시하고 내부 snapshot과 일치해야 한다.
7. 불일치는 기존 provider event failure 흐름으로 기록하고 크레딧을 지급하지 않는다.

## 근거

- Polar Order의 `net_amount`는 할인 후·세전 금액이고 `total_amount`는 할인·세금 후
  금액이다. (`externally-evidenced`)
- Polar의 inclusive 가격은 세금을 총액에서 추출하고, exclusive 가격은 등록 가격에
  세금을 더한다. (`externally-evidenced`)
- Polar는 여러 통화를 지원하며 Backend checkout은 서버 IP 대신 checkout currency를
  명시할 수 있다. (`externally-evidenced`)
- OPOD 가격·통화 snapshot과 불일치 보류 owner는
  `PurchasesService.applyEvent`다. (`owner-found`, `repo-evidenced`)
- Polar payload 정규화 owner는 `PolarPaymentProvider.verifyEvent`다.
  (`owner-found`, `repo-evidenced`)
- checkout provider-neutral 입력 owner는 `CheckoutRequest`이며 실제 Polar 변환은
  `PolarPaymentProvider.createCheckout`이 소유한다. (`owner-found`, `repo-evidenced`)

## 결정 원장

| ID     | 결정                                                       | 근거                          | 상태                         |
| ------ | ---------------------------------------------------------- | ----------------------------- | ---------------------------- |
| PAC-01 | `priceAmount`는 Polar에 등록한 표시 가격 snapshot이다      | 기존 상품 API와 DB mapping    | active, repo-evidenced       |
| PAC-02 | inclusive/exclusive 세금 방식을 모두 지원한다              | Polar 공식 계약               | active, externally-evidenced |
| PAC-03 | 통화는 checkout 생성 때 명시하고 webhook에서 다시 검증한다 | Polar 다중 통화 계약과 REC-05 | active, externally-evidenced |
| PAC-04 | 불일치는 지급 보류와 provider event failure로 처리한다     | 기존 REC-05 정책              | active, repo-evidenced       |

## 구현 체크리스트

1. `src/domain/payments/payment-provider.ts`,
   `src/domain/purchases/purchases.service.ts`,
   `src/domain/payments/polar-payment.provider.ts`
   - checkout currency 전달과 Polar amount component 정규화
   - web mapping 필수값, 금액 식, 통화 일치 검증
   - 결과: 정상 inclusive/exclusive 결제만 크레딧 지급
2. `src/domain/payments/polar-payment.provider.spec.ts`,
   `test/credits.e2e-spec.ts`
   - 서명된 Polar event의 net/tax/total/currency 정규화 보호
   - 세금 포함·별도 정상 지급과 금액·통화 불일치 지급 보류 보호
3. `docs/payment-refund-test-usecases.md`, `docs/07-codebase-guide.md`,
   루트 `docs/polar-payment-architecture.md`
   - REC-05 자동화 상태, canonical test 위치, 확정된 금액 계약 반영

## Test Value Gate

테스트는 실제 현금 결제 후 크레딧 지급이라는 고위험 경계를 보호한다. 세금 별도 정상
결제를 거절하거나, 잘못된 금액·통화 결제에 크레딧을 지급하는 구현이면 실패한다.
내부 호출 순서가 아니라 provider event 계약과 DB 지급 결과를 검증하므로 유지 가치가
있다.

## Feature Readiness

- actor: Polar checkout으로 크레딧을 구매한 사용자
- trigger: 서명 검증된 `order.paid`
- happy path: 상품·가격·통화·금액 식 일치 → 결제 완료와 크레딧 1회 지급
- edge cases: inclusive/exclusive tax, currency case, amount mismatch, currency mismatch,
  필수 mapping 누락, replay
- permissions: 공개 webhook이지만 서명 검증 필수
- public error: 도메인 불일치는 기존 `201 { processed: false, error }` 유지
- data rule: 지급 전에 product, amount, tax equation, currency 모두 일치
- acceptance: 정상 두 세금 방식 지급, 불일치 무지급, replay 중복 지급 없음
- preserve-current-behavior: checkout·webhook API shape, 환불, 다른 provider
- deferred: 실제 Polar Sandbox E2E, 고객 IP 전달, 부분 환불
- out-of-scope: Web checkout UI, schema/migration, discount 지원

## 구현 결과

- 상태: 완료
- checkout은 mapping 통화를 Polar에 명시하고 같은 통화의 기존 checkout만 재사용한다.
- `order.paid`의 net/tax/total/currency를 정규화하고, 상품 가격이 net 또는 total과
  일치하며 `total = net + tax`, 통화가 snapshot과 일치할 때만 지급한다.
- 불일치는 provider event를 `failed`로 기록하고 크레딧을 지급하지 않는다.
- 필수 web mapping 가격·통화가 없으면 checkout 생성을 거절한다.

## 검증

좁은 검증:

1. `npm run test -- polar-payment.provider.spec`
2. `npm run test:e2e -- credits.e2e-spec.ts`

전체 검증:

1. `npm install`
2. `npm run format`
3. `npm run lint`
4. `npm run test`
5. `npm run test:e2e`
6. `npm run build`

2026-08-13 실행 결과:

- 좁은 unit: 3/3 성공
- Polar 결제 E2E: 19/19 성공
- 전체 unit: 154/154 성공 (`--runInBand`)
- lint, build: 성공
- 전체 E2E: 74/75 성공. 변경 범위 밖 문의 동시성 test의 DB connection 종료 오류
  1건이며 해당 suite 독립 실행은 7/7 성공
- format: 변경 파일은 Prettier 통과. 전체 format 명령은 기존
  `google-play-iap.provider.ts` 불일치 때문에 실패
