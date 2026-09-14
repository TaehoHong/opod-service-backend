# 캐릭터 챗 통합 문맥 개선 — 로컬 구현 계약

2026-09-11. 상태: 사용자의 **“DDL 포함 진행”**으로 승인한 I1~I5 로컬 구현·합성 검증 완료.
실제 모델의 의미 검색·자연스러움 품질은 미검증이며 별도 후속 계약 대상이다.

## 1. 목표와 현재 결정

사용자는 문구 튜닝보다 페르소나·메모리·검색·주입 구조/내용의 통합 개선을 먼저 진행하고,
그 다음 세부 조정을 원한다. 논문 기반 초안 후 “ㅇㅋ 진행해”로 상세화 진행을 요청했다.
이번 문서는 실행 가능한 SQL이나 migration이 아니라 변경 범위와 검증을 설명하는 계약이다.

- user-confirmed / active: 캐릭터 공통 경로, 원래 성격 보존, 사용자 선택·코멘트만 인간 검수.
- user-confirmed / active: 기반 구조를 우선 개선. D36 문구 비교는 현재 진행 순서에서 보류.
- user-confirmed / deferred: 정정·망각. 개발 DB/제품 배포/commit/push는 이번 범위 밖.
- user-confirmed / active: 아래 I1~I5의 로컬 구현과 추가형 DDL(2026-09-11 “DDL 포함 진행”).
- deferred: 실제 embedding 모델 선정/호출과 LLM 답변 생성의 제공자·전송 자료·비용 계약.
  기존 D36의 32답변/$1 승인은 새 통합 실험이나 embedding에 재사용하지 않는다.

품질 개선 완료는 구조 테스트 통과가 아니라 후속 실제 답변 사용자 검수까지 포함한다.
이 계약으로 완료 가능한 범위는 **실제 로컬 PostgreSQL에 연결된 처리 경로와 합성 회귀 검증**이다.

## 2. 9월11일 확인한 현재 상태

읽기 전용으로 전용 로컬 DB를 점검했다. 개발 서버에 접속하지 않았다.

| 항목 | 관찰 |
| --- | --- |
| 대상 | 컨테이너 `opod-persona-memory-local-20260908`, `127.0.0.1:55433/opod_persona_memory_local` |
| DB | PostgreSQL 16.15, vector 확장 0.8.6 설치됨 |
| 내용 | 원문 페르소나45, 조각78, 캐릭터 기억79, 사용자 archival 기억0 |
| 캐릭터 벡터 | `character_memories.embedding`은 이미 vector(1024), 79건 모두 NULL |
| 사용자 벡터 | `agent_archival_memories.embedding`은 double precision[] |
| 현재 검색 | 캐릭터는 recallKeys 문자열 일치, 사용자 기억은 최근 접근512개에서 앱 내 유사도 순위 |

따라서 “벡터 DB가 없다”가 아니라 **기존 확장을 캐릭터 검색에 연결하지 않았고 해당 로컬
기억의 벡터도 채우지 않았다**가 정확하다. 이번 자료로 실제 사용자 기억 검색 품질은 측정할 수 없다.
이후 합성 기억과 실제 embedding 검증을 명확히 분리한다.

관련 코드: agent `src/persona/persona.ts`, `character-recall.ts`, `postgres-persona-store.ts`,
`src/chat/chat-service.ts`, `src/memory/{types,retrieval,postgres-memory-store,consolidation}.ts`.
schema 정본: backend `src/domain/database/schema.ts`, admin에는 미러만 둔다.
backend guide의 관련 schema/worker 항목은 변경 이력이 있어 현재 소스를 다시 확인했다.

## 3. 논문 근거와 채택 경계

다음은 선행 조사에서 확인한 논문이며, OPOD 성능의 재현 결과가 아니다.

| 근거 | 가져올 설계 | 그대로 가져오지 않는 것 |
| --- | --- | --- |
| [RoleLLM](https://arxiv.org/abs/2310.00746) | 캐릭터 지식과 표현 방식 분리 | 지금 모델 fine-tuning 수행 |
| [InCharacter, ACL2024](https://aclanthology.org/2024.acl-long.102/) | 말투뿐 아니라 상황별 태도 검수 | 심리척도/LLM judge 점수를 사용자 판정으로 대체 |
| [PersonaForge, ACL2026](https://aclanthology.org/2026.findings-acl.386/) | 성격·표현·현재 상태 분리 | 임의 심리점수, 매 턴 내적 독백/복수 생성 |
| [Generative Agents](https://arxiv.org/abs/2304.03442) | 경험과 성찰 구분 | 자율 일과/현재 활동 생성 |
| [MemGPT](https://arxiv.org/abs/2310.08560) | 고정 핵심과 외부 기억 분리 | 매 대화의 도구 사용/기억 편집 루프 |
| [LongMemEval](https://arxiv.org/html/2410.10813v2) | 색인·검색·읽기 분리, 원문 구간 보존 | 요약만 남기고 원문 제거 |
| [Mem0](https://arxiv.org/html/2504.19413v1) | 최근 문맥을 포함한 비동기 기억 추출 | 자동 UPDATE/DELETE를 이번 범위로 확장 |
| [Hindsight](https://arxiv.org/html/2512.12818v1) | 사실·경험·해석, 시간과 출처 구분 | 별도 graph DB와 자동 신념 강화 |
| [LoCoMo](https://aclanthology.org/2024.acl-long.747/) | 여러 세션·시간·화자에 걸친 평가 | QA 점수를 한국어 자연스러움으로 해석 |

검색 구현 참고: [pgvector 공식 문서](https://github.com/pgvector/pgvector).
정확 검색으로 기준을 잡고, ANN/HNSW는 규모·지연시간 근거가 생길 때 별도 판단한다.
한국어 의역·오타·생략의 회수율은 해당 논문 수치를 인용해 대신할 수 없다.

## 4. 하나의 응답 경로

1. 기존 ChatService가 받은 대화 원문에서 최근 문맥을 구성한다.
2. 현재 발화와 최근 user/assistant 구간을 함께 검색 입력으로 사용한다. 원문은 변경하지 않는다.
3. Persona Router는 기존 always/start_only/retrieved/never_prompt 정책을 계속 소유한다.
4. 허용된 캐릭터 자료와 user+character 기억에서 키워드/벡터 후보를 찾는다.
5. 모델·차원·원문 hash가 일치하는 벡터만 사용한다. 시간/관련성/중복을 확인해 선택한다.
6. 고정 페르소나 + 최근 대화 + 근거 기억을 전체 입력 예산 안에 조립한다.
7. 기존 Provider로 답변을 한 번 생성한다. 이 계약에서는 결정적 테스트 Provider만 사용한다.
8. 기존 queue/Consolidation에서 기억을 추출하고 출처와 함께 저장한다.

별도의 planner LLM이나 재작성 LLM은 초기 경로에 넣지 않는다. 현재 대화 상태는 최근 원문과
요약에서 파생하는 요청 단위 자료로 두고 새 감정/친밀도 상태 테이블을 만들지 않는다.
기존 XP 계산은 유지한다. 호칭/말투 합의 등은 실제 원문 근거가 있어야 한다.

## 5. 데이터 변경 계약 — 추가형 DDL만

대상은 위 전용 로컬 DB와 일회용 Testcontainers DB뿐이다. 기존5433/개발 DB는 제외한다.
새 테이블, 기존 컬럼 타입 변환, DROP/TRUNCATE, 기존 벡터 일괄 재계산은 이번 DDL에 없다.
아래 신규 컬럼은 기존 행 호환을 위해 nullable이며 기존 고유키/격리/멱등 제약을 유지한다.

| 기존 테이블 | 추가할 컬럼 | 용도 |
| --- | --- | --- |
| `character_persona_fragments` | `embedding` vector(1024), `embedding_model` text, `embedding_source_sha256` text, `embedded_at` timestamptz(6) | 배경 조각의 의미 검색과 색인 신선도 |
| `character_memories` | `embedding_source_sha256` text, `occurred_at` timestamptz(6) | 기존 vector/model 활용, 사건 시각은 모르면 NULL |
| `agent_archival_memories` | `embedding_model` text, `embedding_source_sha256` text, `source_session_id` text, `source_messages` jsonb, `memory_type` text, `occurred_at` timestamptz(6) | 벡터 호환성, 근거 대화, 사용자 사실/공동 경험/해석 구분 |

`memory_type`은 NULL 또는 user_fact/shared_episode/interpretation만 허용하는 CHECK를 추가한다.
기존 kind observation/reflection enum은 변경하지 않는다. 기존 자료에 출처/시각/모델을 추정해
채우지 않는다. source_messages는 임의 사용자 JSON을 그대로 저장하지 않고 서버가 검증한
role/content/절대 메시지 위치/원문 hash 구간으로 구성한다. 이 값은 대화 당시의 근거 snapshot이지
불변 message UUID나 임의의 실제 발생 시각을 발명한 값이 아니다.

기존 사용자 double precision[]는 보존하고 신버전 검색에서 유효한1024차원·모델·hash만
벡터 비교에 사용한다. 모델 불명/차원 불일치 자료는 lexical 후보로만 사용하며 이유를 기록한다.
canonical vector(1024)를 재사용하므로 첫 실제 embedding 비교 후보도1024출력을 지원해야 한다.
지원 모델을 고르기 전에는 외부 호출하지 않는다. 다른 차원 채택은 별도 DDL 계약 변경이다.

제약: source_messages가 있을 때 JSON 배열이어야 한다는 CHECK 및 memory_type CHECK.
벡터와 원문 hash의 일치, 화자/주체/출처의 의미적 타당성은 DB CHECK만으로 입증하지 않는다.
등록/수정시각을 occurred_at으로 옮기지 않는다. 날짜만 아는 자료는 이번 nullable 시각에 임의
자정을 넣지 않고 원문에 보존한다. 자동 정정/망각/파생자료 삭제 기능은 만들지 않는다.

DDL 소유 파일: backend `src/domain/database/schema.ts`, 새 `drizzle/*_character_chat_context/`
생성 migration/snapshot; admin `src/domain/database/schema.ts` 미러.
사용자 정의 SQL은 정본 migration 소유 범위에만 둔다. 별도 수동 SQL schema 사본은 만들지 않는다.

되돌림: 적용 전 전용 DB의 schema/data를 private 백업하고 복원 시험은 별도 일회용 DB에서 수행.
실행 모드를 기존 경로로 돌려 추가 컬럼을 남기는 방식이 기본 rollback이다. down 시험은 일회용
DB에서만 수행한다. 전용 DB의 새 컬럼 제거 또는 전체 복원은 이 계약의 실행에 포함하지 않는다.
I3 내용 후보를 되돌릴 때는 이번 작업이 바꾼 행만 기존 관리 API와 현재 원문 hash 확인을 거쳐
보관한 이전 내용으로 복원한다. 동시에 다른 변경이 있으면 덮어쓰지 않고 중단한다.

## 6. 입력과 내용의 규칙

- 저장 원문/조각 결합 계약을 유지한다. 내용을 다듬을 때 기존 구조 API의 원문 hash/CAS로 함께
  저장하고 변경 전후·출처 대응표를 남긴다. 원래 성격을 강화한다며 새 가치관을 만들지 않는다.
- 네 캐릭터 내용 변경은 후보로 표시하고 공통 코드에 이름/ID별 조건을 추가하지 않는다.
- 직업/게시물 제작 지침을 잡담 지침으로 사용하지 않는다. 예문은 실제 과거 대화가 아니다.
- 검색 키는 정규화된 키워드와 문맥 표현을 사용한다. 단순 한국어 전문검색을 형태소/의미 분석이
  된 것처럼 설명하지 않는다. lexical/semantic 결합 순위와 빈 결과 허용을 독립 검증한다.
- 최신 발화/직전 대화가 우선이다. 초과 시 낮은 관련도의 추가 기억부터 제외하며 메시지 중간을
  절단하지 않는다. 요약되지 않은 오래된 문맥을 조용히 지우지 않고 overflow를 명시적으로 보고한다.
- 입력량은 전체 메시지와 고정 지침까지 합산한다. tokenizer 미확정 시 보수적 byte 예산과 실제
  token 측정을 구분한다. 한국어 글자 수를 token 수라고 부르지 않는다.
- source_messages를 답변에 넣을 때에도 별도의 근거 영역으로 표시한다. 저장된 지시문이 system
  권한을 얻지 않도록 하고 tenant 격리는 검색 전 SQL 조건으로 적용한다.
- 동일 작업 재시도는 기존 operation_key/ordinal, 요약CAS/coverage 계약을 유지한다.
  source_messages는 최소 근거 구간만 저장한다. 사용자 사실은 assistant 발언만으로 추출하지 않는다.
- 비동기 추출 실패는 이미 생성된 답변을 취소하지 않는다. 검색 오류는 선택 기억 없는 기존
  안전한 응답 경로로 축소하고 실패 이유를 남긴다. 실패를 검색 성공0건으로 합치지 않는다.

## 7. 기존 소유자 확인과 작업 순서

기존 구현 심볼/호출부와 관련 테스트를 대조했다. 아래는 모두 owner-found이며 같은 책임을
가지는 병렬 framework/store를 만들지 않는다. 새 helper는 기존 모듈 아래 실제 사용처에만 추가한다.

### I1 — 기존 자료를 보존하면서 로컬 schema와 reader를 연결

- [x] 위 DDL을 backend 정본에서 생성하고 admin 미러 동기화.
- [x] agent `src/persona/{persona,postgres-persona-store}.ts`에서 기존 fragment와 벡터 메타데이터의
  안정적인 저장 행 대응을 유지. 외부 projection ID를 DB primary key라고 가정하지 않는다.
- [x] admin `src/characters/character.repository.ts` 원문 변경 시 색인 신선도 무효화/CAS 검증.
- [x] backend `test/character-context-migration.e2e-spec.ts`, admin
  `test/character-context.e2e-spec.ts`, agent `src/persona/postgres-persona-store.test.ts` 확장.
- 검증: backend/admin `npm run test:e2e -- --runTestsByPath test/character-context-migration.e2e-spec.ts`
  (admin에서는 `test/character-context.e2e-spec.ts`), admin `npm run schema:check`.
- 기대: 기존45/78/79원문 보존, migration 반복 안전, 빈 DB/legacy 적용, 테스트DB rollback 성공.

### I2 — 관련 자료를 DB에서 찾아 실제 입력으로 전달

- [x] agent `src/persona/character-recall.ts`, `persona-router.ts`, `postgres-persona-store.ts`,
  `src/memory/{memory-store,postgres-memory-store,stub-memory-store,retrieval,types}.ts`,
  `src/chat/chat-service.ts`, `src/bootstrap/{container,env}.ts`와 관련 tests 확장.
- [x] 최근512개 제한에 앞서 전체 허용 범위에서 semantic/lexical 후보를 각각 찾고 결합.
  조회는 bounded top-K, model/hash/dimension gate, 중복 제거, 빈 결과 허용을 갖는다.
- [x] 색인 생성은 기존 `src/provider/openai-compat-provider.ts` 인터페이스를 재사용하는
  `evals/context-index-cli.ts`에서 명시적 로컬 실행으로 시작. 원문 변경 후 낡은 벡터는 제외.
  이번 실행은 합성 벡터를 일회용 DB에만 저장하고 실제 캐릭터 벡터를 채우지 않는다.
- [x] 벡터 저장 직전에 원문 hash를 재검사해 생성 중 바뀐 자료에는 낡은 벡터를 쓰지 않는다.
  의미 검색 실패/색인 없음은 lexical 경로로 축소하고 실제 semantic 사용 여부를 trace에 남긴다.
- 검증: `npm run test -- src/persona/character-recall.test.ts src/persona/postgres-persona-store.test.ts
  src/memory/retrieval.test.ts src/memory/postgres-memory-store.test.ts src/chat/chat-service.test.ts`.
- 기대: 512개보다 오래된 관련 합성 기억 회수, 타 관계0건, 낡은/잘못된 차원 벡터 거부,
  같은 뜻의 실제 한국어 회수율은 아직 미검증으로 표시.

### I3 — 원문 문맥·페르소나·기억을 충돌 없이 조립

- [x] agent `src/chat/{chat-service,system-prompt,turn-context,persona-reference}.ts`,
  `src/openai/messages.ts`, 새 `src/chat/context-budget.ts`와 관련 tests.
- [x] 동일 문장 반복, 무관 게시물/사건, 과거 사건의 현재화, 미해결 후속 발화, 문맥 초과를 검증.
- [x] 내용 후보는 원본을 private 보관하고 기존 관리 API를 통해 전용 로컬 DB에서만 적용.
  baseline은 같은 원본 snapshot으로 별도 재현하며 이전 검수 파일은 변경하지 않는다.
- 검증: `npm run test -- src/chat/chat-service.test.ts src/chat/system-prompt.test.ts
  src/chat/turn-context.test.ts src/chat/context-budget.test.ts src/openai/messages.test.ts
  src/persona/persona-context.test.ts`.
- 기대: 전체 입력 예산 준수, 최신 발화 보존, 문맥 누락/overflow 가시화, 캐릭터별 코드 분기0.

### I4 — 새 기억에 근거를 붙이고 재시도·요약을 연결

- [x] agent `src/memory/{consolidation,parsing,reflection,memory-store,types,postgres-memory-store,
  stub-memory-store}.ts`, `src/protocol/index.ts`, `src/chat/consolidation-policy.ts`와 관련 tests.
- [x] 추출 자료의 source index를 실제 해당 job 원문과 대조하고 fact/episode/interpretation 구분.
  legacy job/기존 기억은 unknown metadata로 보존, 자동 현재 사실 승격 금지.
- 검증: `npm run test -- src/memory/consolidation.test.ts src/memory/consolidation-worker.test.ts
  src/memory/parsing.test.ts src/memory/reflection.test.ts src/memory/postgres-memory-store.test.ts
  src/chat/consolidation-policy.test.ts src/protocol/protocol.test.ts`.
- 기대: 출처 없는 사용자 사실 거부, 실패 시 기존 기억/요약 유지, 재시도 중복0,
  의미적 사실성은 별도 실제 추출 검수 대상으로 남김.

### I5 — 통합 비교 준비와 합성 전체 경로 검증

- [x] 기존 `evals/{target,persona-comparison,review}.ts`의 조립/리뷰 소유자를 재사용하고
  `evals/cases/character-context-integration.json`에 공개 가능한 합성 회귀를 추가.
- [x] 기준안/통합안 두 경로를 실제 PostgreSQL → 검색 → 조립 → 결정적Provider → 저장/재조회로 검증.
- [x] backend/admin `docs/07-codebase-guide.md`, agent `docs/persona-memory-plan.md`, 기존 인계 갱신.
- 검증: agent `npm run typecheck`, `npm run typecheck:eval`, 관련 제품/평가 tests;
  backend/admin `npm run build`, `npm run lint`, `npm run schema:check`(admin), 관련 E2E.
- 기대: 합성 기준 기억 회수/제외·격리·보존의 모든 명시 사례 통과. 모델품질 점수는 만들지 않음.
  private 결과는 새0700폴더/0600파일에 배타 저장. baseline/기존 사용자 검수 hash 보존.

## 8. 실제 품질 비교 — 후속 별도 승인

위 구현 검증 이후 제공자 공식 사양/한국어 embedding 후보/비용을 확인해 별도 실행 계약을 제시한다.
본 계약은 실제 사용자 대화 전송, embedding 유료 호출, 생성/추출/요약/성찰 유료 호출을 허용하지 않는다.

비교는 같은 모델·sampling·시간·관계 조건에서 기존안 대 통합안으로 수행한다.
새 문맥/여러 세션/기억 불필요 문맥을 포함하고, 고정 문맥 단일 답변과 자유 진행 다중 턴을 분리한다.
평가용 미래 대화/질문은 저장·검색 데이터에 미리 넣지 않는다. 모델 추출/요약/색인 비용도 총비용에 포함.

기억 품질(회수율/불필요 주입/화자·시간 오류), 캐릭터성, 자연스러움, latency/usage를 별도 보고한다.
사용자 not-reviewed/abstain/both_bad/draft를 그대로 보존하며 pair 선호를 개별PASS로 바꾸지 않는다.
기존 D35결과와 새로운 결과를 합산하지 않는다. 반복 표본/새 상황 확인 전 일반적 개선으로 주장하지 않는다.

## 9. 승인 전 사전 점검 기록

- 실제 DB read-only 트랜잭션2회로 schema/건수/vector 상태 확인. 쓰기·외부LLM·embedding0.
- Docker 접근은 제한으로 첫 목록 조회가 실패해 읽기 전용 권한으로 재확인했으며 성공.
- 제품/테스트/schema/migration 편집0. 이번에는 계획과 인계 문서만 변경한다.
- 현재 관찰을 문서화한 것이며 자연스러움/성격/검색 품질 개선 결과는 아직 없다.

승인 대상: **I1~I5 로컬 구현·추가형 DDL·전용 로컬 내용 후보 적용·합성 DB 테스트**.
포함하지 않는 것: 개발DB/기존5433 접근·변경, 제품배포, 외부 모델 호출, 웹 게시, commit/push,
실제 사용자 데이터 유입, 정정/망각, 현재 생활 생성, 별도 graph DB, 모델 fine-tuning.
위 구현 승인은 수신했다. 실제 유료 검증은 명시적으로 후속이며 이번에 실행하지 않는다.

## 10. 승인 후 실행 결과 — 2026-09-11

- I1: canonical migration `20260911063302_character_chat_context` 생성/검토, admin mirror 일치.
  private schema+data 백업을 일회용 DB에 복원한 후 migration2회 반복을 확인했고 전용55433에 적용.
  DDL 직후45/78/79/0 및 원문 hash 동일. 보존 DB에서 down/drop/restore는 하지 않았다.
- I2: 실제 Postgres의 범위 선제한→어휘/유효 벡터 후보→RRF/중복 제외→source hash 재확인을 연결.
  최근512보다 오래된 합성 기억, 다른 관계, 낡은/잘못된 모델·차원·비정상 숫자, 실패 fallback 검증.
  색인 CLI는 기본 dry-run/CAS이며 이번에 실제 embedding을 실행하지 않았다.
- I3: 고정 요청 필드/도구 정의까지 바이트 예산에 포함. 원문 대화는 통째로 보존하고 선택 자료만
  줄이며 필수 입력 초과는 오류다. 원문으로 전부 덮인 요약만 생략하고 대화 방식 합의는 유지한다.
  처음 검토한 content-only 중복 처리와 접두어 후속 인식 오류를 수정하고 회귀를 추가했다.
  캐릭터 사실/사용자 사실, 관찰/해석은 별도 영역으로 유지한다.
- I3 내용: 기존 제작 지침은 이미 미주입이었다. 이를 새 개선으로 세지 않았다. 나희/서린/권도건/
  한소이의 과하게 묶인 배경4개만 원문 보존 분리. **45원문·79canon 모두 byte 동일,78→86조각**.
  성격·말투·안전 경계는 변경하지 않았다. 고정 질문4개에서 character prompt hash 동일,
  전체 입력10880→10652 /8971→8607 /10953→10627 /9437→9131bytes. 품질 점수가 아니다.
- I4: sourceIndices→실제 role/content/절대 위치/hash, fact/episode/interpretation 저장·재조회.
  추출 실패/재시도/요약CAS 검증. 모델 식별이 없는 integrated 경로는 embedding 호출 없이
  어휘 기억을 보존한다. 출처 없는 평문 Core 자동 재작성은 새 모드에서 하지 않는다.
- I5: 기존 평가 target에 모드/예산/검색 trace를 보존하고 실제 PostgreSQL→ChatService→고정 응답
  →출처 저장→새 연결/세션 재조회 테스트를 추가했다. 합성 suite12턴 전체를 모델 평가한 것은 아니다.
- 최종 검증: agent 실제 DB 포함 **431/431**, 평가 **96/96**, backend migration E2E **4/4**,
  admin 구조 E2E **7/7**. agent 제품/평가 typecheck·lint·build, backend/admin build·lint,
  admin schema:check 및3repo diff check 통과. 전체 backend/admin 비관련 E2E·UI 테스트는 미실행.
  초기 loopback 제한은 허용된 테스트 권한으로 재실행했다. 신규 migration 때문에 기존 이력 기대값
  3개가 실패한 것을4개로 갱신 후 통과했다.
- 최종 전용DB:45원문/86조각/79canon/archival0, fragment/canon 벡터0. 실제 외부 모델 호출0,
  사용자 판정 추가0. 기존 검수/비교/첨부489파일 hash 불변. 옛518개 manifest 중 승인된 runtime
  소스7개 변경은 이번 구현이므로 동결 평가자료 변경과 구별했다.
- 전문 보조 작업은 예산 helper, 관리 API 무효화, 근거 추출, 혼합검색, DB reader/색인,
  통합 테스트로 경계를 나눴다. 최종 담당자가 코드 검토와 통합 재검증을 수행했다.
- 증거 위치(비공개): agent `evals/results/context-local-2026-09-11-rgY7E1/`.
  `before.dump`, `ddl-verification.json`, `granularity-{candidate,rollback,applied}.json`,
  `final-captures.json`, `final-db-verification.json`, `*-tests-reviewed.log`,
  `frozen-artifacts-verification.json`. 과거 파일은 덮어쓰지 않았다.
- Knowledge Delta: backend/admin `docs/07-codebase-guide.md`, agent `docs/persona-memory-plan.md`
  및 기존 인계에 위 구현 계약을 repo-evidenced로 반영. 원문 내용은 후보 분할이지 사용자 승인
  품질 정답이 아니다. 기본모드 legacy를 유지했으며 개발 배포/외부 실행/commit/push는 하지 않았다.

검증됨. **병합 전 사람 코드 리뷰 필요**: tenant 검색/벡터 gates, source 검증과 추론 구분,
바이트 초과 처리. 실제 모델 선택·1024차원/한국어 품질·가격 총액 제한 확정 후 별도 실제 비교가 다음이다.
