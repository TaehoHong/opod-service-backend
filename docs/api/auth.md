# Auth API — 계정 관리

- 정책 근거: [account-support-policy.md](../account-support-policy.md)
- 이 문서는 계정 관리 배치에서 추가되는 auth 엔드포인트를 다룬다.
  (기존 register/login/refresh/me/session은 Swagger `/docs` 참조)

---

## 공통 인증 응답과 세션 처리

register/login/refresh/password 응답의 `user`는 다음 필드를 사용한다.

| 필드              | 타입    | 설명                           |
| ----------------- | ------- | ------------------------------ |
| `id`              | string  | 사용자 ID                      |
| `displayName`     | string  | 표시 이름                      |
| `bio`             | string  | 소개. 미설정 시 빈 문자열      |
| `profileImageUrl` | string? | 프로필 이미지가 있을 때만 포함 |
| `email`           | string  | 정규화된 이메일                |

로그인은 비밀번호를 검증한 뒤 사용자별 세션 advisory lock을 잡고, 비밀번호
hash/salt가 최초 검증 시점과 같은지 다시 확인한 후 리프레시 토큰을 생성한다.
따라서 동시에 비밀번호가 변경되면 이전 비밀번호로 시작한 로그인은 401로
종료된다.

refresh는 같은 사용자별 lock 안에서 기존 토큰의 미폐기 상태와 만료 시각을
조건부 갱신하고 후속 토큰을 생성한다. 두 작업은 하나의 트랜잭션이므로 후속
토큰 생성이 실패하면 기존 토큰 폐기도 롤백되며, 같은 토큰을 동시에 refresh할
때는 한 요청만 성공한다.

---

## PATCH /auth/password — 비밀번호 변경

- 상태: **구현 완료 (2026-07-08)**
- 인증: 필수 (Bearer access token)
- 정책: [account-support-policy.md §1](../account-support-policy.md)
- 구현: `src/domain/auth/auth.service.ts` `changePasswordFromAuthorization`,
  `src/service/auth/auth.controller.ts`, Swagger `/docs`에 예시 등록됨

### 요청

```http
PATCH /auth/password
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "currentPassword": "old-password123",
  "newPassword": "new-password456"
}
```

| 필드 | 타입 | 규칙 |
|---|---|---|
| `currentPassword` | string | 필수. 현재 비밀번호와 일치해야 함. trim하지 않음 |
| `newPassword` | string | 필수. **8자 이상 128자 이하**, `currentPassword`와 달라야 함. trim하지 않음 |

비밀번호 규칙(8~128자)은 회원가입과 동일한 검증을 공유한다.
(이번 변경으로 회원가입에도 128자 상한이 함께 적용된다.)

### 응답

**200 OK** — 로그인 응답과 동일 shape:

```json
{
  "user": {
    "id": "user_01",
    "displayName": "홍태호",
    "bio": "AI 캐릭터 이야기를 좋아해요",
    "profileImageUrl": "https://cdn.example.com/users/user_01.png",
    "email": "taeho@example.com"
  },
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "refresh_new123"
}
```

### 부수효과 (성공 시, 사용자별 lock을 포함한 단일 트랜잭션)

1. lock 획득 후 최초 검증 시점의 비밀번호 hash/salt가 그대로인지 재확인.
2. 새 salt로 비밀번호 재해시 후 저장.
3. 해당 유저의 **활성 리프레시 토큰 전부 폐기**(`revokedAt` 기록)
   — 다른 모든 기기가 로그아웃된다.
4. `user_events`에 `eventType: "auth.password_changed"` 기록
   (`targetType: "user"`, `targetId: <userId>`).
5. 현재 기기용 새 리프레시 토큰 생성.

동시에 같은 이전 비밀번호로 변경을 요청하면 첫 번째로 lock을 획득한 요청만
성공한다. 변경한 현재 기기는 새 토큰으로 로그인이 유지된다. 잔여 액세스
토큰(≤15분)은 stateless라 즉시 무효화하지 않는다 (정책 §1.1).

### 에러

| 상태 | 조건 | 메시지 |
|---|---|---|
| 400 | `currentPassword` 불일치 | `Current password is incorrect` |
| 400 | `newPassword` 규칙 위반 (8자 미만 / 128자 초과 / 문자열 아님) | `Password must be 8 to 128 characters` |
| 400 | `newPassword`가 `currentPassword`와 동일 | `New password must be different` |
| 401 | 액세스 토큰 없음/무효/만료 | 기존 auth 에러와 동일 |

현재 비밀번호 불일치는 401이 아닌 **400** — 클라이언트가 "재로그인 유도"와
"재입력 유도"를 구분하기 위함 (정책 §1.2).

### 검증 시나리오 (테스트 계약)

- 올바른 현재 비번 + 유효한 새 비번 → 200, 새 토큰 페어 반환.
- 변경 후: 기존 리프레시 토큰으로 `POST /auth/refresh` → 401.
- 변경 후: 응답의 새 리프레시 토큰으로 refresh → 성공.
- 변경 후: 이전 비밀번호로 로그인 → 401, 새 비밀번호로 로그인 → 201.
- 잘못된 현재 비번 → 400.
- 7자 새 비번 / 129자 새 비번 / 현재와 동일한 새 비번 → 400.
- 토큰 없이 호출 → 401.

---

## DELETE /auth/me — 회원탈퇴 (즉시 익명화)

- 상태: **구현 완료 (2026-07-08)** — 유닛 10건 + e2e 7건(auth 스위트 누적) 통과
- 인증: 필수 (Bearer access token)
- 정책: [account-support-policy.md §2](../account-support-policy.md)
- 구현: `src/domain/auth/auth.service.ts` `deleteAccountFromAuthorization`,
  스키마 `User.updatedAt/deletedAt` + `UserWithdrawal`, Swagger `/docs` 등록됨
- 구현 노트: 이메일 해시는 익명화 트랜잭션 **전에** 계산한다
  (트랜잭션 배열 평가 순서에 의존하지 않도록)

### 요청

```http
DELETE /auth/me
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "password": "password123",
  "reasonCategory": "low_usage",
  "reasonText": "자주 사용하지 않아요"
}
```

| 필드 | 타입 | 규칙 |
|---|---|---|
| `password` | string | 필수. 현재 비밀번호와 일치해야 함 |
| `reasonCategory` | string? | 선택. `low_usage` / `credit_cost` / `content` / `privacy` / `etc` 중 하나 |
| `reasonText` | string? | 선택. 최대 500자 |

### 응답

**200 OK**

```json
{ "deleted": true }
```

### 부수효과 (성공 시, 단일 트랜잭션)

정책 §2.3 데이터 처리 매트릭스 그대로:

1. `users` 행 익명화: `email`·`passwordHash`·`passwordSalt` → null,
   `displayName` → `"탈퇴한 사용자"`, `deletedAt` 기록.
2. `user_refresh_tokens` 전체 삭제 — 모든 세션 즉시 차단.
3. `message_conversations` 삭제 (메시지는 FK cascade로 함께 삭제).
4. `notifications` 삭제.
5. `user_character_follows` 삭제.
6. `user_hashtag_preferences` 삭제.
7. `user_withdrawals` 생성: `emailHash = HMAC-SHA256(email, AUTH_EMAIL_HASH_PEPPER)`
   + 탈퇴 사유. 이메일 원문은 저장하지 않는다.

크레딧 원장·구매·예약·출석, 신고, `user_events`는 익명 상태로 유지 (보존 의무).

### 탈퇴 후 동작

- 모든 인증 검사가 `deletedAt` 있는 계정을 거부 → 잔여 액세스 토큰(≤15분)도
  즉시 401.
- 이메일이 null이므로 기존 이메일 로그인 자체가 불가.
- **동일 이메일 즉시 재가입 가능.** 단 탈퇴 후 30일 내 재가입이면
  **가입 보너스(100크레딧) 미지급** — `user_withdrawals.emailHash` 대조.
  30일 경과 후 재가입은 정상 지급.

### 에러

| 상태 | 조건 | 메시지 |
|---|---|---|
| 400 | 비밀번호 불일치 | `Password is incorrect` |
| 400 | `reasonCategory`가 허용 값 아님 | `reasonCategory is invalid` |
| 400 | `reasonText` 500자 초과 | `reasonText must be at most 500 characters` |
| 401 | 액세스 토큰 없음/무효/만료/이미 탈퇴 | 기존 auth 에러와 동일 |

### 환경 변수

- `AUTH_EMAIL_HASH_PEPPER` (필수, 32바이트 이상 권장) — 탈퇴 이메일 HMAC 키.
  `.env`, `.env.production.example`, e2e env에 추가.

### 스키마 변경

- `User`: `updatedAt`(now 기본값), `deletedAt?` 추가.
- 신규 `UserWithdrawal`(`user_withdrawals`): `id`, `userId`(평문 uuid, FK 없음),
  `emailHash`(index), `reasonCategory?`, `reasonText?`, `createdAt`.

### 검증 시나리오 (테스트 계약)

- 탈퇴 성공 → `{ deleted: true }`, users 행 익명화 확인(email null,
  displayName 대체, deletedAt 존재).
- 탈퇴 직후: 같은 액세스 토큰으로 `GET /auth/me` → 401, 리프레시 → 401,
  이전 이메일+비번 로그인 → 401.
- 대화·알림·팔로우·해시태그 선호 삭제 확인, 크레딧 원장은 잔존 확인.
- 동일 이메일 재가입 → 201 성공, 크레딧 잔액 0 (보너스 차단).
- 30일 경과 시나리오(유닛) → 보너스 정상 지급.
- 잘못된 비밀번호 → 400. 잘못된 reasonCategory → 400.
