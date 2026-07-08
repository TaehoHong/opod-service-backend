# OPOD 계정 관리 / 고객지원 정책

- 상태: v1 초안 (2026-07-08)
- 범위: 비밀번호 변경, 회원탈퇴(즉시 익명화), FAQ, 공지사항, 1:1 문의
- 범위 밖: 이메일 인증, 비밀번호 재설정 (메일 발송 인프라 필요 — 다음 배치, §9),
  소셜 로그인, 2FA, 계정 정지/차단, 레이트리밋 인프라

---

## 0. 핵심 결정 요약

| 항목 | 결정 |
|---|---|
| 비밀번호 변경 | 현재 비밀번호 재확인 필수. 변경 즉시 **모든 리프레시 토큰 폐기** 후 새 토큰 페어 발급 (현재 기기만 로그인 유지) |
| 회원탈퇴 | **즉시 익명화** — 유예 기간 없음, 복구 불가. `users` 행은 유지하고 개인정보 필드만 파기 |
| 탈퇴 후 재가입 | 동일 이메일로 **즉시 재가입 허용**. 단 탈퇴 후 30일 내 재가입 시 **가입 보너스 미지급** (어뷰징 차단) |
| 이메일 보관 | 원문/암호문 **미보관**. HMAC 해시만 30일 보관 후 파기. 결제 분쟁 연락은 PSP(Polar) 측 기록 활용 |
| FAQ / 공지사항 | **비로그인 공개 조회**. 콘텐츠 등록·발행은 `opod-admin` 소관, 이 레포는 조회 API + 스키마만 |
| 1:1 문의 | 로그인 필수. **단건 문의 → 단건 답변** (스레드 없음). 답변 전 삭제 가능, 답변 시 인앱 알림 |
| 문의 첨부파일 | MVP 미지원 (유저 미디어 업로드 인프라 부재) — 텍스트만 |
| 비번 분실 대응 | 재설정 기능 도입 전까지 **복구 불가** — 알려진 리스크로 수용, FAQ에 고지 (§9) |

---

## 1. 비밀번호 변경

### 1.1 정책

- 로그인 상태에서 `현재 비밀번호 + 새 비밀번호`를 받아 변경한다.
- 현재 비밀번호 재확인은 **생략 불가** — 액세스 토큰 탈취만으로 비밀번호를
  바꿔 계정을 완전히 탈취하는 경로를 막는다.
- 새 비밀번호 규칙은 가입과 동일하게 유지한다: **8자 이상 128자 이하**.
  (규칙은 가입/변경이 항상 같은 검증 함수를 공유한다.)
- 새 비밀번호는 현재 비밀번호와 달라야 한다.
- 변경 성공 시:
  1. 새 salt로 해시를 재생성해 저장한다.
  2. 해당 유저의 **모든 리프레시 토큰을 폐기**한다 — 비밀번호 변경의 주된
     동기가 "유출 의심"이므로 다른 기기 세션을 전부 끊는 것이 기본값이다.
  3. 새 토큰 페어(access + refresh)를 발급해 응답한다 — 변경한 현재 기기는
     로그인이 유지된다.
- 잔여 액세스 토큰(최대 15분)은 stateless라 즉시 무효화하지 않는다.
  수용 가능한 창으로 판단한다. (탈퇴는 다름 — §2.4)

### 1.2 API

```
PATCH /auth/password
Authorization: Bearer <access>
{ "currentPassword": "...", "newPassword": "..." }

200 → { user, accessToken, refreshToken }   // 로그인 응답과 동일 shape
400 → 현재 비밀번호 불일치, 새 비밀번호 규칙 위반, 현재와 동일
401 → 액세스 토큰 문제
```

- 현재 비밀번호 불일치는 401이 아닌 **400**으로 응답한다 — 클라이언트가
  "토큰 만료(재로그인 유도)"와 "입력 오류(재입력 유도)"를 구분해야 한다.

### 1.3 감사 기록

- 변경 성공 시 `user_events`에 `eventType: "auth.password_changed"`를 남긴다.
  (로그인 실패 잠금·레이트리밋은 범위 밖, 후속 로그인 보안 하드닝에서 다룬다.)

---

## 2. 회원탈퇴 (즉시 익명화)

### 2.1 방식 결정

**즉시 익명화**를 채택한다. 유예 기간(soft delete 후 N일 복구)은 두지 않는다.

- `users` **행 자체는 유지**하고 개인정보 필드만 파기한다. 크레딧 원장·결제
  기록이 `user_id` FK로 연결되어 있고, 이 기록들은 전자상거래법상 보존
  의무(결제·계약 5년, 분쟁처리 3년)가 있어 행 삭제가 불가능하다.
- 익명화된 행은 특정 개인과 연결할 수 없으므로 개인정보보호법상 "파기"에
  준하는 처리로 본다.
- 복구 불가는 탈퇴 화면에서 명시적으로 고지한다 (클라이언트 요건).

### 2.2 탈퇴 요건과 절차

- 비밀번호 재입력 필수 (탈취된 액세스 토큰만으로 탈퇴 불가).
- 탈퇴 사유는 **선택 입력** (카테고리 + 자유 텍스트 500자):
  `low_usage`(사용 빈도 낮음) / `credit_cost`(크레딧·가격 불만) /
  `content`(콘텐츠 불만) / `privacy`(개인정보 우려) / `etc`(기타)
- 잔여 크레딧은 **탈퇴 즉시 소멸**하며 복구·환불되지 않는다 — 탈퇴 화면
  고지 필수. (유료 크레딧 환불 자체는 크레딧 정책 문서 소관이며, 환불을
  원하면 탈퇴 전에 처리해야 한다.)
- 전체 처리는 **단일 트랜잭션**으로 수행한다.

### 2.3 데이터 처리 매트릭스

`users` 행을 삭제하지 않으므로 **cascade는 발동하지 않는다** — 아래 삭제는
전부 명시적으로 수행한다.

| 데이터 | 처리 | 근거 |
|---|---|---|
| `users` 행 | `email`·`passwordHash`·`passwordSalt` → null, `displayName` → `"탈퇴한 사용자"`, `deletedAt` 기록 | 행 유지로 원장 FK 보존, 식별자만 파기 |
| `user_refresh_tokens` | **전체 삭제** | 모든 세션 즉시 차단 |
| `credit_ledger_entries`, `credit_purchases`, `credit_reservations`, `credit_check_ins` | 유지 (익명 연결) | 전자상거래법 보존 의무 + 원장 무결성 |
| `message_conversations`, `messages` | **삭제** (대화 삭제 시 메시지 cascade) | 사적 대화, 보존 의무 없음, 민감도 높음 |
| `notifications` | **삭제** | 개인 대상 데이터, 가치 없음 |
| `user_character_follows` | **삭제** | 선호 데이터. 캐릭터 팔로워 수 정합성 유지 |
| `user_hashtag_preferences` | **삭제** | 추천용 파생 데이터 |
| `user_events` | 유지 (익명 연결) | 통계·감사용. 단 `metadata`에 PII를 넣지 않는 것을 규칙으로 한다 |
| `reports` (신고 이력) | 유지 (익명 연결) | 모더레이션·분쟁 기록 (3년) |
| `inquiries` (1:1 문의) | 유지 (익명 연결) | 소비자 분쟁처리 기록 (3년) |
| `user_withdrawals` | **생성** (§2.5) | 어뷰징 차단 + 탈퇴 사유 통계 |
| 진행 중 `credit_reservations` | 강제 해제하지 않음 | `expiresAt` 자연 만료에 맡김 — 탈퇴 후 잔액 개념 자체가 소멸 |

### 2.4 인증 차단

- 탈퇴 즉시 리프레시 토큰이 전부 삭제되므로 토큰 갱신은 불가능하다.
- 잔여 액세스 토큰(≤15분)도 차단해야 하므로, **모든 인증 검사에
  `deletedAt IS NULL` 조건을 추가**한다. (`userIdFromAuthorization`가 이미
  매 요청 유저 존재를 조회하므로 조건 추가만으로 충분하다.)
- 탈퇴 계정으로의 모든 API 호출은 401로 응답한다.

### 2.5 재가입과 어뷰징 차단

가입 보너스(100크레딧)가 있으므로 `가입 → 보너스 소진 → 탈퇴 → 재가입`
무한 반복이 가능하다. 이를 막는다:

- 탈퇴 시 `user_withdrawals`에 `emailHash = HMAC-SHA256(email, 서버 pepper)`를
  기록한다. **이메일 원문·암호문은 저장하지 않는다.**
- 가입 시 이메일 해시가 **30일 내 탈퇴 기록과 일치하면 가입 보너스를
  지급하지 않는다.** 가입 자체는 허용한다.
- 30일 경과한 `user_withdrawals` 행의 `emailHash`는 파기 대상이다.
  정리 배치는 opod-worker 소관이며, 워커 도입 전까지는 수동 정리한다.
- 결제 분쟁 시 탈퇴자 연락이 필요한 경우는 PSP(Polar) 측 결제자 기록을
  활용한다 — 백엔드가 이메일을 별도 보관하지 않는 근거.

### 2.6 API

```
DELETE /auth/me
Authorization: Bearer <access>
{ "password": "...", "reasonCategory": "low_usage"?, "reasonText": "..."? }

200 → { "deleted": true }
400 → 비밀번호 불일치
401 → 액세스 토큰 문제
```

---

## 3. FAQ

### 3.1 정책

- **비로그인 공개 조회.** 비밀번호를 잊어 로그인 못 하는 유저가 봐야 하는
  콘텐츠(§9)이므로 인증을 요구하지 않는다.
- 콘텐츠 등록·수정·발행은 `opod-admin` 소관. 이 레포는 스키마 + 조회 API만.
- `isPublished = true`인 항목만 노출한다.
- 정렬: `sortOrder` 오름차순 → `createdAt` 내림차순.
- 카테고리는 고정 enum이 아닌 **문자열**로 두어 마이그레이션 없이 운영에서
  조정 가능하게 한다. 초기 세트:
  `service`(서비스 이용) / `account`(계정) / `credit`(크레딧·결제) /
  `chat`(채팅·캐릭터) / `safety`(신고·안전) / `etc`(기타)
- 페이지네이션 없음 — FAQ는 수십 건 규모로 관리한다. 응답 상한 200건.

### 3.2 API

```
GET /faqs?category=credit        // category 생략 시 전체
200 → { "items": [{ id, category, question, answer, sortOrder }] }
```

---

## 4. 공지사항

### 4.1 정책

- **비로그인 공개 조회.** 등록·발행·고정은 `opod-admin` 소관.
- `publishedAt`이 설정되어 있고 현재 시각 이전인 항목만 노출한다
  (null = 초안, 미래 시각 = 예약 발행).
- 목록은 누적되므로 서비스 공통 커서 페이지네이션 규칙을 따른다.
- **고정 공지는 첫 페이지에서 `pinned` 배열로 분리 반환**하고, 일반 목록은
  `publishedAt` 내림차순으로 페이지네이션한다 — 고정 우선 정렬을 커서
  페이지네이션에 섞으면 페이지 경계가 깨지기 때문. 커서로 다음 페이지를
  요청하면 `pinned`는 다시 포함하지 않는다.
- 목록 응답에는 본문을 포함하지 않는다 (제목·발행일·고정 여부만).
  본문은 상세 API로 조회한다.

### 4.2 API

```
GET /notices?cursor=&limit=
200 → { pinned: [{ id, title, isPinned, publishedAt }],   // 첫 페이지만
        items: [{ id, title, isPinned, publishedAt }],
        nextCursor? }

GET /notices/:id
200 → { id, title, body, isPinned, publishedAt }
404 → 없음 또는 미발행
```

---

## 5. 1:1 문의

### 5.1 정책

- **로그인 필수.** 문의는 계정에 귀속된다.
- 구조는 **단건 문의 → 단건 답변**. 스레드(추가 문답)는 두지 않는다 —
  후속 질문은 새 문의로 받는다. MVP 복잡도를 크게 줄이고, 한국 소비자 앱의
  일반 관행과 일치한다.
- 입력: 카테고리 + 본문(최대 2,000자). 제목은 받지 않는다 — 모바일 입력
  마찰 최소화. 목록/어드민 화면은 본문 앞부분을 미리보기로 쓴다.
- 카테고리: `account`(계정) / `credit`(크레딧·결제) / `bug`(버그·오류) /
  `content`(콘텐츠·캐릭터) / `etc`(기타)
- 첨부파일 미지원 (유저 미디어 업로드 인프라 부재 — 도입 시 확장).
- 상태 흐름: `submitted`(접수) → `answered`(답변완료). 두 상태만 둔다.
- **답변 전(`submitted`)에만 유저가 삭제 가능.** 답변된 문의는 분쟁처리
  기록이므로 삭제 불가.
- 도배 방지: **1인당 하루(KST) 10건 제한.** 레이트리밋 인프라 없이 당일
  생성 건수 count로 구현한다.
- 답변 등록 시 인앱 알림 생성 (§5.3).
- 탈퇴 시 문의는 익명 상태로 유지된다 (§2.3).

### 5.2 API

```
POST /inquiries
{ "category": "credit", "body": "..." }
201 → { id, category, body, status, createdAt }
400 → 카테고리/본문 검증 실패
429 → 일일 한도 초과

GET /inquiries                    // 본인 것만, 페이지네이션, 최신순
200 → { items: [{ id, category, body, status, answeredAt, createdAt }], ... }

GET /inquiries/:id                // 본인 것만
200 → { id, category, body, status, answerBody, answeredAt, createdAt }
404 → 없거나 본인 소유 아님 (존재 여부 노출 방지 — 403 대신 404)

DELETE /inquiries/:id             // 본인 + submitted 상태만
200 → { "deleted": true }
409 → 이미 답변됨
404 → 없거나 본인 소유 아님
```

### 5.3 답변 알림 계약 (cross-repo)

답변은 `opod-admin`의 답변 API가 수행하며, 답변 저장과 같은 트랜잭션에서
`notifications`에 다음 형태로 insert한다:

```
type:       "inquiry.answered"
title:      "1:1 문의에 답변이 도착했어요"
targetType: "inquiry"
targetId:   <inquiry id>
```

이 레포는 타입 문자열 상수의 원본을 소유하고, `opod-admin`이 이를 따른다.

---

## 6. 스키마 변경 요약

```prisma
// User에 추가
updatedAt DateTime @updatedAt
deletedAt DateTime?              // null이 아니면 탈퇴 계정 — 모든 인증 검사에서 제외

enum InquiryStatus { submitted answered }

model Faq {
  id          String   // uuid(7)
  category    String
  question    String
  answer      String
  sortOrder   Int      @default(0)
  isPublished Boolean  @default(false)
  createdAt / updatedAt
  @@index([isPublished, category, sortOrder])
}

model Notice {
  id          String
  title       String
  body        String
  isPinned    Boolean   @default(false)
  publishedAt DateTime?           // null = 초안, 미래 = 예약 발행
  createdAt / updatedAt
  @@index([publishedAt])
}

model Inquiry {
  id          String
  userId      String              // User FK — 탈퇴 후에도 익명 행에 연결 유지
  category    String
  body        String
  status      InquiryStatus @default(submitted)
  answerBody  String?             // opod-admin이 기록
  answeredAt  DateTime?
  createdAt / updatedAt
  @@index([userId, createdAt])
  @@index([status, createdAt])    // opod-admin 미답변 큐 조회용
}

model UserWithdrawal {
  id             String
  userId         String           // FK 없는 평문 uuid — 익명 행과 느슨한 연결
  emailHash      String           // HMAC-SHA256(email, pepper). 30일 후 파기 대상
  reasonCategory String?
  reasonText     String?
  createdAt      DateTime
  @@index([emailHash])
}
```

환경 변수 추가: `AUTH_EMAIL_HASH_PEPPER` (탈퇴 이메일 해시용, 32바이트 이상).

---

## 7. API 요약

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| PATCH | `/auth/password` | ✔ | 비밀번호 변경 — 전 기기 로그아웃 + 새 토큰 발급 |
| DELETE | `/auth/me` | ✔ | 회원탈퇴 — 즉시 익명화, 복구 불가 |
| GET | `/faqs` | – | FAQ 목록 (category 필터, 발행분만) |
| GET | `/notices` | – | 공지 목록 (페이지네이션, 발행분만) |
| GET | `/notices/:id` | – | 공지 상세 |
| POST | `/inquiries` | ✔ | 문의 접수 (일 10건 제한) |
| GET | `/inquiries` | ✔ | 내 문의 목록 |
| GET | `/inquiries/:id` | ✔ | 내 문의 상세 (+답변) |
| DELETE | `/inquiries/:id` | ✔ | 답변 전 문의 삭제 |

## 8. 소유권 경계

| 기능 | opod-service-backend (이 레포) | opod-admin |
|---|---|---|
| 비밀번호 변경 / 탈퇴 | 전부 | 탈퇴 사유 통계 열람만 |
| FAQ | 스키마 + 공개 조회 API | 등록·수정·발행·정렬 |
| 공지사항 | 스키마 + 공개 조회 API | 등록·수정·발행·고정 |
| 1:1 문의 | 스키마 + 접수·조회·삭제 API | 답변 작성, 답변 알림 insert |

## 9. 보류 항목과 수용 리스크

- **이메일 인증, 비밀번호 재설정**: 메일 발송 인프라(벤더 선정 포함) 선행
  필요 — 다음 배치. 도입 시 이 문서를 갱신한다.
- 그 전까지의 **알려진 리스크**: 비밀번호를 잊으면 계정 복구 수단이 없다.
  1:1 문의도 로그인이 필요해 자가 복구 경로가 전혀 없다. FAQ에 이를
  고지하고, 문의 메일 주소를 안내한다. 재설정 기능이 이 리스크의 유일한
  해소책이므로 다음 배치 최우선으로 둔다.
- 로그인 브루트포스 방어(레이트리밋·실패 잠금)는 로그인 보안 하드닝
  항목으로 별도 진행한다.
