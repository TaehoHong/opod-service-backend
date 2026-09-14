# D29 — 페르소나·캐릭터 메모리 구조의 실제 로컬 DB 검증

## 승인과 경계

- user-confirmed: 2026-09-08 “do 변경 후 테스트까지 진행해 ddl 승인할게”. 앞서 제시한 로컬 저장 구조 변경, DDL, 저장/수정/재조회/재시작/격리/롤백 테스트를 실행한다.
- 개발 DB, 기존 5433 로컬 DB, 원본 스냅샷 및 사용자 검수는 변경하지 않는다. 배포/커밋/푸시/유료 모델 호출은 범위 밖이다.
- 별도 로컬 컨테이너 `opod-persona-memory-local-20260908`, 127.0.0.1:55433, DB `opod_persona_memory_local`. 캐시된 pgvector 이미지를 사용한다.
- 자연스러움 및 캐릭터성의 PASS를 추정하지 않는다. 정정·망각은 계속 보류한다.

## 설계 / decision ledger

1. owner-found / repo-evidenced: backend schema.ts와 drizzle + scripts/db-migrations.mjs가 정본. AGENTS/guide 및 실제 스키마/마이그레이터로 확인했다. admin schema는 미러다.
2. owner-found / repo-evidenced: 관리자 HTTP CharactersController → CharactersService → CharacterRepository. 기존 CRUD 및 테스트를 확인했다. 별도 DB 서비스는 만들지 않는다.
3. owner-found / repo-evidenced: agent PostgresPersonaStore → routePersona/character-recall. source projection의 UTF-8 무손실 검증을 재사용한다.
4. agent-assumed / active: 원본 character_personas를 보존하고 child table character_persona_fragments에 persona_id, ordinal, content, kind, injection, recall_keys, timestamps를 저장한다. FK, 순서 unique 및 값 제약을 추가한다. 1조각도 허용하여 미분리 블록의 명시적 분류를 같은 구조로 저장한다.
5. agent-assumed / active: 관리 API의 구조 저장은 원문 SHA-256 낙관적 잠금 + 행 잠금 + 원문/조각 원자 저장이다. 조각을 연결하면 원문과 정확히 같아야 한다. 기존 본문 PATCH로 이미 구조화된 원문만 바꾸는 것은 409로 거부한다. 제목/순서 변경과 미구조화 legacy CRUD는 유지한다.
6. agent-assumed / active: character_memories에 nullable kind/injection 및 recall_keys를 추가한다. null은 기존 동작, 명시적 event는 retrieved만 허용한다. 캐릭터 canon과 사용자별 학습 메모리는 기존 별도 테이블 경계를 유지한다.
7. agent-assumed / active: 새 agent reader는 migration 적용 후 사용한다. 외부 routing manifest는 로컬 검증에서 사용하지 않는다. 남은 조각의 불일치는 오류로 차단한다. 자식 행이 전혀 없으면 legacy다. 직접 SQL로 모든 조각을 제거한 경우를 감지하는 별도 상태 표시는 없고, 정상 API는 빈 분할 거부/원자 교체로 그 상태를 만들지 않는다.
8. rollback: 추가 구조/정책만 제거하는 down SQL을 별도 검증 DB에서 트랜잭션으로 실행/ROLLBACK하고 원문 불변을 확인한다. 개발 DB 실행 금지. 코드 이전 버전 복귀는 원본 테이블을 계속 읽을 수 있다. 실제 down 시 구조 데이터는 사전 백업이 필요하다.

## 계획 및 검증

- [x] Red: agent 회귀2건의 기존 구조 무시/손상 비차단 실패 확인. 관리 API 원자성/오래된 수정/다른 캐릭터 차단 테스트도 추가. API 초기 실패는 fixture/타입 설정 오류로서 Red 증거에 세지 않음.
- [x] canonical additive DDL 생성, admin mirror, 관리 API 및 agent reader 구현.
- [x] 별도 로컬 DB 생성 → 정본 migration → frozen 4캐릭터/45원문/79canon + 70조각 저장. 실제 관리 API124회.
- [x] 실제 DB/API/프롬프트 통합12건, 재시작 후12건, 중복 migration, Testcontainers 트랜잭션 down/up 및 rollback 검증.
- [x] backend149+99E2E/admin445+16E2E, agent372(DB skip0)+eval93. 전체1174통과. build/lint/typecheck/schema drift 통과. 무관 기존 포맷 실패는 아래 보고서에 분리.
- [x] diff 검토, 재현 절차/실제 결과/제한 사항 문서화.

검증은 DB 저장의 정확성을 증명한다. 가짜 모델로 수집한 프롬프트는 대화 품질 판정이 아니다. 원문과 사용자 검수 파일의 SHA-256을 전후 비교한다.

## 결과 / Knowledge Delta

- verified; human review required before merge. 실제 모델/유료 호출/사용자 판정 추가0, 배포/commit/push0.
- 결과 정본: `../opod-agent/docs/reports/character-context-local-db-2026-09-08.md`.
- private 초기/재시작 증거: `../opod-agent/evals/results/persisted-context-local-2026-09-08/`.
- repo-evidenced: canonical child-table/nullable canon routing, admin 원자 저장, agent 기존 Router
  재사용 및 migration-first 호환성 경계를 양 저장소 guide와 기존 ADR0008에 반영했다.
- 무관 기존 포맷: backend3/admin8 파일 실패. 변경 파일 포맷은 통과, 해당 무관 파일은 보존.
- DB 계층과 관리자 API는 완료했다. 시각적 구조 편집기/전체 policy revision 잠금/실제 답변 비교는
  포함하지 않았다. 원문 해시는 본문 버전 충돌만 검사한다. 품질 승인 또는 전면 rollout으로 확대하지 않는다.
