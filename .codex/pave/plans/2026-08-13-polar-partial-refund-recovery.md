# Polar 부분 환불 비례 크레딧 회수 계획

## 범위

- 상위 우선순위: Polar 작업 3번
- 목표: Polar의 누적 부분 환불액만큼만 유상 크레딧을 회수하고 webhook replay와
  반복 부분 환불에서도 중복 회수하지 않는다.
- 상태: 구현 및 전체 검증 완료

## 현재 문제

- `order.refunded`는 부분 환불에도 오지만 현재 `forceReversal`은 원 구매의 크레딧을
  전부 회수하고 Payment/Purchase를 즉시 `reversed`로 만든다.
- Polar의 `refunded_amount`는 누적 세전 환불액인데 현재 event는 누적값과 개별
  환불액을 구분하지 않는다.
- 결제 당시 `net_amount`와 `tax_amount`를 저장하지 않아 Polar Refund API가 요구하는
  세전 금액 기준으로 사용자 환불을 계산할 수 없다.
- 사용한 무상 프로모션까지 유상 부채로 바꾸는 현재 사용자 환불 처리는 승인된
  정책과 충돌한다.

## 확정 정책과 근거

| ID     | 정책                                                                                                         | 근거                                   | 상태                                          |
| ------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------------------- |
| PRR-01 | Polar 자체 환불도 누적 환불 비율만큼 자동 회수한다                                                           | 사용자 확정, 실제 환불과 크레딧 정합성 | active, user-confirmed                        |
| PRR-02 | 유상 기본·유상 프로모션의 누적 회수 목표는 `floor(최초 유상 크레딧 × 누적 세전 환불액 ÷ 주문 세전 금액)`이다 | 사용자 확정                            | active, user-confirmed                        |
| PRR-03 | 무상 프로모션은 남은 수량만 전액 회수하고 사용분은 유상 부채로 만들지 않는다                                 | 사용자 확정, 소비자보호 위험 완화      | active, user-confirmed                        |
| PRR-04 | Polar 사용자 귀책 환불의 5% 수수료는 세전 환불 대상액 기준이다. Polar이 관련 세금을 비례 환불한다            | 사용자 확정, Polar Refund 계약         | active, user-confirmed / externally-evidenced |
| PRR-05 | 회사 귀책·법정 청약철회·과오금의 수수료 면제 정책은 유지한다                                                 | 기존 정책                              | active, repo-evidenced                        |

공식 Polar 근거:

- `order.refunded`는 전액·부분 환불 모두 발생하며 Order의 `refunded_amount`와
  `refunded_tax_amount`를 전달한다.
- Refund API 입력 금액은 세전 금액이고 Polar이 부분 환불 세금을 비례 계산한다.
- Order 상태는 `partially_refunded`와 `refunded`를 구분한다.

## Existing Owner Check

| 동작                             | 결과        | 근거와 계획                                                      |
| -------------------------------- | ----------- | ---------------------------------------------------------------- |
| Polar refund payload 정규화      | owner-found | `PolarPaymentProvider.verifyEvent`와 전용 spec을 확장            |
| provider-neutral 환불 event 계약 | owner-found | `PaymentEvent`를 누적 환불 필드로 확장                           |
| 결제 당시 net/tax snapshot       | owner-found | `Payment`에 저장하고 paid event 처리에서 기록                    |
| 누적 환불·상태 전이·멱등 회수    | owner-found | `PurchasesService.applyEvent`와 `PaymentLedger` 이력을 확장      |
| 구매 연결 크레딧 분류            | owner-found | `CreditsService.getPurchaseCreditSnapshotWithClient` 결과를 사용 |
| 무상 프로모션 회수분 구분        | owner-found | `CreditRefund` breakdown에 free promotion 회수량을 추가          |

## 구현 수직 슬라이스

1. Polar 결제·환불 snapshot 저장
   - 파일: `prisma/schema.prisma`, 생성 migration,
     `src/domain/payments/payment-provider.ts`,
     `src/domain/payments/polar-payment.provider.ts`,
     `src/domain/purchases/purchases.service.ts`
   - 결과: paid event의 net/tax를 Payment에 저장하고 `order.refunded`의 주문 세전액,
     누적 환불액, 환불 세금, 통화를 검증·정규화한다.
   - 좁은 검증: `npm run test -- polar-payment.provider.spec --runInBand`

2. 누적 부분 환불 비례 회수
   - 파일: `prisma/schema.prisma`, 생성 migration,
     `src/domain/purchases/purchases.service.ts`, `test/credits.e2e-spec.ts`
   - 결과: PaymentLedger의 기존 환불액과 CreditRefund의 기존 회수량을 기준으로 이번
     증가분만 회수한다. 부분 환불은 Payment만 `partially_refunded`, 전액 provider
     환불은 기존 `reversed`로 전환한다. Purchase는 부분 환불 중 `completed`를
     유지한다.
   - 보호할 결함: 50% 환불에 100% 크레딧 회수, 반복 event의 중복 회수, 누적 감소·
     원금 초과 수용.
   - 좁은 검증: `npm run test:e2e -- credits.e2e-spec.ts`

3. 승인된 무상 프로모션·세전 수수료 정책 정합화
   - 파일: `src/domain/purchases/purchases.service.ts`,
     `test/credits.e2e-spec.ts`
   - 결과: 사용자 환불도 남은 무상 프로모션만 회수하고 사용분 부채를 만들지 않는다.
     Polar 환불 견적과 API 요청은 저장된 net amount를 사용한다. 기존 Polar 결제에
     net snapshot이 없으면 잘못된 환불 대신 명시적으로 거절한다. local provider와
     다른 결제 provider 동작은 유지한다.
   - 보호할 결함: 무료 혜택 사용분의 유상 부채 전환, 세금 포함 total을 Polar Refund
     API에 보내는 초과 환불 요청.
   - 좁은 검증: `npm run test:e2e -- credits.e2e-spec.ts`

4. 정본 문서 동기화
   - 파일: `docs/credit-policy.md`, `docs/payment-refund-test-usecases.md`,
     `docs/07-codebase-guide.md`, `../docs/polar-payment-architecture.md`
   - 결과: 승인된 무료 프로모션·세전 수수료·누적 부분 환불 계약과 자동화 상태를
     기록하고 우선순위 3을 완료로 전환한다.

## Feature Readiness

- actor: OPOD 환불 사용자 또는 Polar 위험관리 환불의 영향을 받는 구매 사용자
- trigger: OPOD 환불 요청 또는 서명 검증된 Polar `order.refunded`
- happy path: 누적 환불 증가분 계산 → 해당 유상 크레딧 비례 회수 → 남은 무상
  프로모션 회수 → 원장과 상태를 한 transaction에서 반영
- edge cases: tax inclusive/exclusive, 여러 부분 환불, 같은 event replay, 다른 event의
  같은 누적액, 누적액 감소/초과, 이미 사용한 유상·무상 크레딧, 진행 중 OPOD 환불
- permissions: 사용자 환불 API는 본인 구매만, webhook은 Polar 서명 필수
- data rules: 누적 환불액 ≤ 원 주문 net, 누적 유상 회수량 ≤ 최초 유상 지급량,
  사용된 무상 프로모션은 부채 0
- public error: 과거 Polar 결제에 net snapshot이 없으면 환불 불가를 명시하고 운영
  확인; 잘못된 provider 누적액은 event failed 처리
- acceptance: 50%→75%→100% 누적 환불이 각각 증가분만 회수하며 replay는 0회수,
  무상 프로모션 사용분은 음수 유상 잔액을 만들지 않음
- preserve-current-behavior: checkout·paid 지급, local 환불, Apple/Google reversal,
  회사 귀책·법정 환불의 수수료 면제 정책
- deferred: 실제 Polar Sandbox, 환불 예상 세금의 사용자 화면 표시, 운영자 수동 보정
- out-of-scope: Web UI, Customer Portal 환불 기능, chargeback 취소 복원

## 전체 검증

1. `npm install`
2. `npm run db:generate`
3. `npm run format`
4. `npm run lint`
5. `npm run test -- --runInBand`
6. `npm run test:e2e`
7. `npm run build`
8. `git diff --check`

## 구현 결과

- `Payment`에 Polar `net_amount`/`tax_amount` snapshot을 저장하고
  `CreditRefund`에 `free_promotion_amount` breakdown을 추가했다.
- `order.refunded`의 누적 세전 환불액 증가분만 금전 원장에 기록하고,
  기본 유상·유상 프로모션 회수 목표를 비례 계산한다.
- 동일 누적액 replay는 추가 회수하지 않으며 부분 환불은
  `partially_refunded`, 누적 전액은 `reversed`로 전환한다.
- 남은 무상 프로모션만 회수하고 이미 사용한 무상분은 유상 부채로
  만들지 않는다.
- Polar 사용자 환불 견적과 5% 수수료는 세전 결제액을 기준으로 계산한다.

## 검증 결과

- `@polar-sh/sdk@0.49.0` exact 설치 확인
- Prisma Client 생성 성공
- 빈 PostgreSQL에 전체 24개 migration 순차 적용 성공
- lint 성공
- unit 155/155 성공, Polar provider 4/4 성공
- 결제·크레딧 집중 E2E 21/21 성공
- 전체 E2E 78/78 성공
- production build와 `git diff --check` 성공
- 변경 범위 파일 format 성공
- 저장소 전체 format은 변경 범위 밖 기존
  `src/domain/payments/google-play-iap.provider.ts` 1건 때문에 실패
- 실제 Polar Sandbox E2E는 credential과 Dashboard 구성이 필요해 후속 P0로 유지
