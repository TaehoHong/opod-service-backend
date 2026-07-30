# Google 소셜 로그인 기반 설정 및 구현 계획

## 상태

- 구현 승인됨 (2026-07-30)
- 구현 및 검증 완료 (2026-07-30)

## 목표

클라이언트가 전달한 Google ID 토큰을 백엔드가 검증하고, Google 계정을
`user_accounts`에서 조회하거나 신규 생성한 뒤 기존 OPOD access/refresh JWT를
발급한다. provider별 검증 경계는 이후 Apple·Naver를 같은 API에 추가할 수 있게
공통화하되, 이번 구현에는 Google만 등록한다.

## 현재 근거

- HTTP 진입점은 `src/service/auth/AuthController`, DB-backed 인증 규칙과 JWT 발급은
  `src/domain/auth/AuthService`가 소유한다. (`repo-evidenced`)
- 필수 가입 동의는 `ConsentsService`, 가입 보너스는 `CreditsService`가 기존
  정본이다. (`repo-evidenced`)
- canonical Prisma schema는 service backend에 있고 admin schema는 공유 DB
  mirror이다. (`repo-evidenced`)
- 현재 schema와 migration history에는 `user_accounts`가 없다. 실제 운영 DB의
  수동 생성 여부는 확인되지 않았다. (`repo-evidenced`)
- `users.email`, `password_hash`, `password_salt`는 이미 nullable이지만 현재
  public-user 매핑 일부가 email 존재를 요구하므로 소셜 User를 처리하지 못한다.
  (`repo-evidenced`)

## 확정된 기능 계약

### API와 인증

- 엔드포인트는 `POST /auth/social/:provider`이다. (`user-confirmed`)
- provider는 소문자로 정규화한 뒤 비교하고 DB에도 소문자로 저장한다.
  `google`, `Google`, `GOOGLE`은 모두 Google로 처리한다. (`user-confirmed`)
- 요청은 `{ idToken, displayName?, consents? }`이다. provider callback이나
  authorization-code 교환은 백엔드에 두지 않는다. (`user-confirmed`)
- 이번 지원 provider는 Google뿐이다. Apple·Naver 구현과 설정은 추가하지 않는다.
  (`user-confirmed`)
- Google 검증은 공식 `google-auth-library`의 `verifyIdToken`을 사용해 서명,
  issuer, audience, expiration을 검증하고 `sub`를 provider identity로 쓴다.
  (`user-confirmed`)
- nonce 검증은 넣지 않는다. ID 토큰 원문은 로그와 오류에 남기지 않는다.
  (`user-confirmed`)
- `GOOGLE_OAUTH_CLIENT_ID`가 없으면 애플리케이션 시작을 실패시킨다.
  `google_secret.json`과 client secret은 런타임에 사용하지 않는다.
  (`user-confirmed`)

### 계정과 데이터

- 로컬 계정은 `users.email/password_hash/password_salt`, 소셜 계정은
  `user_accounts`가 자격 정보를 소유한다. (`user-confirmed`)
- 로컬 계정과 소셜 계정의 email이 같아도 자동 연결하지 않고 서로 다른 OPOD
  User로 만든다. 수동 연결도 이번 범위에 없다. (`user-confirmed`)
- `user_accounts`는 다음 공통 필드만 가진다. (`user-confirmed`)
  - UUIDv7 `id`
  - `user_id`
  - 소문자 문자열 `provider`
  - provider의 고유 subject인 `provider_account_id`
  - nullable `email`
  - `created_at`, `updated_at`
- `(provider, provider_account_id)`와 `(user_id, provider)`를 각각 unique로
  보장한다. provider lookup table이나 DB enum은 만들지 않는다.
  (`user-confirmed`)
- social User의 `users.email/password_hash/password_salt`는 null이다.
  API의 `user.email`은 항상 key를 포함하되 `string | null`이다.
  (`user-confirmed`)
- Google이 `email_verified=true`로 준 email만 저장·갱신한다. 신규 응답에
  검증 email이 없으면 null, 기존 로그인에서 미검증/누락 email이면 저장된 값을
  유지한다. email은 identity나 linking key로 사용하지 않는다. (`user-confirmed`)
- 계정 탈퇴를 위한 `deleted_at`, 재가입 제한용 식별자 등은 이번 schema에
  선반영하지 않는다. 탈퇴 기능 구현 시 별도 migration으로 추가한다.
  (`user-confirmed` scope + smallest-change rule)

### 신규 가입과 재로그인

- 검증된 `(provider, sub)`가 있으면 같은 User로 로그인하고 기존 OPOD
  access/refresh JWT를 발급한다. 요청의 `consents`와 `displayName`은 기존
  계정을 수정하지 않는다. (`user-confirmed`)
- 없으면 User, UserAccount, 현재 필수 약관 동의를 하나의 DB transaction에서
  생성한다. 필수 동의가 누락됐거나 현행 버전이 아니면 기존 가입 규칙대로
  거절한다. (`user-confirmed`)
- 최초 표시 이름 우선순위는 Google `name` → 공백이 아닌 client `displayName`
  → `사용자#<랜덤 영숫자 6자리>`이다. 이후 provider 값으로 자동 동기화하지
  않는다. (`user-confirmed`)
- 신규 social User에도 기존의 멱등적인 가입 보너스를 한 번 지급한다.
  (`user-confirmed`)
- 같은 provider/sub의 동시 최초 요청은 식별키 advisory transaction lock과 DB
  unique constraint로 직렬화하여 User/UserAccount를 하나만 만든다.
  (`repo-evidenced concurrency pattern`, data rule `user-confirmed`)

### 기존 인증 API와 오류

- social User도 `/auth/me`, `PATCH /auth/me`, refresh, session revoke를 기존
  JWT로 정상 사용한다. (`user-confirmed`)
- social-only User의 `PATCH /auth/password`는 `400 Bad Request`와
  `비밀번호 로그인이 설정되지 않은 계정입니다`를 반환한다. (`user-confirmed`)
- `idToken` 누락·빈 값과 미지원 provider는 `400 Bad Request`이다.
  서명·issuer·audience·만료를 포함한 토큰 검증 실패는 세부 원인을 숨기고
  `401 Unauthorized`와 `유효하지 않은 소셜 로그인 토큰입니다`를 반환한다.
  (`user-confirmed`)

## 구현 경계와 파일

### 1. Google ID 토큰에서 OPOD 세션까지

- `package.json`, `package-lock.json`
  - production dependency로 `google-auth-library`를 추가한다.
- `prisma/schema.prisma`
  - `UserAccount` 모델과 `User.userAccounts` relation, 두 unique constraint를
    추가한다.
- `prisma/migrations/<timestamp>_social_user_accounts/migration.sql`
  - canonical schema에서 Prisma가 생성한 migration을 사용하며 SQL을 수기
    작성하지 않는다.
- `../opod-admin/prisma/schema.prisma`
  - service canonical schema의 User/UserAccount 부분을 mirror한다.
- `src/domain/auth/social-identity.provider.ts` (신규)
  - `SocialIdentityProvider` 계약, 검증 완료 identity 타입, provider collection
    injection token을 소유한다.
- `src/domain/auth/google-social-identity.provider.ts` (신규)
  - Google 전용 검증과 `sub`/verified email/name 매핑, 공통 401 변환,
    `GOOGLE_OAUTH_CLIENT_ID` fail-fast를 소유한다.
- `src/domain/auth/auth.module.ts`
  - Google provider를 공통 provider collection에 등록한다.
- `src/domain/auth/auth.service.ts`
  - provider 정규화/선택, 기존 계정 로그인, 동시성-safe 신규 가입 transaction,
    가입 보너스, 기존 JWT 발급을 연결한다.
- `src/service/auth/auth.dto.ts`, `src/service/auth/auth.controller.ts`
  - social request DTO와 `POST /auth/social/:provider`를 노출하고
    `AuthUserDto.email`을 nullable로 문서화한다.
- `.env.production.example`, `.gitignore`
  - `GOOGLE_OAUTH_CLIENT_ID` 예시를 추가하고 `google_secret.json`을 ignore한다.
  - 실제 credential 값과 `google_secret.json` 내용은 복사·기록하지 않는다.

Observable outcome:
검증된 Google ID 토큰으로 최초 가입과 재로그인이 모두 기존 OPOD 세션 응답
`{ user, accessToken, refreshToken }`을 돌려준다.

Narrow verification:

- `npm run db:generate`
- `npm run test -- google-social-identity.provider.spec auth.service.spec`
- 기대 결과: Prisma 타입 생성 성공, provider trust boundary와 auth 도메인
  시나리오 통과

### 2. 소셜 User의 기존 인증 수명주기와 데이터 무결성

- `src/domain/auth/auth.service.ts`
  - public-user/refresh/current-user/profile-update 매핑을
    `users.email ?? verified user_accounts.email ?? null` 계약으로 바꾼다.
  - local login/password 로직은 nullable credential을 명시적으로 분기한다.
- `src/domain/auth/google-social-identity.provider.spec.ts` (신규)
  - Google claim 매핑, verified email만 반환, 검증 실패의 공통 401을 보호한다.
- `src/domain/auth/auth.service.spec.ts`
  - 공통 provider를 test double로 대체해 최초/재로그인, 동일 email 별도 User,
    동의/보너스, nullable email, social password 오류를 보호한다.
- `test/auth.e2e-spec.ts`
  - fake provider를 주입해 HTTP 계약, DB UserAccount 상태, 실제 OPOD JWT의
    `/auth/me`·profile update·refresh 동작, 동시 최초 요청의 단일 계정을
    보호한다.
- `test/jest-e2e.json`과 필요한 경우 최소 test setup 파일
  - 전체 e2e AppModule이 fail-fast 설정을 만족할 dummy client ID만 주입한다.
    production 검증을 우회하는 test-only 분기는 만들지 않는다.

Observable outcome:
social User가 기존 인증 API를 사용할 수 있고, 같은 provider/sub의 동시 요청이나
local account와 같은 email 때문에 계정이 합쳐지거나 중복 생성되지 않는다.

Narrow verification:

- `npm run test -- auth.service.spec google-social-identity.provider.spec`
- `npm run test:e2e -- auth.e2e-spec.ts`
- 기대 결과: 관련 unit/e2e 전부 통과, 동시 요청 후 UserAccount와 User가 각각
  하나, local/social same-email User ID는 서로 다름

### 3. 공개 계약과 공유 schema 정합성

- `src/service/swagger.ts`
  - social login 요청/응답과 오류 예시를 기존 Swagger 방식으로 추가한다.
- `docs/api/auth.md`
  - endpoint, request/response, nullable email, 분리 계정 정책, 오류를 문서화하고
    계정 탈퇴는 아직 social 미지원임을 명시한다.
- `docs/07-codebase-guide.md`
  - auth의 social identity provider 경계와 테스트 위치를 evidence와 함께
    갱신한다.
- `../opod-admin/prisma/schema.prisma`
  - canonical schema mirror 검사를 통과시킨다.

Observable outcome:
클라이언트와 운영자가 Google social login 계약 및 필수 환경 설정을 Swagger와
문서에서 확인하고, service/admin Prisma schema가 일치한다.

Narrow verification:

- backend: `npm run test -- swagger.e2e-spec`
- admin: `npm run schema:check && npm run db:generate`
- 기대 결과: Swagger 계약 검증 및 schema mirror/Prisma client 생성 성공

## 최종 검증

구현 완료 전 아래를 새로 실행하고 실제 결과만 보고한다.

Backend:

1. `npm run format`
2. `npm run lint`
3. `npm run test`
4. `npm run test:e2e`
5. `npm run build`

Admin schema mirror:

1. `npm run schema:check`
2. `npm run db:generate`

DB migration:

1. 로컬 Testcontainers/e2e에서 빈 DB migration 적용 성공
2. 생성 SQL에 `opod.user_accounts`, foreign key, 두 unique constraint가
   포함됐는지 검토
3. 운영 DB에는 이 작업에서 deploy하지 않으며, 실제 운영 DB에 동명 table이
   있는지 배포 전에 별도 확인

## 이번 범위에서 제외

- FCM 알림 연동 및 `FCM_KEY`
- Apple·Naver provider 구현과 환경 설정
- OAuth authorization code/callback/token exchange
- nonce 검증
- provider access/refresh token 저장
- local/social 자동 연결 및 수동 연결
- 계정 탈퇴, provider revoke, social 재인증
- 30일 재가입 제한, 탈퇴 비식별화, 탈퇴 관련 schema
- 운영 DB migration deploy

## 승인 게이트

이 문서는 구현 계획이다. 사용자가 이 전체 설계와 파일 경계를 본 뒤 명시적으로
구현을 지시하기 전에는 source, schema, migration, test를 수정하지 않는다.

## 검증 결과

- Backend Prisma client 생성: 통과
- Local DB migration 적용: 통과
- Backend format/lint/build: 통과
- Backend unit: 22 suites, 187 tests 통과
- Backend e2e: 9 suites, 61 tests 통과
- Admin schema mirror 및 Prisma client 생성: 통과
