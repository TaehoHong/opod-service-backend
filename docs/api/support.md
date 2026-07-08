# Support API — FAQ / 공지사항 / 1:1 문의

- 정책 근거: [account-support-policy.md](../account-support-policy.md) §3–§5
- 콘텐츠 등록·발행·답변은 `opod-admin` 소관. 이 레포는 스키마 + 유저용 API만.

---

## GET /faqs — FAQ 목록

- 상태: **구현 완료 (2026-07-08)** — e2e 3건 통과
- 인증: 불필요 (비로그인 공개 — 비번을 잊은 유저도 접근해야 함)
- 정책: [account-support-policy.md §3](../account-support-policy.md)
- 구현: `src/domain/faqs/faqs.service.ts`, `src/service/faqs/faqs.controller.ts`,
  Swagger `/docs` "고객지원" 태그 등록됨

### 요청

```http
GET /faqs
GET /faqs?category=credit
```

| 파라미터 | 타입 | 규칙 |
|---|---|---|
| `category` | string? | 선택. 값이 있으면 해당 카테고리만. 알 수 없는 값은 빈 목록 (에러 아님) |

카테고리 초기 세트 (문자열, enum 아님 — 운영에서 조정 가능):
`service` / `account` / `credit` / `chat` / `safety` / `etc`

### 응답

**200 OK** — 페이지네이션 없음, 발행분 전체 (상한 200건):

```json
{
  "items": [
    {
      "id": "faq_01",
      "category": "credit",
      "question": "크레딧은 어떻게 충전하나요?",
      "answer": "크레딧 탭에서 패키지를 선택해 충전할 수 있어요.",
      "sortOrder": 0
    }
  ]
}
```

### 규칙

- `isPublished = true`인 항목만 노출한다.
- 정렬: `sortOrder` 오름차순 → `createdAt` 내림차순.
- 미발행 항목은 응답에 절대 포함되지 않는다.

### 스키마

`Faq`(`faqs`): `id`, `category`, `question`, `answer`, `sortOrder`(default 0),
`isPublished`(default false), `createdAt`, `updatedAt`.
인덱스: `[isPublished, category, sortOrder]`.

### 검증 시나리오 (테스트 계약)

- 발행 2건 + 미발행 1건 심기 → 발행 2건만, sortOrder 순서로 반환.
- `?category=` 필터 → 해당 카테고리만.
- 알 수 없는 카테고리 → `{ items: [] }` (200).
- 인증 헤더 없이 접근 가능.

---

## GET /notices — 공지 목록

- 상태: **구현 완료 (2026-07-08)** — e2e 2건 통과
- 인증: 불필요 (비로그인 공개)
- 정책: [account-support-policy.md §4](../account-support-policy.md)
- 구현: `src/domain/notices/notices.service.ts`,
  `src/service/notices/notices.controller.ts`, Swagger `/docs` 등록됨

### 요청

```http
GET /notices
GET /notices?cursor=<nextCursor>&limit=20
```

| 파라미터 | 타입 | 규칙 |
|---|---|---|
| `cursor` | string? | 이전 응답의 `nextCursor`. 없으면 첫 페이지 |
| `limit` | number? | 기본 20, 최대 50 (공통 페이지네이션 규칙) |

### 응답

**200 OK**

```json
{
  "pinned": [
    { "id": "notice_01", "title": "점검 안내", "isPinned": true, "publishedAt": "2026-07-08T00:00:00.000Z" }
  ],
  "items": [
    { "id": "notice_02", "title": "업데이트 소식", "isPinned": false, "publishedAt": "2026-07-07T00:00:00.000Z" }
  ],
  "nextCursor": "cursor_abc"
}
```

### 규칙

- 발행분만: `publishedAt != null && publishedAt <= now`
  (null = 초안, 미래 = 예약 발행).
- **`pinned`는 첫 페이지(커서 없음)에서만 포함** — 고정 공지 전체를
  `publishedAt` 내림차순으로 (안전 상한 20건). 커서 요청에는 없음.
- `items`는 고정 아닌 공지만, `publishedAt` 내림차순(동률은 id 내림차순),
  커서 페이지네이션.
- 본문(`body`)은 목록에 포함하지 않는다 — 상세 API로 조회.

### 스키마

`Notice`(`notices`): `id`, `title`, `body`, `isPinned`(default false),
`publishedAt?`, `createdAt`, `updatedAt`. 인덱스: `[isPinned, publishedAt]`.

### 검증 시나리오 (테스트 계약)

- 고정 1 + 일반 2 + 초안 1 + 예약(미래) 1 심기 → 첫 페이지에
  `pinned` 1건, `items`엔 일반 2건만(최신순), 초안·예약 제외.
- `limit=1` → items 1건 + `nextCursor` 존재 → 커서로 재요청 시 다음 1건,
  `pinned` 미포함.
- 인증 헤더 없이 접근 가능.

---

## GET /notices/:id — 공지 상세

- 상태: **구현 완료 (2026-07-08)** — e2e 3건(notices 스위트 누적) 통과
- 인증: 불필요 (비로그인 공개)
- 정책: [account-support-policy.md §4](../account-support-policy.md)
- 구현: `NoticesService.findPublishedNotice`, Swagger `/docs` 등록됨

### 요청

```http
GET /notices/:id
```

### 응답

**200 OK** — 본문 포함:

```json
{
  "id": "notice_01",
  "title": "서비스 점검 안내",
  "body": "7월 10일 새벽 2시부터 점검이 진행됩니다.",
  "isPinned": true,
  "publishedAt": "2026-07-08T00:00:00.000Z"
}
```

### 에러

| 상태 | 조건 |
|---|---|
| 404 | 존재하지 않음 / 미발행(초안) / 예약 발행 전 / **uuid 형식이 아닌 id** |

미발행 공지는 존재 여부를 노출하지 않기 위해 404로 응답한다.
uuid 형식이 아닌 id는 질의 전에 형식 검증으로 걸러 404로 정규화한다
(그대로 질의하면 PostgreSQL uuid 캐스팅 오류로 500이 된다).

### 검증 시나리오 (테스트 계약)

- 발행 공지 id → 200, 본문 포함.
- 초안 공지 id → 404. 예약(미래 발행) 공지 id → 404.
- 임의 uuid → 404. uuid 형식 아닌 문자열(`bad-id`) → 404 (500 아님).
- 인증 헤더 없이 접근 가능.

---

## POST /inquiries — 1:1 문의 접수

- 상태: **구현 완료 (2026-07-08)** — 유닛 3건 + e2e 3건 통과
- 인증: 필수 (Bearer access token)
- 정책: [account-support-policy.md §5](../account-support-policy.md)
- 구현: `src/domain/inquiries/inquiries.service.ts`,
  `src/service/inquiries/inquiries.controller.ts`, Swagger `/docs` 등록됨

### 요청

```http
POST /inquiries
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "category": "credit", "body": "결제했는데 크레딧이 안 들어와요." }
```

| 필드 | 타입 | 규칙 |
|---|---|---|
| `category` | string | 필수. `account` / `credit` / `bug` / `content` / `etc` 중 하나 |
| `body` | string | 필수. trim 후 1~2,000자 |

제목은 받지 않는다 — 목록·어드민 화면은 본문 앞부분을 미리보기로 쓴다 (정책 §5.1).

### 응답

**201 Created**

```json
{
  "id": "inquiry_01",
  "category": "credit",
  "body": "결제했는데 크레딧이 안 들어와요.",
  "status": "submitted",
  "createdAt": "2026-07-08T09:00:00.000Z"
}
```

### 규칙

- 상태는 `submitted`로 생성된다. 답변은 `opod-admin`이 기록한다 (§5.3 계약).
- **일일 한도: 1인당 하루(KST, UTC+9 고정) 10건.** 초과 시 429.
  당일 KST 자정 이후 생성 건수를 세어 판정한다.
- 첨부파일 미지원 (텍스트만).

### 에러

| 상태 | 조건 | 메시지 |
|---|---|---|
| 400 | category 허용 값 아님 | `category is invalid` |
| 400 | body 없음/빈 문자열/2,000자 초과 | `body is required` / `body must be at most 2000 characters` |
| 401 | 액세스 토큰 없음/무효/만료 | 기존 auth 에러와 동일 |
| 429 | 일일 10건 초과 | `Too many inquiries today` |

### 스키마

`InquiryStatus` enum: `submitted` / `answered`.
`Inquiry`(`inquiries`): `id`, `userId`(User FK — 탈퇴 후에도 익명 행에 연결 유지),
`category`, `body`, `status`(default submitted), `answerBody?`, `answeredAt?`,
`createdAt`, `updatedAt`.
인덱스: `[userId, createdAt]`, `[status, createdAt]`(admin 미답변 큐용).

### 검증 시나리오 (테스트 계약)

- 유효 입력 → 201, `status: "submitted"`.
- 잘못된 category / 빈 body / 2,001자 body → 400.
- 토큰 없음 → 401.
- 10건 생성 후 11번째 → 429 (유닛: 전날 생성분은 카운트 제외).

---

## GET /inquiries — 내 문의 목록

- 상태: **구현 완료 (2026-07-08)** — e2e 4건(inquiries 스위트 누적) 통과
- 인증: 필수 (Bearer access token)
- 정책: [account-support-policy.md §5](../account-support-policy.md)
- 구현: `InquiriesService.listInquiriesPage`, Swagger `/docs` 등록됨

### 요청

```http
GET /inquiries
GET /inquiries?cursor=<nextCursor>&limit=20
```

| 파라미터 | 타입 | 규칙 |
|---|---|---|
| `cursor` | string? | 이전 응답의 `nextCursor` |
| `limit` | number? | 기본 20, 최대 50 (공통 페이지네이션 규칙) |

### 응답

**200 OK** — 본인 문의만, 최신순:

```json
{
  "items": [
    {
      "id": "inquiry_02",
      "category": "credit",
      "body": "결제했는데 크레딧이 안 들어와요.",
      "status": "answered",
      "answeredAt": "2026-07-08T10:00:00.000Z",
      "createdAt": "2026-07-08T09:00:00.000Z"
    }
  ],
  "nextCursor": "cursor_abc"
}
```

- 목록에도 `body` 전문을 포함한다 (최대 2,000자 — 클라이언트가 미리보기로
  잘라 쓴다). 답변 본문(`answerBody`)은 상세 API에서만 반환.
- 정렬: `createdAt` 내림차순 (동률은 id 내림차순).

### 에러

| 상태 | 조건 |
|---|---|
| 401 | 액세스 토큰 없음/무효/만료 |

### 검증 시나리오 (테스트 계약)

- 유저 A 문의 3건 + 유저 B 문의 1건 → A 목록엔 A 것 3건만 최신순.
- `limit=2` → 2건 + `nextCursor` → 커서 재요청 → 나머지 1건.
- 토큰 없음 → 401.

---

## GET /inquiries/:id — 내 문의 상세

- 상태: **구현 완료 (2026-07-08)** — e2e 5건(inquiries 스위트 누적) 통과
- 인증: 필수 (Bearer access token)
- 정책: [account-support-policy.md §5](../account-support-policy.md)
- 구현: `InquiriesService.findInquiry`, uuid 검증은 공용 헬퍼
  `src/domain/database/uuid.ts`(`isUuid`)로 추출 (notices와 공유),
  Swagger `/docs` 등록됨

### 요청

```http
GET /inquiries/:id
Authorization: Bearer <accessToken>
```

### 응답

**200 OK** — 답변 본문 포함 (목록과 달리 `answerBody` 반환):

```json
{
  "id": "inquiry_01",
  "category": "credit",
  "body": "결제했는데 크레딧이 안 들어와요.",
  "status": "answered",
  "answerBody": "확인 후 크레딧을 지급해 드렸어요.",
  "answeredAt": "2026-07-08T10:00:00.000Z",
  "createdAt": "2026-07-08T09:00:00.000Z"
}
```

미답변 문의는 `status: "submitted"`, `answerBody: null`, `answeredAt: null`.

### 에러

| 상태 | 조건 |
|---|---|
| 401 | 액세스 토큰 없음/무효/만료 |
| 404 | 없음 / **본인 소유 아님** (존재 여부 노출 방지 — 403 대신 404) / uuid 형식 아님 |

### 검증 시나리오 (테스트 계약)

- 본인 문의 → 200, `answerBody` 필드 포함 (미답변이면 null).
- 답변된 문의(어드민이 DB에 기록했다고 가정) → `answerBody`·`answeredAt` 반환.
- 타인 문의 id → 404. 임의 uuid → 404. `bad-id` → 404.
- 토큰 없음 → 401.

---

## DELETE /inquiries/:id — 답변 전 문의 삭제

- 상태: **구현 완료 (2026-07-08)** — e2e 6건(inquiries 스위트 누적) 통과
- 인증: 필수 (Bearer access token)
- 정책: [account-support-policy.md §5](../account-support-policy.md)
- 구현: `InquiriesService.deleteInquiry` (status 조건부 deleteMany로 경합 방지),
  Swagger `/docs` 등록됨

### 요청

```http
DELETE /inquiries/:id
Authorization: Bearer <accessToken>
```

### 응답

**200 OK**

```json
{ "deleted": true }
```

### 규칙

- **`submitted` 상태에서만 삭제 가능.** 답변된 문의는 소비자 분쟁처리
  기록이므로 삭제 불가 (정책 §5.1) — 409로 거절.
- 삭제는 `status = submitted` 조건부로 수행한다 — 판정과 삭제 사이에
  답변이 달리는 경합에도 답변된 문의가 지워지지 않는다.

### 에러

| 상태 | 조건 | 메시지 |
|---|---|---|
| 401 | 액세스 토큰 없음/무효/만료 | 기존 auth 에러와 동일 |
| 404 | 없음 / 본인 소유 아님 / uuid 형식 아님 | `Inquiry not found` |
| 409 | 이미 답변됨 | `Inquiry already answered` |

### 검증 시나리오 (테스트 계약)

- 본인 `submitted` 문의 삭제 → 200 `{ deleted: true }`, 목록에서 사라짐.
- 답변된 문의 삭제 시도 → 409, 문의는 그대로 존재.
- 타인 문의 / 임의 uuid / `bad-id` → 404.
- 토큰 없음 → 401.
