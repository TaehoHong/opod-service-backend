# OPOD 네이티브 알림·결제·소셜 로그인 통합 계획

## 상태

- **Scope revised (2026-08-03): 앱·웹 구현만 승인됨**
- `opod-service-backend`는 future contract 문서화만 승인됨
- backend source, schema, migration, test, package 수정은 승인되지 않았으며 이번
  실행에서 금지됨
- backend 계약은 `docs/native-integrations-handoff.md`에 제안 상태로 기록하며,
  구현·배포·검증 완료로 표시하지 않음

## 목표

이번 승인 범위는 Expo WebView 셸인 `opod-app`과 `opod-web`에 알림, 인앱 결제,
Google/Apple 로그인용 typed bridge와 UI 경계를 붙이는 것이다. 브라우저의 기존
흐름은 유지한다. 아직 존재하지 않는 backend 동작은 구현된 것처럼 가정하지 않고
명시적인 unavailable/pending 상태로 처리한다.

backend의 Apple token verifier, push device/sender/receipt, IAP 검증·멱등 지급·환불
webhook은 후속 구현 계약으로만 남긴다. 이 계약과 보안·schema·test·환경 변수
체크리스트는 `docs/native-integrations-handoff.md`가 canonical handoff다. 실제
backend 구현은 별도 승인과 별도 계획 없이는 시작하지 않는다. 구현으로 검증된
최신 API와 보안 정정은 사용자 소유의 `RN_WEBVIEW_COMPLETE_GUIDE.md` gist에도
반영한다.

## 현재 근거

- 앱은 Expo SDK 57.0.8 / React Native 0.86.0의 단일 WebView 셸이며 현재
  `WEBVIEW_LOADED` 외에는 bridge 기능이 없다. (`repo-evidenced`)
- off-origin URL을 시스템 브라우저로 보내므로 현재 Google/Apple web OAuth는
  WebView localStorage 세션으로 돌아오지 못한다. (`repo-evidenced`)
- 웹은 provider ID token을 `POST /auth/social/:provider`로 교환해 OPOD JWT를
  localStorage에 저장하는 경계가 이미 있다. (`repo-evidenced`)
- backend social provider는 Google만 등록되어 있고 Apple verifier는 없다.
  (`repo-evidenced`)
- backend notification은 인앱 목록/읽음 API뿐이며 device token 저장, push
  sender, receipt pruning은 없다. (`repo-evidenced`)
- backend credit ledger와 네 가지 package는 있지만 production checkout은
  비활성 local stub이고 store transaction 검증 모델은 없다. (`repo-evidenced`)
- `expo-iap` npm package와 config plugin 이름은 유지되며 소스가
  `hyodotdev/openiap` monorepo로 이전됐다. (`primary-source-evidenced`)
- 검증 또는 지급 실패 시 `finishTransaction`을 호출하는 현재 gist 예시는
  entitlement 유실 위험이 있다. 서버 검증 및 멱등 지급 뒤에만 finish해야 한다.
  (`primary-source-evidenced`)
- `opod-web`과 backend에는 사용자 미커밋 변경이 있으므로 기존 diff를 보존하고
  겹치는 파일은 hunk 단위로 수정해야 한다. (`repo-evidenced`)

## 제안하는 기능 계약

### 1. 공통 WebView bridge

- 모든 메시지는 `{ version: 1, type, requestId?, payload }` envelope를 쓴다.
- 웹과 앱 양쪽에서 runtime schema를 검증하고, 알 수 없는 type, malformed JSON,
  허용되지 않은 product/route를 거절한다.
- 웹 → native 요청:
  - `CAPABILITIES_REQUEST`
  - `PUSH_REGISTER_REQUEST`, `PUSH_UNREGISTER_REQUEST`
  - `AUTH_GOOGLE_REQUEST`, `AUTH_APPLE_REQUEST`
  - `IAP_PRODUCTS_REQUEST`, `IAP_PURCHASE_REQUEST`, `IAP_RESTORE_REQUEST`
  - backend 지급 완료 뒤의 `IAP_FINISH_REQUEST`
- native → 웹 응답/이벤트:
  - 공통 request result/error
  - `PUSH_TOKEN_CHANGED`, `NOTIFICATION_OPENED`
  - `AUTH_RESULT`
  - `IAP_PRODUCTS_RESULT`, `IAP_PURCHASE_UPDATED`
- token/JWS/purchase token 원문은 로그, analytics, crash report에 남기지 않는다.
- bridge가 준비되기 전 event는 bounded queue에 보관하고 ready 이후 전달한다.

Observable outcome:
일반 브라우저 기능은 유지되고 OPOD WebView에서만 명시된 native capability가
보인다. 임의 메시지로 외부 URL, 앱 route, 상품을 실행할 수 없다.

### 2. Google·Apple native login

- Google은 Expo가 현재 안내하는 Credential Manager 기반
  `react-native-nitro-google-signin`을 사용하고 development build에 config
  plugin을 적용한다.
- Google native 설정은 backend `GOOGLE_OAUTH_CLIENT_ID`와 같은 Web client ID를
  사용해 ID token audience를 일치시킨다.
- Apple은 `expo-apple-authentication`, `ios.usesAppleSignIn`, config plugin을
  사용한다. `fullName`/`email`은 최초 승인 때만 올 수 있으므로 웹이 기존 social
  login request의 `displayName`과 함께 즉시 전달한다.
- 향후 backend에는 Apple JWKS 기반 verifier가 필요하다. signature, issuer,
  audience, expiry를 검증하고 `sub`를 identity로 사용하는 정확한 future contract는
  `docs/native-integrations-handoff.md`에 정의한다. 이번 범위에서는 구현하지 않는다.
- native provider가 얻은 ID token은 WebView로 반환한다. 웹은 기존
  `authService.socialLogin()`으로 약관 동의와 함께 backend에 보내고, OPOD JWT는
  계속 웹 localStorage 한 곳에만 저장한다.
- 일반 브라우저에서는 기존 server OAuth를 유지한다. embedded provider page를
  WebView 내부에 열지 않는다.

Observable outcome:
앱의 Google/Apple 버튼이 native consent UI를 열고 Google은 기존 backend 경계로
세션을 만들 수 있다. Apple은 future backend contract가 구현되기 전까지 지원 대기
상태를 명시하며, unsupported 응답을 성공으로 표시하지 않는다.

Narrow verification:

- app/web bridge parser와 login adapter unit tests
- future backend Apple verifier와 social endpoint 테스트 계약은 handoff 문서에만
  남기며 이번 실행에서는 작성·수정·실행하지 않음
- development build 실제 기기에서 Google token audience 및 Apple 최초 이름 확인

### 3. 알림 opt-in, token 등록, 수신·탭

- Expo SDK 57 호환 `expo-notifications`를 사용하고 Expo Push Service를 1차
  transport로 쓴다. 이것은 FCM token이 아니라 Expo Push Token이다.
- 앱 시작 즉시 prompt하지 않고 웹 설정의 `알림 설정`에서 사용자가 활성화할 때
  권한을 요청한다. Android channel은 prompt/token 요청 전에 만든다.
- EAS project ID는 `expoConfig.extra.eas.projectId ?? easConfig.projectId`
  fallback으로 읽고 누락 시 설명 가능한 설정 오류를 반환한다.
- foreground/background/cold-start tap, foreground 표시, token rollover를 처리한다.
- 향후 backend의 사용자별 push device PUT/DELETE, token rollover, sender ticket 및
  receipt 처리 계약은 `docs/native-integrations-handoff.md`에 정의한다. 이번
  범위에서는 endpoint, schema, sender를 구현하지 않는다.
- 웹은 localStorage의 기존 OPOD JWT로 device registration API를 호출한다.
  native에 backend JWT를 복제하지 않는다.
- frontend는 backend endpoint가 배포되기 전 registration을 성공으로 표시하지
  않으며 feature availability를 분리한다. 알림 data는 임의 URL 대신 typed target만
  허용한다.

Observable outcome:
설정에서 알림 권한과 native token lifecycle을 처리할 수 있다. 서버 등록·실제
발송·receipt pruning은 future backend contract가 배포되기 전에는 end-to-end
완료로 표시하지 않는다.

Narrow verification:

- app/web의 token rollover, unregister 요청 adapter 테스트
- future backend ownership, sender receipt, invalid-token pruning 테스트는 handoff에만
  정의하고 이번 실행에서는 작성·수정·실행하지 않음
- bridge의 foreground/cold-start navigation tests
- development build에서 APNs/FCM credential이 준비된 실제 push smoke test

### 4. OpenIAP 기반 consumable credit 구매

- package와 plugin은 계속 `expo-iap`을 쓰되 OpenIAP monorepo의 Expo 호환
  release를 정확히 lock한다. Expo Go가 아닌 development build에서 사용한다.
- store product 기본 ID는 기존 backend package key
  `credits_500`, `credits_1050`, `credits_3300`, `credits_5750`로 두고, app/backend
  공통 catalog가 credit amount와 consumable 여부를 명시한다.
- 웹 설정의 `충전하기`는 native runtime에서 store localized price가 표시되는
  구매 sheet를 연다. 일반 웹 결제와 native IAP CTA는 runtime별로 분리한다.
- 앱은 `requestPurchase`의 top-level `type: "in-app"`을 명시하고 callback/listener
  purchase를 처리한다. iOS/Android 모두 공통 `purchaseToken`을 backend에 보낸다.
- 향후 backend 검증 adapter, catalog 대조, store transaction identity, 멱등 지급
  transaction/lock 계약은 `docs/native-integrations-handoff.md`에 정의한다. 이번
  범위에서는 verifier, schema, credits endpoint를 구현하지 않는다.
- **서버가 검증 및 지급 완료를 응답한 뒤에만** 앱이
  `finishTransaction({ isConsumable: true })`을 호출한다. timeout, network/5xx,
  검증 미완료 때는 finish하지 않고 unfinished purchase recovery로 재시도한다.
- store purchase는 기존 local refund endpoint에서 처리하지 않는다. future refund
  source-of-truth인 App Store Server Notifications V2 / Google RTDN, 멱등 reversal
  계약은 handoff 문서에만 남긴다.

Observable outcome:
앱은 서버가 `canFinish: true`인 검증·지급 완료 응답을 준 경우에만 transaction을
finish한다. future endpoint가 없거나 pending/error이면 finish하지 않고 복구 가능한
상태로 보존한다. backend 구현 전 sandbox E2E 성공을 주장하지 않는다.

Narrow verification:

- app/web의 success/invalid/pending/network-error 계약 및 unfinished recovery tests
- future backend verifier, replay, idempotency/concurrency tests는 handoff에만 정의하고
  이번 실행에서는 작성·수정·실행하지 않음
- purchase → grant → finish 및 unfinished recovery bridge tests
- future backend refund/revoke 중복 delivery reversal tests는 handoff에만 정의
- backend 검증 endpoint가 배포된 뒤에만 App Store/Play sandbox E2E smoke test

### 5. 설정, 환경 변수, 문서

- app config에 development build, notifications, Apple, Google, IAP plugin과
  최소 권한만 선언한다. 존재하지 않는 `NSUserNotificationUsageDescription`이나
  무관한 카메라/저장소 권한은 추가하지 않는다.
- app/web 환경 예시에 EAS project ID, Google Web client ID/iOS URL scheme 등
  frontend가 실제 소비하는 값만 secret 없이 문서화한다.
- backend 환경 변수와 향후 social verifier, push, store verifier/ledger 경계는
  `docs/native-integrations-handoff.md`에만 체크리스트로 기록한다.
- 조사 근거는 `opod-app/docs/native-integrations-research.md`에 유지한다.

## 예상 파일 경계

### `opod-app`

- `package.json`, `pnpm-lock.yaml`, `app.json` 또는 dynamic app config, `eas.json`
- `components/web-view.tsx`, `lib/injected.ts`
- `lib/native-bridge/*`, `lib/notifications/*`, `lib/social-auth/*`, `lib/iap/*`
- `.env.example`, README, 관련 unit tests

### `opod-web`

- native bridge client와 runtime schemas
- `SocialLoginButtons`, Settings의 알림/충전 UI
- auth/notifications/credits API client types와 services
- 관련 unit tests

### `opod-service-backend`

- **이번 승인 범위:** `.codex/pave/plans/native-app-integrations.md`,
  `docs/native-integrations-handoff.md` 문서만
- **이번 실행에서 금지:** `src/**`, `prisma/schema.prisma`, `prisma/migrations/**`,
  `test/**`, `*.spec.ts`, package manifest/lockfile, `.env*`, Swagger 구현 변경
- Apple verifier, push schema/sender, IAP verifier/ledger/webhook은 handoff에 적힌
  future scope이며 별도 승인 전에는 수정하지 않음

기존 미커밋 message/follow/bond 및 web dependency/UI 변경은 되돌리거나 덮어쓰지
않는다. 향후 backend 구현이 별도로 승인되더라도 Prisma migration은 현재 사용자
schema 변경을 포함하지 않도록 baseline과 생성 SQL을 별도로 검토한다.

## Gist 갱신 계약

구현과 검증이 끝난 정확한 version/API를 기준으로 다음을 함께 수정한다.

- `expo-iap` package 이름 유지 + OpenIAP monorepo 이전 설명
- 검증/지급 전 `finishTransaction` 금지, `purchaseToken`, current request/restore API
- Expo Push Token 명칭, project ID fallback, token rollover, cold start, receipt pruning
- embedded WebView OAuth 제거, random state/PKCE 또는 native SDK, route allowlist
- exact-origin/runtime schema bridge 검증
- 실제 Expo privacy manifest 경로와 최소 권한
- 컴파일 오류 및 구현되지 않은 download/auto-restart/production-complete 주장
- 실제 앱에서 검증한 Expo/RN/expo-iap 고정 버전과 테스트 범위

현재 `gh`의 저장된 GitHub token 두 개는 모두 만료되어 CLI write는 불가능하다.
구현 완료 뒤 gist remote revision을 다시 확인하고, 사용 가능한 소유자 browser
session 또는 재인증된 CLI로 optimistic-concurrency 확인 후 업데이트한다. 인증이
없으면 완성된 patch 파일까지 준비하고 사용자에게 로그인만 요청한다.

## 최종 검증

구현 완료 전 새로 실행하고 실제 결과만 보고한다.

App:

1. `pnpm exec tsc --noEmit`
2. bridge/unit tests
3. `npx expo install --check`
4. `npx expo-doctor`
5. development build 실제 기기 smoke tests (credential이 제공된 항목)

Web:

1. 변경된 테스트
2. `pnpm lint`
3. `pnpm build`

Backend:

1. 두 문서의 diff와 `git diff --check` 확인
2. sample JSON 문법, 링크, 상태 표기 검토
3. 이번 문서 작업으로 backend source/schema/migration/test/package에 새 변경이
   생기지 않았음을 작업 전후 파일 목록으로 확인
4. backend build/test/migration은 실행하지 않음 — 구현 승인이 없는 future contract라
   검증 완료를 주장하지 않음

Gist:

1. latest revision 재확인
2. `git diff --check`
3. 링크와 code sample 검토
4. update 뒤 새 revision 재조회

## 이번 범위에서 제외

- Gist의 카메라, 파일 다운로드, 위치, 생체인증 등 사용자가 지정하지 않은 기능
- 새로운 도메인 notification 비즈니스 이벤트 발명
- App Store Connect, Play Console, APNs, FCM, Google, Apple 계정에서의 credential
  생성 또는 유료 프로그램 가입
- 운영 DB migration deploy와 production store release
- 지역별 외부결제 entitlement 프로그램 채택

## 승인 게이트

사용자는 `opod-app`과 `opod-web`의 native integration 작업만 승인했다. backend는
future contract 문서화만 승인됐으며 구현은 승인되지 않았다. 따라서
`opod-service-backend`의 source, schema, migration, test, package는 이 계획을
근거로 수정할 수 없다. backend 구현은 handoff의 open decision을 확정하고 별도
PAVE 계획과 명시적 승인을 받은 뒤 시작한다.
