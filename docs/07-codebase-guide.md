# 07. 코드베이스 가이드

> 현재 코드 근거로 만든 에이전트 내비게이션 인덱스. 소스 탐색을 좁히는 용도이며
> 검증을 대체하지 않는다. 항목이 코드와 충돌하면 코드를 따르고 항목을 갱신한다.

## 사용법

1. 요청 동작과 관련된 항목을 찾는다.
2. 이 가이드를 갱신한 마지막 커밋 이후 해당 항목의 evidence 경로가 (커밋·스테이지·
   워킹) 변경됐는지 확인한다.
3. 대상 파일, 직접 호출자/피호출자, 관련 테스트, 정본 예시를 읽는다.
4. 소유권이 없거나 stale하거나 모순될 때만 탐색을 넓힌다.

## Module Map

계층 규칙: `service`(HTTP) → `domain`(DB 로직) → `database`(공유). 각 도메인은
`domain/<area>`와 (공개 API가 있으면) `service/<area>` 쌍으로 존재한다.

| Area | Paths | 책임 | 진입점 | 의존 | 테스트 | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| auth | `src/domain/auth`, `src/service/auth` | 로컬·소셜 가입/로그인·refresh·비번변경·탈퇴·성인인증·프로필 | `AuthController`, `AuthService` | database, consents, credits, social identity provider | `auth.service.spec.ts`, `google-social-identity.provider.spec.ts`, `test/auth.e2e-spec.ts` | `src/domain/auth/auth.service.ts`, `src/domain/auth/social-identity.provider.ts` |
| characters | `src/domain/characters`, `src/service/characters` | 캐릭터 조회·검색·관계상태·프로필 이미지 | `CharactersController`, `CharactersService` | database, follows, posts, stories, media-url | `characters.service.spec.ts`, `characters.controller.spec.ts` | `src/domain/characters/characters.service.ts` |
| feed | `src/domain/feed`, `src/service/feed` | 개인화 피드(해시태그 선호 가중) | `FeedController`, `FeedService` | database, posts, events | `feed.service.spec.ts` | `src/domain/feed/feed.service.ts` |
| posts | `src/domain/posts`, `src/service/posts` | 게시글·댓글·반응 | `PostsController`, `PostsService` | database, auth, media-url | `posts.service.spec.ts`, `posts.controller.spec.ts` | `src/domain/posts/posts.service.ts` |
| stories | `src/domain/stories`, `src/service/stories` | 24h 스토리 | `StoriesController`, `StoriesService` | database, media-url | `stories.service.spec.ts` | `src/domain/stories/stories.service.ts` |
| follows | `src/domain/follows`, `src/service/follows` | 캐릭터 팔로우/언팔로우/목록 | `FollowsController`, `FollowsService` | database | `follows.service.spec.ts` | `src/domain/follows/follows.service.ts` |
| messages | `src/domain/messages`, `src/service/messages` | DM 대화·전송(크레딧 차감, opod-agent 호출) | `MessagesController`, `MessagesService` | database, credits, events, characters, reply-provider | `messages.service.spec.ts`, `message-reply.provider.spec.ts` | `src/domain/messages/messages.service.ts` |
| credits | `src/domain/credits`, `src/service/credits` | 크레딧 잔액·예약·충전·환불·출석 | `CreditsController`, `CreditsService` | database | `credits.service.spec.ts`, `payment-refund-coverage.spec.ts`, `test/credits.e2e-spec.ts` | `src/domain/credits/credits.service.ts`, `credit-pricing.ts` |
| consents | `src/domain/consents`, `src/service/consents` | 약관 문서 조회·동의 수집/변경 | `TermsController`, `ConsentsController`, `ConsentsService` | database | `consents.service.spec.ts` | `src/domain/consents/consents.service.ts` |
| notifications | `src/domain/notifications`, `src/service/notifications` | 알림 목록·읽음 | `NotificationsController`, `NotificationsService` | database | `notifications.service.spec.ts`, `test/notifications.e2e-spec.ts` | `src/domain/notifications/notifications.service.ts` |
| reports | `src/domain/reports`, `src/service/reports` | 신고 접수·본인 조회 (처리는 admin) | `ReportsController`, `ReportsService` | database | `reports.service.spec.ts` | `src/domain/reports/reports.service.ts` |
| events | `src/domain/events`, `src/service/events` | 클라이언트 이벤트 수집 + 해시태그 선호 갱신 | `EventsController`, `EventsService` | database, posts, characters | `events.service.spec.ts`, `events.controller.spec.ts` | `src/domain/events/events.service.ts` |
| inquiries | `src/domain/inquiries`, `src/service/inquiries` | 1:1 문의 접수·조회·삭제 | `InquiriesController`, `InquiriesService` | database, auth | `inquiries.service.spec.ts`, `test/inquiries.e2e-spec.ts` | `src/domain/inquiries/inquiries.service.ts` |
| faqs / notices | `src/domain/faqs`, `src/domain/notices`, `src/service/*` | 공개 FAQ·공지 조회 | `FaqsController`, `NoticesController` | database | `test/faqs.e2e-spec.ts`, `test/notices.e2e-spec.ts` | `src/domain/notices/notices.service.ts` |
| search | `src/service/search` | 통합 검색(캐릭터·게시글·해시태그) | `SearchController` | characters, posts | `test/visibility.e2e-spec.ts` | `src/service/search/search.controller.ts` |
| health | `src/service/health` | 헬스체크 | `HealthController` | — | `test/health.e2e-spec.ts` | `src/service/health/health.controller.ts` |
| users | `src/domain/users` | 유저 도메인 헬퍼(컨트롤러 없음) | `UsersService` | database | — | `src/domain/users/users.service.ts` |

## Shared Capability Catalog

정본 소유자를 쓰고 형제 구현을 만들지 않는다.

| 능력 | 정본 파일/심볼 | 사용처 | 계약/제약 | Evidence |
| --- | --- | --- | --- | --- |
| DB 접근 | `PrismaService` | 모든 도메인 서비스 | 유일 DB 클라이언트. `pg`·별도 client 금지 | `src/domain/database/prisma.service.ts` |
| 커서 페이지네이션 | `parsePageQuery`/`decodeCursor`/`pageFromRows` | 목록 API 전반 | limit 기본 20·최대 50, `{items,nextCursor?}` | `src/domain/database/page.ts` |
| UUID 검증 | `isUuid` | 404 정규화(posts, notices, inquiries…) | 비-uuid는 질의 전에 없음 처리 | `src/domain/database/uuid.ts` |
| 인증 추출 | `AuthService.userIdFromAuthorization` 등 | 인증 필요한 모든 컨트롤러 | Bearer JWT → userId. 선택 인증은 `optional*` | `src/domain/auth/auth.service.ts` |
| 소셜 ID 토큰 검증 | `SOCIAL_IDENTITY_PROVIDERS` / `SocialIdentityProvider` | `AuthService.socialLogin` | provider adapter가 검증 완료 `sub`·verified email·이름만 반환. 현재 Google 등록 | `src/domain/auth/social-identity.provider.ts`, `src/domain/auth/google-social-identity.provider.ts` |
| 크레딧 예약/캡처 | `CreditsService.reserveCredits`/`captureReservation`/`releaseReservation` | messages(chat_reply) 등 액션 | 멱등·사용자 단위 직렬화·TTL 5분 | `src/domain/credits/credits.service.ts` |
| 요금 상수 | `credit-pricing.ts` | credits, messages | `credit-policy.md`와 일치해야 함 | `src/domain/credits/credit-pricing.ts` |
| 미디어 공개 URL | `publicMediaUrl` | posts, stories | `S3_PUBLIC_BASE_URL`로 조립 | `src/domain/media/media-url.ts` |
| DM 답장 provider | `MESSAGE_REPLY_PROVIDER` / `createMessageReplyProvider` | messages | opod-agent 호출(OpenAI 호환), 주입형(테스트 대체) | `src/domain/messages/message-reply.provider.ts` |
| 요청 로깅 | `RequestLoggingInterceptor` | 전역(APP_INTERCEPTOR) | 성공 읽기 무로그, 쓰기·실패만 | `src/service/request-logging.interceptor.ts` |
| Swagger 셋업/예시 | `setupServiceSwagger` | main | operationId 기준 예시·태그 주입 | `src/service/swagger.ts` |

## 코드 컨벤션과 정본 예시

| 관심사 | 컨벤션 | 정본 예시 | 적용 범위 | Evidence |
| --- | --- | --- | --- | --- |
| 파일 배치 | `domain/<area>`(로직) + `service/<area>`(HTTP) 쌍. 순수 조회·집계는 service-only(스키마·도메인 폴더 생략) | posts / `service/search` | 전 도메인 | `src/architecture.spec.ts` |
| 오류 처리 | Nest HttpException, 소유/비-uuid는 404 정규화, 현재비번 불일치 400 | `posts.controller.ts`, `auth.service.ts` | 컨트롤러·서비스 | `src/service/posts/posts.controller.ts` |
| 로깅/관측 | 쓰기·실패만 앱 로그, durable은 `service_logs` | `messages.service.ts`(실패 시 serviceLog) | 전역 | `src/service/request-logging.interceptor.ts` |
| DI | 생성자 주입, 도메인 모듈 export → service 모듈 import | `service/posts/posts.module.ts` | 전 모듈 | `src/service/service.module.ts` |
| 검증/변환 | (결정) DTO/컨트롤러=구문검증, 도메인=비즈니스 불변식. `unknown` 방어는 비-DTO 입력(webhook·헤더·외부응답)·보안필드만. 현재 도메인 과방어는 점진 정리(gap) | `service/search/search.controller.ts`(쿼리 파싱), `auth.service.ts`(과방어 예) | 전 도메인 | `docs/02-development-rules.md` |
| DB→응답 매핑 | 서비스 `to*` 매퍼가 Date→ISO, 선택필드 조건부 포함 | `posts.service.ts`(`toPost`) | 전 서비스 | `src/domain/posts/posts.service.ts` |
| 동시성 | `pg_advisory_xact_lock`로 사용자/식별키 단위 직렬화 | `auth.service.ts`(`lockUserSessions`), credits | auth, credits | `src/domain/auth/auth.service.ts` |
| 테스트 | 도메인 unit spec + HTTP e2e(Testcontainers) | `credits.service.spec.ts`, `test/*.e2e-spec.ts` | 전 도메인 | `test/e2e-global-setup.ts` |

## 의존·소유 규칙

- 허용 방향: `service` → `domain` → `domain/database`. 역방향·형제 우회 금지.
- 우회 금지 경계: `service`는 admin을 import하지 않는다. HTTP 컨트롤러는
  `domain`에 두지 않는다. DB는 `PrismaService`로만 접근.
- 재구현 금지: 위 Shared Capability Catalog의 정본을 재구현하지 않는다.
- 강제 수단: `src/architecture.spec.ts` (계층·경계·도메인 폴더·UUIDv7·persistence).

## 신규 도메인 추가 (결정된 2단계 규칙)

정본 예시: `inquiries`(풀스택), `search`/`health`(서비스-only).

**A. 풀스택 도메인** — 새 테이블 또는 고유 비즈니스/조회 로직이 있을 때.

1. 스키마: `prisma/schema.prisma`에 모델 추가 — UUIDv7 PK(`@default(uuid(7))
   @db.Uuid`), 컬럼 snake_case(`@map`), 타임스탬프 `@db.Timestamptz(6)`,
   `@@map`+`@@schema("opod")`. `npm run db:migrate` + `db:generate` → admin 미러
   갱신·drift 검사. 새 도메인 폴더면 `architecture.spec.ts`의
   `expectedDomainEntries`에 추가.
2. 도메인 `src/domain/<area>/`: `<area>.service.ts`(`@Injectable`, `PrismaService`
   주입, DB 접근 + 비즈니스 불변식, 도메인 타입 + `to*` 매퍼, `page.ts`/`uuid.ts`
   재사용) · `<area>.module.ts`(providers/exports/imports) · `<area>.service.spec.ts`.
3. 서비스 `src/service/<area>/`: `<area>.controller.ts`(`@Controller`, 인증 추출 +
   DTO 구문검증 + 도메인 호출 + 404 정규화 + Swagger) · `<area>.dto.ts` ·
   `<area>.module.ts`. **`src/service/service.module.ts` imports에 등록**.
4. 크로스커팅: `src/service/swagger.ts`의 `tagByPathSegment` 태그 매핑, 필요 시
   `test/<area>.e2e-spec.ts`.

**B. 서비스-only** — 새 테이블 없이 기존 도메인 서비스 조합만 하는 순수 조회·집계.

- `src/service/<area>/` 컨트롤러 + 모듈만. 컨트롤러가 기존 도메인 서비스를 주입해
  조합(정본: `src/service/search/search.controller.ts`,
  `src/service/search/search.module.ts`).
- 스키마·`src/domain/<area>` 폴더·`expectedDomainEntries` 갱신을 **생략**한다.

## Verification Map

| 영역 | 좁은 명령 | 넓은 명령 | 기대 | Evidence |
| --- | --- | --- | --- | --- |
| 타입/빌드 | `npm run build` | — | tsc strict 통과 | `tsconfig.json` |
| 린트/포맷 | `npm run lint` / `npm run format` | — | eslint·prettier 통과 | `eslint.config.mjs` |
| 도메인 로직 | `npm run test -- <area>.service.spec` | `npm run test` | 관련 spec 통과 | `package.json` jest |
| HTTP 계약 | `npm run test:e2e` (Docker 필요) | 동일 | Testcontainers Postgres로 e2e 통과 | `test/jest-e2e.json` |
| 아키텍처 규칙 | `npm run test -- architecture` | — | 계층·경계 유지 | `src/architecture.spec.ts` |

## Excluded Paths

| 경로 | 이유 | 정본 |
| --- | --- | --- |
| `node_modules/`, `dist/` | 의존성·빌드 산출물 | package.json |
| `prisma/migrations/**` | 생성된 SQL(수기 편집 금지) | `prisma/schema.prisma` |
| `test/.tmp/` | e2e 런타임 임시(gitignore) | `test/e2e-global-setup.ts` |
| `docker-compose.yml`(루트) | 서버-로컬 운영 파일(gitignore) | 서버 `~/opod-backend` |

## Known Gaps

- **정책↔코드 drift** (2026-07-29 결정, 코드 미반영):
  - 탈퇴 이메일 원문 보관 + 동일 이메일 재가입 차단 ↔ `auth.service.ts`가
    `email=null`, `test/auth.e2e-spec.ts`가 재가입 성공을 검증, `api/auth.md`가
    즉시 재가입 명시.
  - 1:1 문의 일일 10건 제한 제거 ↔ `inquiries.service.ts`가 하루 10건 제한,
    `api/support.md`가 429.
  - 무기한 보존 ↔ `db-management.md`가 "런타임 산출물은 보존 정책으로 정리".
- **미해결**: `chat_reply` 원가·마진(측정 필요) → 2크레딧 가격 미확정.
  결제·성인인증 provider 실연동 방향. staging/rollback/backup/monitoring.
- **미매핑**: opod-agent가 쓰는 `agent_*` 테이블의 서비스측 read 경로(현재
  서비스 코드에서 사용 안 함). 관계 메모리 노출은 미구현.
- affinity 관련 코드는 존재하지 않음(스키마에 `affinity` 컬럼 없음). 정책은 초안.
