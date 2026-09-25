# 캐릭터 소셜 활동 서비스 경계 리팩터링

## 승인과 결정

- 사용자 승인: 설계를 다시 정리하고 서비스명에서 `Domain`을 제거한 뒤 “ㅇㅇ 코드 구현도 시작해”.
- D1 (`user-confirmed`): Repository는 테이블별 하나. 소유 Service만 해당 Repository 의존.
- D2 (`user-confirmed`): 다른 Service는 소유 Service를 경유. Application Service와 Worker는 Repository 접근 금지.
- D3 (`user-confirmed`): CharacterService, PostService, PostReactionService, CharacterPostViewService,
  CharacterFollowService, CharacterSocialActivityPolicyService, CharacterSocialActivityJobService 명명.
- D4 (`user-confirmed`): CharacterSocialActivityApplicationService는 유스케이스 조율자.
- D5 (`user-confirmed`): 기존 활동 규칙·API·스키마 유지, 관련 관리자 설정·중지·수동 반응 경로 포함.
- D6 (`repo-evidenced`, 승인 범위 내 구현 결정): CharacterService.withActivityTransaction을 진입점으로,
  DatabaseModule의 공유 AsyncLocalStorage 트랜잭션 컨텍스트를 각 Repository가 사용. DB client는 Service에 노출하지 않음.
- 과거 Application Service → Repository 직접 의존 설계는 폐기했다.

## 기존 소유자 확인

- `owner-found`: 기존 CharacterSocialRepository의 실행 동작과 실제 PostgreSQL E2E.
  사용자 확정 규칙에 맞춰 기능 조율·정책·테이블 접근을 분리하고 기존 집합 Repository는 제거한다.
- `owner-found`: admin CharactersService/CharacterRepository, SocialActivityPolicyService/Repository,
  AdminService/AdminContentRepository의 관련 쓰기. 이관한 책임은 중복으로 남기지 않는다.
- `owner-found`: DatabaseService 및 DatabaseModule은 유일한 DB 연결 소유자.
- `owner-absent`: 양쪽에 AsyncLocalStorage/CLS 트랜잭션 전파 구현 없음.
  도메인 협력에 필요한 좁은 트랜잭션 컨텍스트만 추가한다.
- `owner-rejected`: 활동 로그의 기존 CharacterRepository/AdminContentRepository 집합 소유는
  사용자 확정 테이블별 경계에 맞지 않는다. 일반 로그 기록·조회는 CharacterActionLogService/Repository로
  이관하며 기존 일반 메서드는 제거한다. 페르소나·메모리 두 원자 수정 내부 로그는 별도 레거시로 남긴다.
- 기존 다중 테이블 관리자 Repository에는 페르소나·메모리 등 범위 밖 기능이 섞여 있다.
  이번 기능의 책임 이관과 충돌하는 부분을 확인하되 프로젝트 전체 위반 정리는 하지 않는다.

## 범위와 작업 분담

- Backend Sol: `src/domain/character-social/*`, characters/posts 테이블 서비스·Repository,
  `src/domain/database` 트랜잭션 컨텍스트·모듈, 관련 DI wiring 및 runtime E2E.
- Admin Sol: 정책 API 조율·서비스·Repository, 관련 캐릭터 변경과 수동 반응,
  트랜잭션 컨텍스트·모듈, 해당 단위/E2E 테스트.
- Parent: 의존 경계 검사, 통합 검증, 온보딩/UML 및 02/06/07 문서 갱신.
- DB 마이그레이션 작성·실행, 지속 DB 변경, 배포, 활성화, 커밋은 제외.
- 기존 무관한 변경을 보존한다. 새 프레임워크·generic base repository는 추가하지 않는다.

## 체크리스트와 성공 기준

- [x] 예약·점유: 서비스 경계를 통과해도 중복 예약·단일 활성 작업·재시도·stale token 차단 유지.
- [x] 실행: 관심사/미조회 필터, 한도, 확률, 누적 좋아요 팔로우, 현지 자정/DST 동작 유지.
- [x] 트랜잭션: 여러 Service/Repository의 활동 쓰기와 완료 상태가 함께 커밋/롤백.
  동시 실행의 컨텍스트 격리, 중첩 실행의 독립 커밋 금지, 종료된 컨텍스트 접근 거부.
- [x] 관리자: 기존 API와 인증·CSRF·시간대 검증, 정책 중지·비활성화 취소·수동 반응 멱등성 유지.
- [x] 새 경로의 Repository 직접 의존은 소유 Service에만 존재하고 모듈은 Service만 공개.
- [x] 주요 코드 및 문서 diff 검토, 코드 링크와 Mermaid 렌더링 정합성 확인.
- [x] 양쪽 format/lint/unit/E2E/build, admin schema:check 통과.

## 검증 전략

기존 행동 중심 E2E를 새 서비스 호출 구조로 옮긴다. 확률/한도/동시 실행/DST/만료 복구와
실제 DB 잠금 중 lease 만료 롤백이 회귀를 검출해야 한다. 호출 횟수만 보는 테스트는 추가하지 않는다.
부가 검증은 새 트랜잭션 경계의 실제 롤백·컨텍스트 격리와 새 의존 규칙 위반을 잡는 데 한정한다.
테스트 DB는 Testcontainers 일회용 DB만 사용한다. 기존 승인된 마이그레이션을 테스트에서 사용한다.

## 진행·검증 결과

승인된 범위의 구현과 검증을 완료했다. 아키텍처 변경이므로 병합 전 사람이 의존 경계와 트랜잭션 전파를 검토해야 한다.

### 진행 기록 — 2026-09-23

- Backend 의존 경계 검사를 기존 구조에 적용했을 때 Worker/Module의 집합 Repository
  접근으로 실패함을 확인했다. 분리 후 같은 검사 8개가 통과했다.
- 검토에서 팔로우 페이지의 상한 초과, 종료된 트랜잭션 컨텍스트 재진입,
  관리자 DELETE의 정책 중지 우회 및 없는 캐릭터 응답 코드 보존을 확인해 회귀 검증에 포함한다.
- 온보딩 문서 13개 Mermaid 렌더링 성공. 최종 코드와의 정합성 검토는 진행 중이다.
- 사용자 “계속해”에 따라 중단된 두 Sol 구현 작업을 이어간다. 승인 범위는 변경하지 않는다.

### 통합 검증 — 2026-09-24

- Backend 부모 검증: `npm run test -- --runInBand` 27 suites / 150 tests 통과.
- Backend 부모 검증: `npm run test:e2e` 15 suites / 125 tests 통과.
  소셜 런타임 19건 포함. Testcontainers 일회용 PostgreSQL 사용.
- Backend `npm run lint`, `npm run format`, `npm run build` 통과.
- Backend Sol 최종 검토: 첫 100명이 부적격인 팔로우 조회의 후속 페이지를 실DB로 검증.
  기존 한도·DST·lease·rollback·종료된 context·중첩 트랜잭션 회귀가 유지됨.
- 부모 `npm run schema:check`(admin) 통과, 온보딩 Mermaid 13개 최종 렌더링 통과.
- Sol 문서 리뷰에서 순서·활성화 검증 위임·공유 context·의존 방향 4건을 수정 후 PASS.
- Admin 부모 검증: `npm run test -- --runInBand` 50 suites / 464 tests 통과.
  최초 샌드박스 실행은 컨트롤러 테스트의 listen EPERM으로 실패했고, 필요한 권한으로
  동일 명령을 실행해 전부 통과했다. 소스 결함으로 처리하거나 테스트를 제거하지 않았다.
- Admin 부모 검증: `npm run test:e2e` 9 suites / 33 tests 통과.
- Admin `npm run build`, `npm run lint`, 최종 `npm run format` 통과.
- 양쪽 `git diff --check` 통과. 새 의존 검사와 최종 문서의 상대 파일 링크를 확인했다.
- Admin Sol: 일반 로그 기록·조회 소유권 이관, DELETE 취소, nested rollback,
  종료 컨텍스트 접근, 새 수동 반응의 단일 감사 로그를 검증했다.
- 범위 밖 미준수는 규칙의 예외가 아니다. 기존 CharacterRepository의 페르소나·메모리,
  두 원자 수정 내부 로그, PostingPolicy/Generation/VisualProfile/Drafts Repository의
  기존 직접 로그 쓰기와 다른 기존 집합 Repository는 별도 정리 대상이다.
- Knowledge Delta: 사용자 확정 의존/명명 규칙은 양쪽 docs/02, 검증된 소유권·트랜잭션
  구조는 docs/06·07, 실제 호출 흐름은 온보딩 문서의 13개 UML/보조 다이어그램에 반영했다.
- 추가 DDL 작성·지속 DB 적용·배포·워커 활성화·커밋은 수행하지 않았다.
