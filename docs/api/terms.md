# Terms API — 약관·개인정보 동의

- 정책 근거: [consent-policy.md](../consent-policy.md)
- 상태: **구현 완료 (2026-07-27)** — 도메인 유닛 8건 통과
- 구현: `src/domain/consents/consents.service.ts`,
  `src/service/consents/terms.controller.ts`,
  `src/service/consents/consents.controller.ts`, Swagger `/docs` 등록됨

동의 유형은 `terms_of_service`, `privacy`, `age_14`, `marketing` 네 가지이며
`marketing`만 선택 항목이다.

---

## GET /terms — 시행 중인 문서 목록

- 인증: 불필요 (가입 화면이 그려야 한다)

**200 OK** — 시행일이 지난 유형별 최신 문서만, 본문 제외.

```json
[
  {
    "type": "terms_of_service",
    "version": "1.0",
    "title": "서비스 이용약관",
    "required": true,
    "effectiveAt": "2026-07-05T08:00:00.000Z"
  },
  {
    "type": "marketing",
    "version": "1.0",
    "title": "광고성 정보 수신 동의",
    "required": false,
    "effectiveAt": "2026-07-05T08:00:00.000Z"
  }
]
```

문서를 한 건도 등록하지 않았으면 빈 배열이다.

---

## GET /terms/{type} — 문서 본문

- 인증: 불필요

**200 OK** — 목록 항목에 `body`가 추가된 형태.

| 상태 | 조건 | 메시지 |
|---|---|---|
| 400 | `type`이 허용 값이 아님 | `consent type is invalid` |
| 404 | 해당 유형에 시행 중인 문서 없음 | `Terms document not found` |

---

## POST /auth/register — 가입 시 동의 수집

기존 요청 본문에 `consents`가 추가된다.

```http
POST /auth/register
Content-Type: application/json

{
  "email": "taeho@example.com",
  "password": "password1234",
  "displayName": "홍태호",
  "consents": [
    { "type": "terms_of_service", "agreed": true },
    { "type": "privacy", "agreed": true },
    { "type": "age_14", "agreed": true },
    { "type": "marketing", "agreed": false }
  ]
}
```

| 필드 | 타입 | 규칙 |
|---|---|---|
| `consents` | array? | 선택. 항목은 `{ type, agreed }` |
| `consents[].type` | string | 허용된 동의 유형 |
| `consents[].agreed` | boolean | 필수. 문자열이나 누락은 400 |

- 시행 중인 **필수** 문서는 전부 `agreed: true`여야 한다.
- 버전은 서버가 시행 중인 문서에서 붙인다. 요청에 버전을 넣어도 무시한다.
- 요청에 넣은 항목만 기록한다. 선택 항목을 `agreed: false`로 보내면 거부
  기록이 남고, 아예 넣지 않으면 기록이 없는 상태(미동의)가 된다.
- 시행 중인 문서가 없는 유형을 보내면 400이다.
- 응답은 기존 가입 응답과 같다.

### 부수효과 (성공 시, 단일 트랜잭션)

1. `users` 행 생성.
2. `user_consents`에 요청한 항목 수만큼 기록 생성.

가입 보너스 지급은 기존과 동일하게 트랜잭션 이후에 수행한다.

### 에러

| 상태 | 조건 | 메시지 |
|---|---|---|
| 400 | 필수 동의 누락 또는 `agreed: false` | `Consent is required: terms_of_service, privacy` |
| 400 | 시행 중인 문서 없는 유형 | `Consent document is not available: marketing` |
| 400 | 알 수 없는 유형 | `consent type is invalid` |
| 400 | `agreed`가 boolean이 아님 | `consents[].agreed must be a boolean` |
| 400 | 같은 유형 중복 | `consents must not repeat the same type` |
| 400 | `consents`가 배열이 아님 | `consents must be an array` |

---

## GET /consents — 내 동의 현황

- 인증: 필수 (Bearer access token)

**200 OK** — 네 유형을 항상 모두 반환한다.

```json
[
  {
    "type": "terms_of_service",
    "required": true,
    "agreed": true,
    "agreedVersion": "1.0",
    "currentVersion": "2.0",
    "needsConsent": true
  },
  {
    "type": "marketing",
    "required": false,
    "agreed": false,
    "agreedVersion": null,
    "currentVersion": "1.0",
    "needsConsent": false
  }
]
```

| 필드 | 설명 |
|---|---|
| `agreed` | 최신 기록의 동의 여부. 기록이 없으면 `false` |
| `agreedVersion` | 최신 기록의 버전. 기록이 없으면 `null` |
| `currentVersion` | 시행 중인 버전. 문서가 없으면 `null` |
| `needsConsent` | 필수 항목이 현재 버전에 동의되어 있지 않으면 `true` |

---

## PATCH /consents — 동의 변경·재동의

- 인증: 필수 (Bearer access token)

```http
PATCH /consents
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "consents": [{ "type": "marketing", "agreed": true }] }
```

- 최소 1건이 필요하다.
- 필수 항목은 `agreed: false`로 바꿀 수 없다. 철회는 회원탈퇴로만 가능하다.
- 필수 항목을 `agreed: true`로 다시 보내면 현재 버전으로 재동의가 기록된다.
- 직전 기록과 버전·동의 여부가 모두 같으면 기록을 늘리지 않는다.
- 응답은 `GET /consents`와 같다.

### 에러

| 상태 | 조건 | 메시지 |
|---|---|---|
| 400 | 항목 없음 | `consents is required` |
| 400 | 필수 항목 철회 시도 | `Required consent cannot be withdrawn: privacy` |
| 400 | 그 밖의 입력 오류 | register와 동일 |
| 401 | 액세스 토큰 없음/무효/만료 | 기존 auth 에러와 동일 |

---

## 스키마

- `terms_documents`: `id`, `type`, `version`, `title`, `body`, `effective_at`,
  `created_at`, `updated_at`. `(type, version)` 유일, `(type, effective_at)` 인덱스.
- `user_consents`: `id`, `user_id`, `type`, `version`, `agreed`, `created_at`.
  `(user_id, type, created_at)` 인덱스. append-only이며 탈퇴해도 남는다.

## 문서 등록 (임시)

작성 API는 opod-admin이 담당하며 아직 없다. 그때까지는 SQL로 등록한다.

```sql
INSERT INTO opod.terms_documents (id, type, version, title, body, effective_at, updated_at)
VALUES (gen_random_uuid(), 'terms_of_service', '1.0', '서비스 이용약관', '제1조(목적) ...', NOW(), NOW());
```

시행일을 미래로 넣으면 그 시각부터 자동으로 현재 버전이 되고, 기존 사용자는
`needsConsent: true`로 바뀐다.

## 검증 시나리오 (테스트 계약)

- 필수 문서 시행 중 + 동의 누락 가입 → 400, 계정·동의 기록 모두 없음.
- 가입 성공 → 요청 항목 수만큼 기록, 버전은 서버 값(요청 버전 무시).
- 문서 미등록 상태 → 동의 없이 가입 성공, 기록 없음.
- 마케팅 동의 후 철회 → 기록 2건 유지, 최신 상태 `agreed: false`.
- 같은 응답 재전송 → 기록 1건 유지.
- 필수 항목 철회 → 400, 기록 없음.
- 신규 버전 시행 → `needsConsent: true`, 재동의 후 `false`.
- 시행일이 미래인 문서 → 목록에서 제외, 해당 유형 동의 시도는 400.
