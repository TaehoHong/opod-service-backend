# 네이티브 통합 backend handoff

> 상태: **제안 / 미구현**
> 작성일: 2026-08-03
> 현재 승인 범위: `opod-app`, `opod-web` 구현 + 이 backend 계약 문서
> 현재 금지 범위: backend source, schema, migration, test, package 수정

이 문서는 네이티브 앱 작업이 향후 backend에 기대하는 계약을 고정한다. 아래의
endpoint, table, worker, verifier, webhook은 아직 존재하지 않으며 구현·배포·sandbox
검증됐다는 뜻이 아니다. backend 작업은 별도 PAVE 계획과 명시적 승인 후 시작한다.

현재 저장소에서 확인된 기준선은 다음과 같다.

- `POST /auth/social/:provider`와 `SocialIdentityProvider` 경계는 있으나 provider는
  Google만 등록돼 있다.
- `GET /notifications`, `PATCH /notifications/:id/read`는 인앱 알림 목록·읽음만
  제공한다. push device, sender, ticket/receipt 처리는 없다.
- credit ledger, purchase, refund 모델은 있으나 production store 검증은 없고
  checkout/payment webhook은 local stub 상태다.
- 기존 `POST /credits/payment-webhooks/:provider`와
  `POST /credits/refund-webhooks/local`은 App Store/Play webhook으로 재사용하지
  않는다.

## 1. 범위와 우선순위

| 우선순위 | future backend slice | frontend 차단 여부 | 완료 조건 |
| --- | --- | --- | --- |
| P0 | Apple ID token verifier + `POST /auth/social/apple` | Apple 로그인 차단 | 실제 Apple JWKS 검증, 신규/재로그인 E2E |
| P0 | push device register/unregister | 서버 등록 차단 | 소유권, rollover, revoke API와 DB 제약 검증 |
| P0 | IAP catalog/intent/verify + 멱등 credit grant | 결제 완료 차단 | 검증·지급 후에만 `canFinish: true` |
| P1 | push outbox/sender/ticket/receipt worker | 실제 push 발송 차단 | ticket 저장, receipt poll, invalid token revoke |
| P1 | Apple/Google refund·revoke webhook | 운영 결제 차단 | 서명 검증, durable inbox, 멱등 reversal |
| P2 | reconciliation job, 운영 지표, dead-letter 도구 | 운영 안정성 차단 | 누락 event 재조회와 alert/runbook |

P0가 배포되기 전 frontend는 해당 기능을 성공으로 표시하지 않는다. 특히 IAP은
backend 응답에 명시적으로 `canFinish: true`가 없으면 native transaction을 finish하면
안 된다.

## 2. 공통 HTTP 규칙

- public user endpoint는 기존과 같이 `Authorization: Bearer <OPOD access token>`을
  사용한다.
- request/response는 `application/json`, 시간은 UTC ISO 8601, 내부 ID는 UUID다.
- access token, Apple ID token, Expo Push Token, store purchase token/JWS, webhook
  원문은 application log, analytics, tracing attribute, error message에 기록하지 않는다.
- 새 endpoint의 programmatic error는 아래 additive envelope를 사용한다. 기존 Nest
  `statusCode`/`message` 소비자는 유지되고, 새 frontend는 `code`를 우선 분기한다.

```json
{
  "statusCode": 409,
  "code": "IAP_TRANSACTION_OWNED_BY_ANOTHER_USER",
  "message": "이미 다른 계정에 연결된 구매입니다"
}
```

- 외부 provider 장애는 client 입력 오류와 구분한다. retry 가능한 오류에는 다음처럼
  `details.retryable`과 `retryAfterSeconds`를 준다.

```json
{
  "statusCode": 503,
  "code": "IAP_VERIFIER_UNAVAILABLE",
  "message": "구매 확인이 지연되고 있습니다",
  "details": {
    "retryable": true,
    "retryAfterSeconds": 15,
    "canFinish": false
  }
}
```

- unknown body field는 DTO whitelist로 제거하거나 거절하고, 문자열 길이·enum·UUID를
  controller/DTO에서 검증한다. provider 응답과 webhook은 `unknown`에서 runtime
  parsing한다.

## 3. Apple 소셜 로그인

### 3.1 Public API

기존 social login API를 확장한다.

```http
POST /auth/social/apple
Content-Type: application/json
```

```json
{
  "idToken": "<apple-identity-token-jws>",
  "nonce": "<single-use-raw-nonce>",
  "displayName": "홍태호",
  "consents": [
    { "type": "terms_of_service", "agreed": true },
    { "type": "privacy", "agreed": true },
    { "type": "age_14", "agreed": true }
  ]
}
```

| 필드 | 타입 | 계약 |
| --- | --- | --- |
| `idToken` | string | 필수. Apple credential의 identity token JWS |
| `nonce` | string | native가 Apple 요청에 전달한 동일 nonce. 최대 256 bytes, 한 번만 사용 |
| `displayName` | string? | 최초 Apple 승인에서 받은 이름 fallback. 이후에는 오지 않을 수 있음 |
| `consents` | array? | 기존 social signup과 같은 계약. 신규 가입 때만 필수 동의 검증 |

성공 response는 기존 Google social login과 동일한 session shape를 유지한다.

```json
{
  "user": {
    "id": "0198a4b8-5d85-7b21-a2d4-76d66e9f80d0",
    "displayName": "홍태호",
    "bio": "",
    "email": "user@privaterelay.appleid.com"
  },
  "accessToken": "<opod-access-token>",
  "refreshToken": "<opod-refresh-token>"
}
```

`profileImageUrl`의 실제 optional/null 표현은 기존 login mapper와 일치시킨다. 이
handoff가 기존 session response를 별도 shape로 바꾸라는 뜻은 아니다.

### 3.2 Verifier 불변식

Apple adapter는 기존 `SocialIdentityProvider` 경계에 `provider = "apple"`로
등록하되 다음을 모두 만족해야 한다.

1. Apple 고정 issuer `https://appleid.apple.com`을 검사한다.
2. Apple JWKS에서 `kid`를 찾고 RS256 signature를 검증한다. JWKS URL은 사용자
   입력이나 일반 환경 변수로 바꾸지 않는다.
3. `aud`가 `APPLE_OAUTH_AUDIENCES` allowlist 중 정확히 하나와 일치해야 한다.
   최소 native bundle ID `com.opod.app`, web flow를 지원하면 해당 Service ID만
   추가한다.
4. `exp`, `iat`, `sub`를 검사하고 clock skew는 작고 명시적인 값으로 제한한다.
5. native는 random nonce를 `AppleAuthentication.signInAsync({ nonce })`에 전달하고
   같은 값을 이 endpoint에 보낸다. verifier는 JWT nonce claim과 constant-time exact
   비교하고 nonce의 keyed hash를 짧은 TTL로 소비 처리해 replay를 막는다.
6. verified email claim만 정규화해 반환한다. Apple private relay 주소도 일반 email과
   동일하게 취급하며 실주소를 추론하지 않는다.
7. identity key는 email이 아니라 `sub`다. `UserAccount(provider,
   providerAccountId)`의 기존 unique 경계를 재사용한다.
8. 알 수 없는 `kid`일 때 JWKS를 한 번 refresh하되, network/JWKS 오류에서 검증을
   우회하지 않는다. cache TTL과 stale-on-network-error 상한을 명시한다.
9. ID token 원문과 claim 전체를 로그에 남기지 않는다.

### 3.3 Error contract

| HTTP | `code` | 의미 |
| --- | --- | --- |
| 400 | `SOCIAL_ID_TOKEN_REQUIRED` | token 누락·빈 값 |
| 400 | `SOCIAL_NONCE_REQUIRED` | nonce가 필요한 flow인데 누락 |
| 400 | `SOCIAL_PROVIDER_UNSUPPORTED` | 미등록 provider |
| 401 | `SOCIAL_TOKEN_INVALID` | signature/issuer/audience/expiry/nonce 실패 |
| 503 | `SOCIAL_KEYSET_UNAVAILABLE` | refresh 후에도 Apple keyset을 검증할 수 없음 |

보안을 위해 401 response는 어느 claim이 틀렸는지 외부에 상세 노출하지 않는다.

### 3.4 Schema 체크리스트

- [ ] 현재 `UserAccount.provider` string과 `[provider, providerAccountId]` unique로
      Apple identity를 수용할 수 있는지 migration 없이 검증
- [ ] nonce replay 방지가 process memory가 아닌 TTL-capable shared storage를 필요로
      하는지 결정
- [ ] `users.email`이 아니라 `user_accounts.email`에 verified email을 저장하는 현재
      Google 정책 유지
- [ ] 같은 email의 Google/Apple 계정을 자동 연결하지 않음
- [ ] 최초 이름 저장 뒤 후속 로그인에서 빈 이름으로 덮어쓰지 않음

### 3.5 테스트 체크리스트

- [ ] valid signature, issuer, native audience, web Service ID audience
- [ ] wrong signature, unknown `kid`, wrong issuer/audience, expired/not-yet-valid token
- [ ] nonce success, missing, mismatch, replay, concurrent replay
- [ ] JWKS cache hit, key rotation refresh, timeout/invalid JWKS fail-closed
- [ ] 최초 Apple 가입에서 이름·email 저장, 재로그인에서 누락된 이름 보존
- [ ] 동일 Apple `sub` 동시 가입이 사용자 한 명만 생성
- [ ] token·claims가 logs에 포함되지 않는지 검사
- [ ] `POST /auth/social/apple` 신규 가입/재로그인/필수 약관 E2E

## 4. Push device 등록과 해제

### 4.1 Device identity

- 앱은 설치마다 UUID `installationId`를 생성해 Keychain/Keystore에 보관한다.
- token rollover가 발생해도 같은 `installationId`로 PUT한다.
- Expo Push Token은 FCM token이라고 부르지 않는다. 이 계약의 최초 transport는
  `expo`다.
- raw token은 전송에 필요하므로 envelope encryption해서 저장하고, 조회·unique
  비교용 `tokenHash`를 별도로 둔다. response에는 raw/encrypted token을 반환하지
  않는다.

### 4.2 Register/upsert API

```http
PUT /notifications/push-devices/0198a4df-6e86-7c53-a21d-86f0f0452ca7
Authorization: Bearer <OPOD access token>
Content-Type: application/json
```

```json
{
  "transport": "expo",
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "ios",
  "projectId": "6bc3db6a-f8ab-4a66-84ec-c9979f3cb94d",
  "appId": "com.opod.app",
  "appVersion": "1.4.0"
}
```

규칙:

- path `installationId`: UUID, 앱 설치 identity
- `transport`: 현재 `expo`만 허용
- `platform`: `ios | android`
- `token`: Expo token parser로 형식 검증, 최대 길이 제한, 로그 redaction
- `projectId`: 허용 EAS project ID allowlist와 정확히 일치
- `appId`: 허용 bundle/package ID allowlist와 정확히 일치
- `appVersion`: 표시·rollout 진단용 문자열, 최대 64자

신규 등록과 동일 설치의 갱신은 모두 **200 OK**로 통일한다.

```json
{
  "device": {
    "id": "0198a4e1-6432-739e-b560-e1f4784ebf95",
    "installationId": "0198a4df-6e86-7c53-a21d-86f0f0452ca7",
    "transport": "expo",
    "platform": "ios",
    "projectId": "6bc3db6a-f8ab-4a66-84ec-c9979f3cb94d",
    "appId": "com.opod.app",
    "appVersion": "1.4.0",
    "status": "active",
    "lastSeenAt": "2026-08-03T08:20:30.000Z"
  }
}
```

동일 installation 또는 token이 다른 사용자에게 활성 등록돼 있으면 PUT 요청의
현재 인증 사용자를 새 owner로 원자적으로 이전하고 이전 association을 revoke한다.
이는 같은 기기에서 logout이 중단된 뒤 다른 사용자가 로그인했을 때 이전 계정의
알림이 계속 도착하는 것을 막기 위한 정책이다. 이전/신규 user ID와 token 원문은
일반 log에 남기지 말고 보안 audit event만 기록한다.

### 4.3 Unregister API

```http
DELETE /notifications/push-devices/0198a4df-6e86-7c53-a21d-86f0f0452ca7
Authorization: Bearer <OPOD access token>
```

- 현재 사용자 소유의 active registration을 `revoked`로 바꾼다.
- 이미 없거나 revoke된 경우도 **204 No Content**로 처리해 멱등성을 보장한다.
- 다른 사용자 소유 installation의 존재 여부는 노출하지 않고 동일하게 204를 준다.
- logout 전에 호출하며, 계정 탈퇴 시 해당 사용자의 모든 device를 revoke한다.

### 4.4 Error contract

| HTTP | `code` | 의미 |
| --- | --- | --- |
| 400 | `PUSH_INSTALLATION_ID_INVALID` | UUID가 아님 |
| 400 | `PUSH_TOKEN_INVALID` | transport token 형식 오류 |
| 400 | `PUSH_PLATFORM_INVALID` | 허용하지 않은 platform |
| 403 | `PUSH_PROJECT_NOT_ALLOWED` | project/app allowlist 불일치 |
| 429 | `PUSH_REGISTRATION_RATE_LIMITED` | user/install/IP 등록 과다 |
| 503 | `PUSH_REGISTRATION_UNAVAILABLE` | storage/encryption 일시 장애 |

### 4.5 Future schema

`PushDevice` 제안 필드:

| 필드 | 제약/용도 |
| --- | --- |
| `id` | UUIDv7 PK |
| `userId` | User FK, index |
| `installationId` | UUID, project 내 unique |
| `transport` | `expo` enum/string allowlist |
| `tokenCiphertext` | envelope-encrypted token, 애플리케이션 조회 제한 |
| `tokenHash` | keyed HMAC 권장, `(transport, tokenHash)` unique |
| `platform` | `ios | android` |
| `projectId`, `appId`, `appVersion` | allowlist 검증 및 rollout 진단 |
| `status` | `active | revoked | invalid` |
| `lastSeenAt`, `revokedAt`, `createdAt`, `updatedAt` | timestamptz |

필수 DB 제약:

- [ ] unique `(project_id, installation_id)`
- [ ] unique `(transport, token_hash)`
- [ ] active send query index `(user_id, status)`
- [ ] user delete/withdrawal 시 revoke 또는 정책에 맞는 cascade
- [ ] key rotation을 위한 ciphertext key version

### 4.6 Device API 테스트 체크리스트

- [ ] 인증 없는 PUT/DELETE 거절, 탈퇴 사용자 거절
- [ ] 최초 PUT과 동일 payload 재시도가 row 한 건인 멱등 upsert
- [ ] 같은 installation의 token rollover가 이전 token을 active로 남기지 않음
- [ ] 같은 token의 installation metadata 갱신과 platform/project mismatch 거절
- [ ] 다른 사용자 로그인 시 이전 association revoke + 새 owner 이전이 한 transaction
- [ ] 이전 사용자에게 transfer 뒤 push가 발송되지 않음
- [ ] DELETE 반복이 모두 204이고 다른 사용자 installation 존재 여부를 노출하지 않음
- [ ] 계정 탈퇴 시 active device가 모두 revoke됨
- [ ] ciphertext key rotation read/write와 token HMAC unique 충돌
- [ ] response, logs, exceptions, test snapshots에 raw token이 없음

## 5. Push sender, ticket, receipt

public 임의-send endpoint는 만들지 않는다. 도메인 producer는 기존 인앱
`Notification`을 생성하는 transaction에서 `PushOutbox`를 함께 기록한다.

### 5.1 Typed payload

임의 URL을 data에 넣지 않는다. sender가 허용하는 payload는 다음 shape다.

```json
{
  "version": 1,
  "type": "notification.open",
  "notificationId": "0198a501-70d1-79fb-a4b4-5c6066d0bd65",
  "target": {
    "type": "conversation",
    "id": "0198a502-a7cb-7f41-a869-6bed568287f2"
  }
}
```

`target.type`은 backend와 frontend가 공유하는 allowlist만 허용한다. 초기 제안은
`notification | character | conversation | post | settings`이며 target별 `id`
필수 여부와 사용자의 접근 권한을 producer에서 확인한다.

### 5.2 Outbox/delivery lifecycle

```text
Notification + PushOutbox commit
  -> sender가 active PushDevice별 PushDelivery 생성
  -> Expo send API ticket 저장
  -> receipt 조회 가능 시점 이후 receipt poll
  -> ok: delivered
  -> DeviceNotRegistered: device invalid/revoke
  -> retryable provider error: backoff 재시도
  -> permanent error/max attempts: dead_letter + alert
```

`PushOutbox` 제안 필드:

- `id`, `notificationId` unique, `userId`, `payload` JSON
- `status: queued | processing | completed | dead_letter`
- `availableAt`, `attemptCount`, `lastErrorCode`, timestamps

`PushDelivery` 제안 필드:

- `id`, `outboxId`, `pushDeviceId`
- `status: queued | ticketed | delivered | failed | dead_letter`
- `providerTicketId` unique nullable, `providerErrorCode` nullable
- `nextReceiptCheckAt`, `attemptCount`, `sentAt`, `receiptCheckedAt`, timestamps
- unique `(outboxId, pushDeviceId)`로 중복 발송 방지

### 5.3 Ticket/receipt 규칙

- Expo send response의 ticket 순서를 요청 token 순서와 안전하게 매핑한다.
- ticket error와 receipt error를 구분해 저장한다.
- receipt `DeviceNotRegistered`면 해당 token과 연결된 active device를 `invalid`로
  바꾸고 재발송하지 않는다.
- `MessageTooBig`, 잘못된 credential/project 등 permanent 오류는 무한 재시도하지
  않는다.
- timeout, 429, 5xx는 exponential backoff + jitter와 최대 시도 횟수를 적용한다.
- provider ticket/receipt 원문 전체를 장기 보관하지 않고 필요한 code/id/time만
  저장한다.
- worker claim은 `FOR UPDATE SKIP LOCKED` 또는 동등한 lease로 다중 worker 중복
  처리를 방지한다.

### 5.4 Sender/receipt 테스트 체크리스트

- [ ] notification과 outbox 원자적 생성, producer rollback 시 outbox도 없음
- [ ] 사용자에게 active device가 0/1/N개인 경우
- [ ] 같은 outbox worker 동시 claim 시 device당 한 delivery만 생성
- [ ] ticket success/error, 부분 batch 실패, response 순서 mapping
- [ ] receipt success, pending, `DeviceNotRegistered`, rate limit, 5xx
- [ ] invalid token revoke 뒤 후속 send 제외
- [ ] retry backoff/max-attempt/dead-letter와 재시작 recovery
- [ ] payload target allowlist와 권한 검증, arbitrary URL 거절
- [ ] token/payload의 민감 필드 log redaction

## 6. OpenIAP 구매 검증과 멱등 지급

`expo-iap`의 package/config plugin/import 이름은 유지한다. 소스 저장소만 OpenIAP
monorepo로 이전됐다. iOS/Android 모두 frontend가 backend에 보내는 핵심 필드는
`purchaseToken`이며, iOS의 legacy `transactionReceipt`를 새 계약으로 사용하지
않는다.

### 6.1 Catalog API

```http
GET /credits/iap/catalog?store=apple
Authorization: Bearer <OPOD access token>
```

```json
{
  "version": 1,
  "store": "apple",
  "products": [
    {
      "packageKey": "credits_500",
      "productId": "credits_500",
      "type": "consumable",
      "creditAmount": 500
    },
    {
      "packageKey": "credits_1050",
      "productId": "credits_1050",
      "type": "consumable",
      "creditAmount": 1050
    }
  ]
}
```

실제 구현은 `credits_3300`, `credits_5750`도 포함한다. localized title/price/currency는
store product 조회 결과를 표시하고 backend 응답이나 client 하드코딩 값으로
대체하지 않는다. backend는 credit amount와 허용 product ID의 source of truth다.

### 6.2 Purchase intent API

구매 전에 user/product/store를 묶는 짧은 TTL intent를 만든다.

```http
POST /credits/iap/intents
Authorization: Bearer <OPOD access token>
Content-Type: application/json
```

```json
{
  "store": "apple",
  "productId": "credits_500"
}
```

**201 Created — Apple 예시**

```json
{
  "purchaseIntentId": "0198a52b-a219-7436-8442-cd50fd07cf5c",
  "store": "apple",
  "productId": "credits_500",
  "appAccountToken": "0198a52b-a219-7436-8442-cd50fd07cf5c",
  "expiresAt": "2026-08-03T08:35:00.000Z"
}
```

**201 Created — Google 예시**

```json
{
  "purchaseIntentId": "0198a52b-a219-7436-8442-cd50fd07cf5c",
  "store": "google",
  "productId": "credits_500",
  "obfuscatedAccountId": "v1_ZN8Fu8rtDVAkndASkL1jTj1ThXr9q5nf",
  "expiresAt": "2026-08-03T08:35:00.000Z"
}
```

- Apple `appAccountToken`은 UUID이고 intent ID를 그대로 사용할 수 있다.
- Google `obfuscatedAccountId`는 user/intent를 server secret으로 HMAC한 비가역 값이며
  Play 길이 제한 안에 둔다.
- intent는 기본 15분 TTL, 단일 product/store, 한 store transaction에만 소비한다.
- client가 임의 user ID를 store account identifier로 만들지 않는다.

### 6.3 Verify/grant API

OpenIAP purchase callback과 restore 결과는 같은 endpoint로 보낸다.

```http
POST /credits/iap/verify
Authorization: Bearer <OPOD access token>
Content-Type: application/json
```

```json
{
  "purchaseIntentId": "0198a52b-a219-7436-8442-cd50fd07cf5c",
  "store": "apple",
  "productId": "credits_500",
  "purchaseToken": "<storekit-2-signed-transaction-jws>",
  "transactionId": "2000000912345678"
}
```

`transactionId`는 correlation hint일 뿐 신뢰하지 않는다. store/verifier가 반환한
canonical transaction ID, bundle/package ID, product, environment, state,
app-account binding을 source of truth로 사용한다.

`purchaseIntentId`는 새 구매 callback에는 포함하지만 **restore/reconciliation 요청에서는
없을 수 있는 optional 필드**다. intent가 없다는 이유만으로 유효한 unfinished purchase를
거절하지 말고, store가 검증한 account binding과 현재 인증 user를 이용해 안전하게
소유권을 확인한다. 소유권을 확정할 수 없으면 credit을 지급하거나 `canFinish: true`를
반환하지 않는다.

**200 OK — 검증·지급 완료**

```json
{
  "verificationId": "0198a535-f67c-7bf1-a39b-f42e748fa00b",
  "purchaseId": "0198a536-d97b-794b-aea8-c07838954b8c",
  "store": "apple",
  "environment": "sandbox",
  "productId": "credits_500",
  "storeTransactionId": "2000000912345678",
  "status": "granted",
  "creditAmount": 500,
  "canFinish": true,
  "idempotentReplay": false
}
```

동일 transaction을 같은 사용자가 다시 보내면 새 credit을 지급하지 않고 같은
purchase를 반환한다.

```json
{
  "verificationId": "0198a535-f67c-7bf1-a39b-f42e748fa00b",
  "purchaseId": "0198a536-d97b-794b-aea8-c07838954b8c",
  "store": "apple",
  "environment": "sandbox",
  "productId": "credits_500",
  "storeTransactionId": "2000000912345678",
  "status": "granted",
  "creditAmount": 500,
  "canFinish": true,
  "idempotentReplay": true
}
```

**202 Accepted — 아직 확정할 수 없음**

```json
{
  "verificationId": "0198a535-f67c-7bf1-a39b-f42e748fa00b",
  "status": "pending",
  "canFinish": false,
  "retryAfterSeconds": 15
}
```

frontend의 절대 규칙:

```text
response.canFinish === true
  -> finishTransaction({ isConsumable: true })
그 외 timeout / network / 202 / 4xx / 5xx
  -> finish하지 않음, unfinished purchase recovery로 재검증
```

검증 실패를 숨기려고 `finishTransaction`을 호출하면 entitlement가 영구 유실될 수
있다.

### 6.4 Verify error contract

| HTTP | `code` | retry | `canFinish` |
| --- | --- | --- | --- |
| 400 | `IAP_REQUEST_INVALID` | no | false |
| 400 | `IAP_PRODUCT_NOT_ALLOWED` | no | false |
| 401 | 기존 auth error | 로그인 필요 | false |
| 409 | `IAP_INTENT_MISMATCH` | no | false |
| 409 | `IAP_TRANSACTION_OWNED_BY_ANOTHER_USER` | no | false |
| 422 | `IAP_VERIFICATION_FAILED` | no | false |
| 422 | `IAP_PURCHASE_REVOKED` | no | false |
| 429 | `IAP_VERIFY_RATE_LIMITED` | yes | false |
| 503 | `IAP_VERIFIER_UNAVAILABLE` | yes | false |

어떤 error도 token 원문, verifier response 원문, 다른 사용자의 ID 또는 transaction
소유 정보를 노출하지 않는다.

### 6.5 검증·지급 transaction 불변식

1. 인증 사용자 소유의 unexpired intent와 store/product를 확인한다.
2. 고정 allowlist의 verifier/store endpoint에서 purchase token을 검증한다.
3. signed/authoritative result의 app ID, environment, product ID, transaction state,
   app-account binding을 catalog/intent와 대조한다.
4. canonical key `(store, environment, storeTransactionId)`로 unique 충돌을 막고
   transaction 단위 lock과 기존 user credit lock을 잡는다.
5. 이미 같은 user/product에 `granted`면 기존 result를 반환한다.
6. 다른 user, product, app에 묶인 transaction이면 409/422로 거절하고 보안 event를
   남긴다.
7. `CreditPurchase(paid)` 생성/갱신과 paid `CreditLedgerEntry(grant)`를 같은 DB
   transaction에서 확정한다.
8. ledger idempotency reference는
   `iap:<store>:<environment>:<storeTransactionId>:grant`로 고정한다.
9. grant commit 뒤에만 `canFinish: true`를 반환한다.
10. 외부 검증 호출은 긴 DB transaction/lock 안에서 수행하지 않는다. 검증 뒤 DB
    transaction에서 unique 제약과 authoritative fields를 다시 확인한다.

### 6.6 Future schema

`IapPurchaseIntent` 제안:

- `id`, `userId`, `store`, `productId`
- `appAccountToken` 또는 `obfuscatedAccountIdHash`
- `status: pending | consumed | expired | canceled`
- `expiresAt`, `consumedAt`, timestamps
- index `(userId, createdAt)`, account token unique

`StoreTransaction` 제안:

- `id`, `userId`, `purchaseIntentId?`, `creditPurchaseId` unique
- `store`, `environment`, `productId`
- `storeTransactionId`, `originalTransactionId?`
- `purchaseTokenHash`; reconciliation에 정말 필요할 때만 key-versioned
  `purchaseTokenCiphertext`를 제한된 retention으로 저장
- `state: verified | granted | refunded | revoked | chargeback`
- `purchasedAt`, `verifiedAt`, `revokedAt`, timestamps
- unique `(store, environment, storeTransactionId)`
- unique `(store, purchaseTokenHash)`가 store semantics와 restore를 깨지 않는지
  fixture로 검증 후 적용

기존 credit schema 관련 체크:

- [ ] `CreditPurchase`에 store metadata를 직접 추가할지 one-to-one
      `StoreTransaction`으로 분리할지 migration 전에 결정
- [ ] `CreditLedgerEntry.externalReference`에 중복 legacy data가 없는지 검사한 뒤
      DB unique guarantee 추가 검토
- [ ] `paidAmount`의 단위를 integer minor unit으로 고정하고 currency와 함께 저장
- [ ] credit amount는 client가 아니라 server catalog에서 결정
- [ ] 기존 user credit advisory lock과 refund allocation을 재사용
- [ ] `pending/paid/failed/canceled/refunded`와 store lifecycle mapping 표 작성

### 6.7 Verify/idempotency 테스트 체크리스트

- [ ] Apple sandbox/production JWS, Google test purchase 성공 fixture
- [ ] wrong app ID, environment, product, account binding, invalid signature/token
- [ ] pending/canceled/revoked/refunded 상태에서 grant 없음 + `canFinish: false`
- [ ] 같은 user sequential/concurrent duplicate가 grant 한 번
- [ ] 다른 user가 같은 token/transaction replay하면 grant 없음 + 409
- [ ] 같은 transaction에 다른 product hint를 보내면 grant 없음
- [ ] verifier timeout/429/5xx 후 재시도와 unfinished recovery
- [ ] DB commit 실패 시 `canFinish: true`가 절대 반환되지 않음
- [ ] grant 성공 response 유실 뒤 retry가 기존 purchase를 반환
- [ ] restore에서 이미 지급된 transaction과 미지급 transaction 혼합
- [ ] raw token/JWS와 verifier secret log redaction

## 7. Store refund/revoke webhook

앱마켓 환불은 사용자용 local refund endpoint가 source of truth가 아니다. Apple은 App
Store Server Notifications V2, Google은 RTDN을 받고 store API로 authoritative state를
재조회한다. Google chargeback/refund 누락 방지를 위해 Voided Purchases API
reconciliation도 필요하다.

### 7.1 Apple webhook

```http
POST /credits/iap/webhooks/apple
Content-Type: application/json
```

```json
{
  "signedPayload": "<app-store-server-notification-v2-jws>"
}
```

- user auth 대신 Apple signed payload의 certificate chain/signature, bundle ID,
  environment를 검증한다.
- decoded `notificationUUID`를 external event ID로 unique 처리한다.
- signed transaction/renewal info도 별도로 검증하며 body의 비서명 값은 신뢰하지
  않는다.
- durable inbox 저장 성공 후 **204 No Content**. duplicate도 204다.
- malformed body는 400, signature/app mismatch는 401, persistence 실패는 5xx로
  provider retry를 유도한다.

### 7.2 Google Pub/Sub push webhook

```http
POST /credits/iap/webhooks/google
Authorization: Bearer <Google Pub/Sub OIDC token>
Content-Type: application/json
```

```json
{
  "message": {
    "data": "<base64-encoded-rtdn-json>",
    "messageId": "136969346945",
    "publishTime": "2026-08-03T08:20:30.000Z"
  },
  "subscription": "projects/opod/subscriptions/play-billing-rtdn"
}
```

decode된 `data`의 예시 shape:

```json
{
  "version": "1.0",
  "packageName": "com.opod.app",
  "eventTimeMillis": "1785745230000",
  "oneTimeProductNotification": {
    "version": "1.0",
    "notificationType": 2,
    "purchaseToken": "<google-play-purchase-token>",
    "sku": "credits_500"
  }
}
```

- Pub/Sub OIDC JWT의 signature, issuer, audience, 허용 service account email을
  검증한다.
- subscription과 package name allowlist를 검사한다.
- `messageId`를 external event ID로 unique 처리한다.
- RTDN type만으로 credit을 회수하지 않고 Google Play Developer API에서 purchase
  state를 재조회한다.
- durable inbox 저장 성공 후 204, duplicate도 204다.

### 7.3 Durable inbox와 멱등 reversal

`IapWebhookEvent` 제안 필드:

- `id`, `store`, `externalEventId`, `eventType`
- `payloadHash`, 필요 최소 범위의 encrypted payload/canonical identifiers
- `status: received | processing | applied | ignored | retry | dead_letter`
- `storeTransactionId?`, `attemptCount`, `lastErrorCode`
- `receivedAt`, `processedAt`, `nextAttemptAt`, timestamps
- unique `(store, externalEventId)`

reversal 처리 규칙:

1. canonical transaction으로 `StoreTransaction`과 `CreditPurchase`를 찾는다.
2. event가 unknown transaction이면 버리지 말고 retry/reconciliation queue에 둔다.
3. authoritative store state가 refund/revoke/chargeback일 때 user credit lock을 잡는다.
4. reversal reference를
   `iap:<store>:<environment>:<storeTransactionId>:<event-kind>`로 고정한다.
5. 기존 refund allocation/credit policy에 따라 남은 paid credit과 연결 promotion을
   회수하고, 부족하면 기존 정책대로 paid debt를 반영한다.
6. 동일 event 또는 같은 최종 state가 재전달돼도 한 번만 회수한다.
7. event 처리와 ledger/reversal 상태를 같은 DB transaction에서 commit한다.
8. user-facing purchase history에는 store가 확정한 상태를 반영하되 민감한 provider
   identifiers는 노출하지 않는다.

### 7.4 Webhook/reversal 테스트 체크리스트

- [ ] Apple valid/invalid certificate chain, bundle, environment, nested JWS
- [ ] Apple 동일 `notificationUUID` 중복과 순서 역전 delivery
- [ ] Google valid/invalid OIDC audience/service account/subscription/package
- [ ] malformed base64/JSON/unknown notification type
- [ ] RTDN 수신 뒤 Developer API success/pending/timeout/404
- [ ] 같은 external event concurrent delivery가 inbox 한 건
- [ ] refund/revoke/chargeback 중복이 credit 한 번만 회수
- [ ] 이미 소비한 paid credit의 debt 및 purchase promotion 회수
- [ ] unknown transaction의 retry 후 verify event와 reconciliation
- [ ] durable persist 전 204를 반환하지 않음
- [ ] webhook payload/token/credential log redaction

## 8. 보안 체크리스트

### 인증·권한

- [ ] Apple/push/IAP public endpoint는 유효한 OPOD user access token 필수
- [ ] 탈퇴·비활성 사용자는 device 등록, intent, verify 거절
- [ ] installation, purchase intent, transaction ownership을 매 요청 확인
- [ ] webhook은 user auth가 아니라 provider signature/OIDC를 검증
- [ ] public arbitrary push-send, grant, refund-result endpoint를 만들지 않음

### 입력·외부 통신

- [ ] provider/store/product/project/app ID exact allowlist
- [ ] token/body/header 길이 제한과 rate limit
- [ ] JWKS/verifier/store URL은 고정 또는 startup allowlist 검증, request에서 URL을
      받지 않음
- [ ] 외부 호출 timeout, retry budget, circuit breaker, response runtime schema
- [ ] client `transactionId`, price, currency, credits, environment를 신뢰하지 않음

### 비밀·개인정보

- [ ] push/store token은 logs/traces/errors/analytics에서 redact
- [ ] 전송에 필요한 raw push token은 key-versioned envelope encryption
- [ ] 비교용 token hash는 plain SHA-256 대신 server-keyed HMAC 검토
- [ ] store token ciphertext는 reconciliation 필요성과 retention을 문서화한 경우만
      저장
- [ ] Apple name/email은 최소 수집, private relay 주소를 실제 email로 역추론하지 않음
- [ ] secret rotation과 이전 ciphertext key read/new key write 절차

### 동시성·무결성

- [ ] DB unique가 애플리케이션의 사전 조회보다 최종 idempotency 경계
- [ ] user credit lock + canonical transaction lock 순서를 고정해 deadlock 방지
- [ ] external verification 중 긴 DB transaction 유지 금지
- [ ] outbox/inbox pattern으로 DB commit과 외부 전달 사이의 유실 방지
- [ ] duplicate, reordered, delayed event가 정상 입력이라는 전제

## 9. 환경 변수 체크리스트

아래 이름은 future implementation 제안이며 현재 `.env`에 추가됐다는 뜻이 아니다.
secret 값은 `.env.example`, 문서, CI log에 넣지 않는다.

### Apple login

| 변수 | secret | 용도 |
| --- | --- | --- |
| `APPLE_OAUTH_AUDIENCES` | no | comma-separated exact audience allowlist |
| `APPLE_OAUTH_JWKS_CACHE_TTL_SECONDS` | no | key cache TTL |
| `APPLE_OAUTH_CLOCK_SKEW_SECONDS` | no | 작은 허용 clock skew |
| `APPLE_NONCE_HMAC_KEY` | yes | nonce hash/replay storage key가 필요할 때 |

Apple issuer/JWKS URL은 code constant로 고정하고 일반 설정으로 열지 않는다.

### Push

| 변수 | secret | 용도 |
| --- | --- | --- |
| `PUSH_ENABLED` | no | rollout kill switch, default false |
| `EXPO_PUSH_PROJECT_IDS` | no | 허용 EAS project ID allowlist |
| `PUSH_APP_IDS` | no | `com.opod.app` 등 app ID allowlist |
| `EXPO_ACCESS_TOKEN` | yes | Expo enhanced push security 사용 시 |
| `PUSH_TOKEN_ENCRYPTION_KEYS` | yes | key ID별 encryption key ring |
| `PUSH_TOKEN_HMAC_KEY` | yes | token lookup/dedup hash |
| `PUSH_SEND_BATCH_SIZE` | no | provider 제한 이하 batch 크기 |
| `PUSH_MAX_ATTEMPTS` | no | send/receipt retry 상한 |
| `PUSH_RECEIPT_DELAY_SECONDS` | no | 최초 receipt 조회 지연 |

### IAP 공통

| 변수 | secret | 용도 |
| --- | --- | --- |
| `IAP_ENABLED` | no | rollout kill switch, default false |
| `IAP_VERIFIER` | no | `iapkit | direct`, startup allowlist |
| `IAP_TOKEN_ENCRYPTION_KEYS` | yes | 보관이 필요한 store token key ring |
| `IAP_TOKEN_HMAC_KEY` | yes | token dedup hash |
| `IAP_INTENT_HMAC_KEY` | yes | Google obfuscated account ID 생성 |
| `IAP_INTENT_TTL_SECONDS` | no | 기본 900 |

IAPKit adapter를 선택할 경우:

| 변수 | secret | 용도 |
| --- | --- | --- |
| `IAPKIT_API_KEY` | yes | server-only verifier credential |
| `IAPKIT_BASE_URL` | no | startup exact-host allowlist를 통과한 endpoint |

store-direct adapter/webhook을 선택할 경우:

| 변수 | secret | 용도 |
| --- | --- | --- |
| `APPLE_IAP_BUNDLE_ID` | no | `com.opod.app` exact match |
| `APPLE_IAP_ISSUER_ID` | no | App Store Connect issuer |
| `APPLE_IAP_KEY_ID` | no | App Store Server API key ID |
| `APPLE_IAP_PRIVATE_KEY_BASE64` | yes | App Store Server API private key |
| `GOOGLE_PLAY_PACKAGE_NAME` | no | `com.opod.app` exact match |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64` | yes | Play Developer API credential |
| `GOOGLE_PUBSUB_AUDIENCE` | no | push endpoint OIDC audience |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL` | no | 허용 Pub/Sub push principal |
| `GOOGLE_PUBSUB_SUBSCRIPTION` | no | exact subscription allowlist |

startup validation은 활성 feature의 필수 값이 없으면 즉시 실패해야 한다. feature가
꺼져 있을 때는 secret 누락 때문에 기존 service 전체가 시작되지 않는 정책인지
별도로 결정하되, enabled인데 검증 없는 fallback은 금지한다.

## 10. 관측·운영 체크리스트

- [ ] metric: active/revoked/invalid push devices, ticket/receipt success/error code,
      outbox age, dead-letter count
- [ ] metric: IAP verify latency/result, idempotent replay, cross-user replay rejection,
      pending age, grant count
- [ ] metric: webhook receive/apply lag, duplicate, unknown transaction, reversal failure
- [ ] alert: receipt worker backlog, verifier outage, webhook signature spike, grant/reversal
      dead letter
- [ ] correlation ID는 기록하되 token/JWS/provider payload는 제외
- [ ] manual reconciliation은 admin 소유 경계에서 audit reason/reference와 함께 수행
- [ ] credential sandbox/production 분리와 rotation runbook
- [ ] App Store/Play Console delivery status를 포함한 sandbox smoke checklist

## 11. Frontend handoff 요약

backend 구현 전 `opod-app`/`opod-web`은 다음을 전제로 adapter를 분리한다.

1. Apple은 `POST /auth/social/apple`이 404/unsupported이면 지원 대기 UI를 표시하고
   OPOD session 생성 성공으로 처리하지 않는다.
2. push는 permission/token 획득과 server registration을 분리한다. PUT이 성공해야
   설정을 “서버 등록 완료”로 표시한다. logout/token rollover에서 DELETE/PUT을
   호출할 수 있는 queue를 둔다.
3. IAP는 catalog → intent → native purchase → verify 순서다. verify response의
   `canFinish === true`만 finish 조건이다.
4. timeout, network failure, 202는 취소가 아니라 pending/retry 상태다. 앱 재실행 때
   unfinished purchases를 다시 verify한다.
5. frontend는 Apple token, push token, purchase token/JWS를 local analytics와
   console log에 남기지 않는다.
6. store refund 상태는 local refund endpoint가 아니라 향후 store webhook 처리
   결과를 purchase history/balance API로 읽는다.

## 12. Backend implementation 승인 전 결정할 항목

frontend-visible HTTP shape는 이 문서대로 고정하되 다음 backend 내부 선택은 별도
승인 때 확정한다.

- IAPKit 기본 adapter를 실제 운영 경계로 채택할지 store-direct 검증을 기본으로 할지
- worker 실행 방식(상주 worker, scheduler, queue service)과 dead-letter 운영 주체
- push/store encrypted payload retention과 key management system
- Apple web Service ID를 첫 release audience allowlist에 포함할지
- Google Voided Purchases reconciliation 주기와 운영 API quota
- store refund와 기존 사용자 요청 환불 UI의 연결 정책

어느 선택도 `검증·멱등 지급 뒤에만 canFinish`, provider-signed webhook,
user/device/transaction ownership, token redaction이라는 불변식을 약화할 수 없다.

## 13. 구현 완료로 표시하기 위한 검증

향후 backend 구현 보고에는 실제 실행 결과가 모두 필요하다.

1. formatter, lint, build
2. Apple verifier unit tests와 auth E2E
3. push device/sender/receipt unit tests와 API E2E
4. IAP verify/idempotency/concurrency/refund unit tests와 API E2E
5. 빈 DB migration 적용 및 existing schema drift 확인
6. Apple/Google/Expo sandbox credential을 사용한 development build 실기기 smoke
7. OpenAPI/Swagger와 이 handoff의 sample JSON 일치 확인
8. secret/token log redaction 확인

현재는 위 검증을 실행하지 않았고 완료로 표시하지 않는다.

## 참고 자료

- OpenIAP Expo setup: <https://www.openiap.dev/docs/setup/expo>
- OpenIAP purchase lifecycle: <https://www.openiap.dev/docs/lifecycle>
- OpenIAP purchase type: <https://www.openiap.dev/docs/types/purchase>
- Expo notifications: <https://docs.expo.dev/versions/latest/sdk/notifications/>
- Expo AppleAuthentication:
  <https://docs.expo.dev/versions/latest/sdk/apple-authentication/>
- Apple identity token verification:
  <https://developer.apple.com/documentation/signinwithapple/verifying-a-user>
- Apple App Store Server Notifications V2:
  <https://developer.apple.com/documentation/appstoreservernotifications/app-store-server-notifications-v2>
- Google Play billing backend:
  <https://developer.android.com/google/play/billing/backend>
- Google RTDN reference:
  <https://developer.android.com/google/play/billing/rtdn-reference>
