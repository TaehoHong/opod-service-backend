# Polar checkout 직접 reconciliation

## 목표

Polar `order.paid` webhook이 누락되더라도 인증된 사용자가 결제 복귀 상태를 조회하면
Backend가 Polar Checkout과 Order를 직접 검증하고 기존 멱등 지급 경로로 구매를
완료한다.

## 범위 지도

- in-scope: `GET /purchases/checkouts/:checkoutId`의 pending Polar 구매 직접 검증
- preserve-current-behavior: 사용자 소유권 404, webhook 주 경로, 금액·통화·상품 검증,
  크레딧·금전 원장·알림의 단일 트랜잭션과 멱등성
- extension-boundary: provider-neutral `reconcileCheckout` 계약
- deferred: 주기적 background reconciliation worker와 운영 alert
- out-of-scope: schema/migration, 환불 polling, admin 수동 정산 API, Web UI 변경

## 결정 원장

| ID | 결정 | 근거 | 상태 |
| --- | --- | --- | --- |
| PCR-01 | webhook을 주 경로로 유지하고 서버 직접 조회를 복구 경로로 추가한다 | user-confirmed | active |
| PCR-02 | Checkout `succeeded`와 Order `paid`를 모두 확인한 뒤에만 지급한다 | externally-evidenced | active |
| PCR-03 | checkout·order의 사용자, purchase metadata, 상품, 금액, 통화를 기존 snapshot과 대조한다 | repo-evidenced / externally-evidenced | active |
| PCR-04 | 지급은 새 경로가 아니라 `PurchasesService.applyEvent`를 재사용한다 | owner-found / repo-evidenced | active |
| PCR-05 | 이번 슬라이스의 trigger는 인증된 checkout 상태 조회이며 정기 worker는 미리 구현하지 않는다 | agent-assumed / reversible | active |

이 계획은 `2026-08-13-web-polar-checkout-integration.md`의 WPC-05를 보완한다.
복귀 자체를 결제 증거로 신뢰하지 않는 원칙은 유지하되, 내부 완료 상태의 출처를 webhook
하나로 제한하지 않고 Polar의 인증된 Checkout/Order 조회까지 확장한다.

## Existing Owner Check

| 동작 | 결과 | 정본 |
| --- | --- | --- |
| Polar Checkout·Order 응답 정규화 | owner-found | `PolarPaymentProvider` |
| provider 중립 reconciliation 호출 | owner-found | `PaymentProvider`, `PaymentsService` |
| checkout 사용자 소유권 | owner-found | `PurchasesService.getByCheckoutId` |
| 상품·금액·통화 검증과 멱등 지급 | owner-found | `PurchasesService.applyEvent` |

검색 근거는 `findCheckout`/`getByCheckoutId` 호출부와 `applyProviderEvent`/`applyEvent`
및 `test/credits.e2e-spec.ts`의 지급·소유권 회귀 테스트다.

## Feature Readiness

- actor: Polar checkout 결제를 마치고 OPOD 복귀 페이지를 조회한 사용자
- trigger: 본인 checkout ID로 상태 조회, 내부 상태가 pending
- happy path: Polar checkout succeeded + paid order + 신뢰 필드 일치 → completed와
  500 크레딧 1회 지급
- edge cases: checkout 미완료, paid order 없음, 소유자·metadata·상품 불일치,
  금액·통화 불일치, webhook과 reconciliation 동시 실행, 반복 조회
- permissions: 기존 Bearer 인증과 DB checkout 소유권 검증 유지
- data rules: provider 응답은 adapter에서 정규화하고 기존 `applyEvent` 검증·잠금·원장을
  그대로 사용
- public errors: 미완료는 기존 pending 응답, provider 무결성 불일치는 지급 없이 오류
- acceptance: webhook 없이도 복귀 조회로 완료되며 반복/후속 webhook이 중복 지급하지 않음
- blocking decision: 0개

## 구현 체크리스트

1. `src/domain/payments/payment-provider.ts`, `payments.service.ts`,
   `polar-payment.provider.ts`
   - provider-neutral reconciliation 입력과 Polar Checkout/Order 조회·정규화 추가
   - 검증: `npm run test -- polar-payment.provider.spec --runInBand`
   - 기대: succeeded+paid만 정규화하고 미완료·불일치는 지급 이벤트를 만들지 않음
2. `src/domain/purchases/purchases.service.ts`, `test/credits.e2e-spec.ts`
   - owner-bound pending 조회에서 reconciliation 후 같은 지급 경로 실행
   - 검증: `npm run test:e2e -- credits.e2e-spec.ts --runInBand`
   - 기대: pending 구매가 completed되고 크레딧·capture·알림이 정확히 1건
3. `docs/07-codebase-guide.md`
   - Web checkout 신뢰 경계와 provider 경계에 직접 reconciliation 정본 기록
   - 검증: format/lint/build와 diff review

## Test Value Gate

테스트는 실제 결제 후 webhook 누락 시 무지급이 영구화되거나, 미완료·불일치 결제에
크레딧을 지급하거나, 반복 조회로 중복 지급하는 고위험 회귀를 검출한다. provider
계약과 최종 DB 결과를 검증하므로 내부 호출 횟수에만 의존하지 않는다.

## 승인

- 구현 승인: 2026-08-23 사용자 `pave:pave 진행해`
- DDL: 없음

## 구현 결과

- `PaymentProvider` 경계에 checkout reconciliation 계약을 추가하고 Polar Checkout과
  Order 응답을 기존 `PaymentEvent`로 정규화했다.
- 인증된 checkout 상태 조회가 pending 구매를 발견하면 reconciliation을 수행하고 기존
  `PurchasesService.applyEvent`를 통해 완료·원장·크레딧·알림을 한 번만 반영한다.
- provider 단위 계약 테스트와 webhook 누락 복구 E2E 테스트를 추가했다.
- 결제 provider 및 Web checkout 신뢰 경계를 `docs/07-codebase-guide.md`에 반영했다.

## 검증 결과

- `npm run test -- polar-payment.provider.spec --runInBand`: 8/8 통과
- `npm run test:e2e -- credits.e2e-spec.ts --runInBand`: 29/29 통과
- `npm run test -- --runInBand`: 26 suites, 194 tests 통과
- `npm run test:e2e`: 10 suites, 94 tests 통과
- `npm run format`, `npm run lint`, `npm run build`, `git diff --check`: 통과
- 첫 전체 E2E 실행에서 기존 local webhook 반복 테스트 1건이 일시적으로 403을
  반환했으나, focused suite와 전체 suite를 새로 실행해 모두 통과함을 확인했다.
