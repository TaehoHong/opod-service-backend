# 02. 개발 규칙

> 분류 범례는 [00-overview.md](./00-overview.md) 참조. 상세 코드 내비게이션은
> [07-codebase-guide.md](./07-codebase-guide.md).

## Commands (사실 — package.json)

- Setup: `npm install`
- 마이그레이션 생성: `npm run db:generate` (Drizzle schema → `drizzle/` SQL)
- 로컬 DB 기동: `npm run db:up` (docker/docker-compose.yml, Postgres 5433)
- 로컬 스키마 적용: `npm run db:push` (**로컬 DB 전용** — 개발 DB 직접 실행 금지)
- 생성된 마이그레이션 적용: `npm run db:migrate`
- 서비스 실행: `npm run start:dev`
- Format: `npm run format` (prettier --check)
- Lint: `npm run lint` (eslint)
- Unit tests: `npm run test` (jest, `*.spec.ts`)
- Integration/E2E: `npm run test:e2e` (Testcontainers Postgres 필요 — Docker 요구)
- Build/typecheck: `npm run build` (nest build, tsc strict)

## Repository 의존 절대 규칙 (2026-09-22 사용자 확정)

이 규칙은 `opod-service-backend`(opod-backend)와 `opod-admin`에 동일하게 적용한다.
권고가 아닌 필수 컨벤션이며, 기존 코드 패턴이나 편의를 이유로 우회할 수 없다.
이전의 “Application Service가 Repository를 직접 주입한다”는 규칙을 대체한다.

1. **Repository는 테이블당 하나**로 둔다. 기능별로 같은 테이블의 Repository를 중복 생성하지 않는다.
2. **A Repository에 의존할 수 있는 업무 계층은 소유자인 A Domain Service뿐이다.**
   Repository를 직접 주입·생성·호출하거나 DI 컨테이너에서 조회하는 행위를 포함한다.
3. **B Domain Service가 A 테이블의 기능을 사용하려면 반드시 A Domain Service를 호출한다.**
   B Domain Service가 A Repository를 직접 사용하는 것은 금지한다.
4. **Application Service / Facade Service / UseCase Service는 Domain Service들을 조합한다.**
   이 계층은 Repository를 직접 의존하지 않는다. 이름에 `Service`가 붙었다는 이유만으로
   Repository 접근 권한을 갖는 것은 아니다.
5. Controller, Worker, Scheduler 및 다른 Repository도 Repository를 직접 사용하지 않는다.
   해당 Domain Service를 거쳐야 하며, 여러 도메인의 유스케이스는 Application Service가 조율한다.
6. Domain Service는 Repository 또는 DB client를 외부에 반환해 우회 통로를 만들지 않는다.
   다른 도메인에는 업무 메서드와 결과를 제공한다. 직접 SQL·DB client 접근으로 경계를 우회하는 것도 금지한다.
7. 여러 도메인에 걸친 트랜잭션에서도 이 의존 규칙은 유지한다.
   트랜잭션이 필요하다는 이유로 Application Service나 B Domain Service가 A Repository에 접근할 수 없다.
   구체적인 트랜잭션 전파 방식은 기능 설계에서 정하되, 필요한 원자성을 유지한다.

| 의존 또는 호출 | 허용 여부 |
| --- | --- |
| A Domain Service → A Repository | 허용 |
| B Domain Service → A Domain Service → A Repository | 허용 |
| Application Service → A/B Domain Service → 각 소유 Repository | 허용 |
| B Domain Service → A Repository | 금지 |
| Application / Facade / UseCase Service → Repository | 금지 |
| Controller / Worker / Scheduler → Repository | 금지 |
| A Repository → B Repository | 금지 |

Nest module의 provider 등록은 객체 구성 작업이며, 업무 코드의 Repository 접근을
허용하는 예외가 아니다. 다른 모듈에는 Domain Service를 공개하고 Repository를
다른 도메인의 호출 진입점으로 공개하지 않는다.

실제 클래스명은 `CharacterService`, `PostReactionService`, `CharacterFollowService`처럼
`Domain`을 붙이지 않는다. Domain Service는 역할을 가리키는 용어다. 유스케이스 조율자는
`CharacterSocialActivityApplicationService`처럼 `ApplicationService` 접미사로 구분한다.

Domain Service는 자기 도메인의 정책·불변식과 Repository 접근을 소유한다.
Application Service는 유스케이스 순서와 여러 Domain Service의 협력을 조율한다.
다른 Domain Service 호출 시 순환 의존을 만들지 않도록 협력 방향을 설계한다.

기존 코드가 이 규칙과 다르면 **예외가 아니라 미준수 리팩터링 대상**이다.
새 설계·신규 코드·변경 코드의 의존 관계는 이 규칙을 따라야 하며,
문서 갱신만으로 기존 구현까지 전환된 것으로 간주하지 않는다.
기존 위반을 발견해도 요청 범위를 넘어 자동 리팩터링하지 않고 별도 변경으로 다룬다.

리뷰에서는 Repository의 주입자·호출자, 타 도메인의 접근 경로, 모듈의 공개 provider를 확인한다.
소셜 활동 관련 Repository의 정적 import와 모듈 export는 아키텍처 테스트로 검사한다.
검사 범위는 해당 기능에 한정되며, 프로젝트 전체의 기존 위반이나 동적 우회까지
검증한 것으로 보지 않는다. 직접 SQL과 테이블별 소유권도 코드 리뷰에서 확인한다.

## Code Rules

- 명시적으로 확정한 컨벤션을 우선하고, 그 범위 안에서 기존 패턴을 따른다. 새 도메인은 `src/domain/<area>` + `src/service/<area>`
  쌍으로 만들고, HTTP는 service, DB 로직은 domain에 둔다. (사실)
- 변경은 요청 범위로 한정한다. 무관한 사용자 변경을 되돌리지 않는다.
- 추상화는 실제 복잡도를 줄일 때만 추가한다.
- **계층·경계 규칙** (테스트로 강제 — `src/architecture.spec.ts`):
  - `src` 최상위는 `app.module.ts`, `main.ts`, `architecture.spec.ts`,
    `domain/`, `service/`만 허용.
  - HTTP 컨트롤러(`*.controller.ts`)는 `src/domain`에 두지 않는다.
  - `src/service`는 admin 모듈을 import 하지 않는다 (`from ... admin` 금지).
  - `src/admin`·`packages/admin`을 만들지 않는다 (admin은 opod-admin 소관).
  - `src/domain` 폴더 집합은 DB 그룹과 정렬 (auth, characters, consents,
    credits, database, events, faqs, feed, follows, inquiries, media, messages,
    notices, notifications, posts, reports, stories, users).
- **UUID 규칙**: UUID PK 값은 `uuidv7()`로 생성한다. DB schema는 `uuid`
  컬럼을 선언하고 서비스가 insert 시 UUIDv7을 넣는다. (사실)
- **DB 접근**: 앱 런타임의 모든 접근은 `DatabaseService`
  (`src/domain/database`)를 통한다. 마이그레이션 실행기 외에 `pg`·별도 client·
  DB-free fallback을 만들지 않는다 (architecture.spec.ts). (사실)
- 컨벤션·정본 예시는 [07-codebase-guide.md](./07-codebase-guide.md)의
  "코드 컨벤션과 정본 예시" 표를 따른다.

## 결정된 코드 컨벤션 (2026-07-29 인터뷰 확정)

이 절은 관찰된 관행이 아니라 **결정된 규칙**이다.

- **입력 검증 = 계층 분리** (결정):
  - DTO/컨트롤러가 **구문 검증**(타입·필수·길이·enum·형식)을 class-validator +
    전역 ValidationPipe로 소유한다. 쿼리 파라미터는 컨트롤러에서 파싱한다
    (정본 예: `src/service/search/search.controller.ts`).
  - 도메인 서비스는 **비즈니스 불변식**(소유권·유일성·상태전이·정책)을 소유하며,
    구문상 유효한(타입) 입력은 신뢰한다.
  - **방어적 `unknown` 파싱은 DTO를 거치지 않는 진짜 비신뢰 입력에만** 쓴다 —
    webhook 바디, `x-opod-*` 헤더, 외부 provider 응답. 비밀번호 등 보안 필드의
    도메인 assert는 좁은 예외(defense-in-depth).
  - (gap) 현재 도메인 서비스의 광범위한 `unknown` 재검증(`auth.service.ts`·
    `posts.service.ts` 등)은 이 규칙보다 과방어다 → 점진적 정리 대상(버그 아님).
- **주석·문서 언어 = 한국어 주석 + 영어 식별자** (결정): 코드 주석·문서는 한국어,
  식별자·타입·API 필드는 영어.
- **신규 도메인 추가 = 2단계 규칙** (결정):
  - 풀스택 도메인(기본): 새 테이블 또는 고유 비즈니스/조회 로직이 있으면
    `src/domain/database/schema.ts` + `src/domain/<area>` + `src/service/<area>` +
    `architecture.spec.ts`의 `expectedDomainEntries` 갱신. 절차 상세는
    [07-codebase-guide.md](./07-codebase-guide.md) "신규 도메인 추가" 참조.
  - 서비스-only(예외): 새 테이블 없이 기존 도메인 서비스 조합만 하는 순수 조회·
    집계는 `src/service/<area>`만 만들고 schema·domain 폴더·spec 목록 갱신을
    생략한다. 정본 예: `src/service/search`, `src/service/health`.
- **커밋/브랜치 = Conventional Commits + main 직커밋** (결정): `feat`/`fix`/
  `chore`/`refactor`/`docs` 프리픽스, main 브랜치 중심 직커밋.

## DB 환경 용어 (2026-08-06 결정 — 정본)

DB를 가리킬 때 **아래 네 단어만 쓴다.** 문서·주석·커밋 메시지·대화 전부에
적용한다. "개발 DB"와 "로컬 DB"를 섞어 쓰면 파괴적 작업의 대상이 흐려진다.

| 용어 | 실체 | 비고 |
|---|---|---|
| **로컬 DB** | 작업 중인 개별 PC의 localhost. `npm run db:up`이 띄우는 Docker Postgres(`docker/docker-compose.yml`, 5433) | 개발자마다 따로 있다. `db:push` 허용 대상은 여기뿐 |
| **개발 DB** | `dev-run-taeho` 서버에 떠 있는 개발서버용 DB. `deploy.sh`의 원격 호스트 | 공용이다. 파괴적 작업 금지 |
| **운영 DB** | **아직 없다** | 생기기 전까지 "운영"을 다른 환경을 가리키는 데 쓰지 않는다 |
| **테스트 DB** | Testcontainers가 테스트 실행마다 새로 띄우는 일회용 컨테이너 | 매번 빈 DB에 `npm run db:migrate:deploy` 전체 적용. 상태가 남지 않는다 |

`deploy.sh`가 배포하는 대상은 **개발 DB**다. 배포·마이그레이션 문서에서 이를
"Production"이라 부르지 않는다.

## Review Rules

- 동작 변경은 가치 있는 회귀 테스트 또는 그에 준하는 명시 검증을 요구한다.
  커버리지·관습만을 위한 테스트는 추가하지 않는다 (05-quality-rules 참조).
- 공유 로직(예: `src/domain/database` 헬퍼, `AuthService`, `CreditsService`)
  변경은 더 넓은 회귀 검증을 요구한다.
- 스키마 변경은 [db-management.md](./db-management.md)의 Drizzle 절차와
  admin 미러 정합을 따른다.
