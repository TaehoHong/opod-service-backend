# Web → Backend → Polar 결제 연결 계획

## 목표

브라우저 사용자가 프로필에서 Web 크레딧 상품을 선택하고 Polar checkout으로
이동한 뒤, OPOD 복귀 페이지에서 서명 webhook 기반 결제 완료를 확인할 수 있게 한다.

## 확정 범위

- `opod-web`: Web 상품 조회, checkout 생성, top-level 이동, 복귀 상태 polling,
  완료 후 프로필 복귀
- `opod-service-backend`: 허용된 Web 복귀 URL 검증, 사용자 소유 checkout 조회 API
- Polar 공식 `{CHECKOUT_ID}` success URL 치환 사용
- 기존 native IAP, Polar webhook 지급, 환불 정책은 유지
- 실제 Polar 과금과 Sandbox Dashboard 설정은 이번 로컬 구현에서 실행하지 않음

## 결정 원장

| ID | 결정 | 근거 | 상태 |
| --- | --- | --- | --- |
| WPC-01 | Web `충전하기`는 browser에서 Polar 상품 모달을 연다 | user-confirmed | active |
| WPC-02 | native bridge가 준비된 앱은 기존 IAP를 유지한다 | repo-evidenced | active |
| WPC-03 | success는 `/profile/payment-return?checkout_id={CHECKOUT_ID}`, return은 `/profile`만 허용한다 | user-confirmed / externally-evidenced | active |
| WPC-04 | 허용 origin은 `WEB_APP_URL`, 기존 배포 Web origin, localhost/127.0.0.1이다 | user-confirmed / repo-evidenced | active |
| WPC-05 | 완료 판정은 checkout 복귀가 아니라 `order.paid` webhook이 만든 내부 구매 상태다 | externally-evidenced / repo-evidenced | active |

## Existing Owner Check

| 동작 | 결과 | 정본 |
| --- | --- | --- |
| 인증 HTTP 호출 | owner-found | `opod-web/src/api-client/api-client.ts` |
| 구매·checkout 상태 | owner-found | `PurchasesService`, `PurchasesController` |
| Polar checkout/webhook | owner-found | `PolarPaymentProvider` |
| Web dialog 디자인 | owner-found | `Modal`, `IapPurchaseModal`, CSS tokens |
| 인증 라우트 보호 | owner-found | `/profile` prefix의 `RouteGuard` |
| 복귀 URL allowlist | owner-absent | `PurchasesService` checkout 경계에 추가 |

## 수직 슬라이스

1. Backend 계약
   - checkout URL을 origin/path/query allowlist로 검증한다.
   - `GET /purchases/checkouts/:checkoutId`가 인증 사용자의 구매만 반환한다.
   - E2E로 외부 redirect 차단, 소유권, 상태 조회를 검증한다.
2. Web checkout
   - purchase API client와 기존 디자인 토큰 기반 Web 충전 모달을 추가한다.
   - 상품 로딩/빈 목록/오류/선택/checkout 생성 중 상태를 표시한다.
   - checkout 응답 URL로 top-level 이동한다.
3. Web 복귀
   - 공식 `checkout_id`로 사용자 소유 구매 상태를 polling한다.
   - 완료/실패/처리 지연/잘못된 접근 상태를 표시하고 프로필로 돌아간다.
4. 문서와 검증
   - Polar 아키텍처 문서와 Backend 코드베이스 가이드를 현재 구현에 맞춘다.
   - Web lint/build/Playwright, Backend lint/unit/E2E/build를 실행한다.

## 수용 조건

- Browser의 `충전하기`에서 활성 Polar 상품을 선택할 수 있다.
- checkout 생성 성공 시 같은 창이 Polar URL로 이동한다.
- 임의 외부 success/return URL은 Backend가 거절한다.
- 복귀 checkout ID로 다른 사용자의 구매를 조회할 수 없다.
- success 복귀만으로 지급 완료라 하지 않고 webhook 완료 상태까지 기다린다.
- native IAP 동작은 변경되지 않는다.

## 실행 결과

- Web 상품 Modal, checkout API client, top-level Polar 이동 구현
- `/profile/payment-return`의 owner-bound checkout polling과 상태 UI 구현
- Backend 복귀 URL allowlist, `WEB_APP_URL` CORS, checkout 단건 조회 구현
- 아키텍처 문서와 Backend capability catalog 동기화

## 검증

- Web production build 성공, 결제 API/기존 Native 회귀 7개 성공
- Backend lint/build, unit 155개, 결제 집중 E2E 25개 성공
- Backend 전체 E2E 82개 중 81개 성공
  - Polar 범위 밖 기존 문의 동시 제출 test가 pool 종료 `ECONNRESET`으로 실패하며
    단독 재실행에서도 재현
- 실제 Polar Sandbox 과금은 credential과 외부 설정이 필요한 다음 승인 작업으로 유지
