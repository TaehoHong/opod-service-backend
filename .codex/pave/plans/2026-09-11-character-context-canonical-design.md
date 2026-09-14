# 캐릭터 공통 페르소나·메모리 정본 설계

2026-09-11. **설계·DDL 승인 수신 / 격리 로컬 구조·API·읽기 경로 검증 완료 / 내용 검수·실제 모델 미실행**.

사용자가 이 설계에 대해 “DDL 포함 승인”을 명시했다. C2~C4 및 S1~S4의 격리 로컬 구현·검증을
승인 범위로 진행한다. S5 실제 모델·외부 전송·비용과 사용자 품질 판정은 별도 승인 경계를 유지한다.
아래 설계 당시 미승인 문구는 승인 이력으로 이 상단 기록이 대체한다. 적용 대상과 실제 완료 범위는
마지막 실행 기록을 따른다. 원본55433 또는 개발 DB 적용 완료를 뜻하지 않는다.

사용자 요청: “우선 구조부터 확실히”, 개선된 로컬 DDL·한소이 내용 확인 후 “다음 진행해”.
이번 산출물은 목표 데이터 계약과 검증 계획이다. 실행 가능한 DDL·migration·제품 코드·DB 자료는 변경하지 않는다.
이미 완료한 I1~I5 계약을 소급 수정하지 않는다. 이 문서의 후속 변경은 새 설계·DDL 승인이 필요하다.
캐릭터별 작업 프롬프트 강화는 구조 결정 뒤로 보류한다.

## 1. 결론

**성격·말투는 서술형으로 유지하고, 동일 사실의 주입 정본을 하나로 만든다.**
지식 그래프나 새로운 Agent 서비스를 만들지 않는다. 기존 PostgreSQL, 관리 API, ChatService,
Persona Router, 비동기 기억 저장 경로를 확장한다. 캐릭터 차이는 데이터로 표현한다.

| 층 | 답하는 질문 | 정본 / 소유 범위 | 주입 원칙 |
| --- | --- | --- | --- |
| 인물의 성격·말투·경계 | 어떤 태도와 표현을 선택하는가 | character_personas + fragments / 캐릭터 공통 | 압축된 identity·behavior·voice는 상시 |
| 공식 사실 | 누구이며 무엇을 알고 있는가 | character_memories.kind=fact / 캐릭터 공통 | 최소 정체성만 상시, 나머지는 관련 있을 때 |
| 공식 사건 | 과거에 무엇을 겪었는가 | character_memories.kind=event / 캐릭터 공통 | 관련 있을 때만, 과거 사건으로 표시 |
| 사용자와의 기억 | 이 사용자와 실제로 무엇을 말했는가 | agent_archival_memories / user+character | 출처와 종류를 유지해 관련 있을 때 |
| 관계 진행 상태 | 얼마나 익숙하게 대화할 수 있는가 | 기존 agent_relationship_state / user+character | 친밀 표현의 허용 범위, 사실·감정의 증거 아님 |
| 현재 대화 상태 | 지금 무슨 말을 이어가는가 | 이전 대화 원문 + 필요한 세션 요약 / 요청 단위 | 현재 발화와 직전 맥락 우선 |
| 제작 원문·예문 | 운영자가 어떻게 작성했는가 | 원본 문서·never_prompt 조각·출처 기록 | 채팅 입력 제외, 감사·복구용 |

현재 관계 수치가 없어서 새 상태 테이블이 필요한 것은 아니다. 기존 bond XP/level과 최근 대화
시각이 있다. 현재 감정·현재 일과는 별도 사실처럼 자동 생성·영구 저장하지 않는다.
성격이 자연스럽게 표현되는지는 이 계약만으로 입증되지 않으며 실제 답변 검수가 필요하다.

## 2. 확인한 현재 상태와 정정

- 직전 턴 로컬 DB 읽기 전용 조회: 한소이 원문12, 조각28(always8/retrieved14/never_prompt6),
  공식 사건13, archival/core/summary 각0. 한소이 조각·사건의 실제 embedding0.
- 현재 원문 전체와 조각을 순서대로 합친 문자열이 정확히 같아야 한다. 저장 시 관리 API가
  트랜잭션으로 보장하고 PostgresPersonaStore가 재확인한다. 이 원문 보존 계약은 유지한다.
- 사실의 중복 사례: relationships의 담이 설명과 입양 사건, world의 카메라 구매와 구매 사건.
  문자열이 다르면 현재 내용 기반 중복 제거만으로 동일 사실임을 알 수 없다.
- character_memories.reason에는 “현재 시점 근황” 같은 오래된 운영 설명이 남아 있다.
  **현재 채팅 렌더러는 reason을 넣지 않고 content만 넣는다.** 이것을 현재 답변 오류의 입증된
  직접 원인으로 쓰지 않는다. 정본 출처·편집 자료로서의 혼동은 정리 대상이다.
- agent_relationship_state에 bond_xp/bond_level/last_decay_at 등이 이미 있다.
  agent는 last_decay_at을 lastExchangeAt으로 해석한다. 현재 schema의 warmth 컬럼 존재를
  새 감정 모델이 동작한다는 증거로 쓰지 않는다.
- pgvector 검색은 현재 정확 검색이다. HNSW가 없다는 것만으로 기능 결함이라고 하지 않는다.
  모델·차원·원문 해시 검증을 통과한 실제 벡터가 먼저 필요하다.
- 사용자 벡터가 double precision[]인 것은 차이지만, 기존 reader가 유효한1024차원만
  vector(1024)로 비교한다. **이번에는 타입 통일을 위한 DDL을 추가하지 않는다.**
- 이번 턴에는 DB를 다시 변경·조회하지 않았다. 직전 조회와 현재 소스 읽기를 구분한다.

## 3. 왜 이 방법인가

단순히 중복 문구를 삭제하면 감사·복구 근거가 사라지고, 그대로 두면 두 곳이 각각 수정될 수 있다.
따라서 **이관한 원문 조각은 보존하되 never_prompt로 전환하고, 공식 사실·사건을 참조하도록 연결**한다.
실제 주입은 기존 canon reader/router를 통해 한 번만 한다. 원문 조각을 실행 시 임의 치환하지 않는다.

이 연결은 일반 지식 그래프가 아니다. “어느 원문을 어느 공식 기록으로 옮겼는가”만 표현한다.
한 조각이 여러 사실·사건을 포함할 수 있으므로 한 개의 reference 컬럼보다 작은 연결 테이블을 제안한다.
동일 표현이 들어간 모든 활성 주입 경로를 감사한다. title이 다르다는 이유로 중복을 놓치지 않는다.
characters.display_name/bio는 공개 프로필 정본으로 유지하며, 이번 내용 이관에서 프로필을 바꾸지 않는다.
공개 프로필과 충돌하는 후보는 자동 선택하지 않고 충돌로 보고한다.

이번 정본 전환의 실행 소비자는 채팅 경로다. 같은 원문·기억을 읽는 게시물 제작 등 다른 소비자는
자동 개편하지 않는다. 실제 적용 전에 해당 공유 데이터 소비 목록과 영향도도 확인하고, 기존
원문 보존이 다른 소비자의 정본 일치까지 보장한다고 주장하지 않는다. 다른 소비자 변경이 필요하면
별도 범위로 명시하며, 그 검증 없이 전체 제품의 정본 전환 완료로 보고하지 않는다.

## 4. 테이블·필드 변경 명세 — DDL 작성 전 제안

다음은 설계 명세이지 실행 SQL이 아니다. 새 migration 파일은 별도 DDL 승인 후 생성한다.

### 4.1 유지할 구조

- character_personas: 원문과 제목·순서·삭제 상태 유지.
- character_persona_fragments: content/kind/injection/recall_keys/embedding 메타 유지.
- character_memories: fact/event 구분과 event=retrieved 제약 유지. 기존 type 필드는 호환용으로
  남기고, 분류 의미는 kind 하나가 소유한다. 새 관리 쓰기는 type과 kind를 함께 맞춘다.
- agent_archival_memories: observation/reflection과 user_fact/shared_episode/interpretation 두 축 유지.
- agent_core_memories: 기존 텍스트 보존, integrated에서 출처 없는 자동 덮어쓰기 계속 금지.
- agent_summaries: 세션별 content/turns_covered/revision 유지. 요약은 원문을 대신하는 사실 정본 아님.
- agent_relationship_state: 기존 계산·키·필드 유지. 신뢰·애정·질투 같은 새 숫자 필드 없음.

### 4.2 새 연결 테이블 1개

제안 이름: character_persona_canon_links.

| 필드 | 타입 / 제약 | 역할 |
| --- | --- | --- |
| fragment_id | uuid, NOT NULL, persona fragment FK | 보존된 원문 조각 |
| memory_id | uuid, NOT NULL, character memory FK | 실제로 주입할 공식 기록 |
| 두 컬럼 조합 | 복합 PK | 동일 연결 중복 방지 |

- fragment 삭제 시 연결도 제거한다. 구조 API가 조각을 교체할 때 새 연결까지 한 트랜잭션에서 복원한다.
- 공식 기억 물리 삭제는 참조가 있으면 제한한다. 일반 소프트 삭제는 API에서 활성 참조를 검사해
  충돌로 거부한다. 연결 해제·재지정과 함께 처리하는 승인된 관리 작업만 허용한다.
- 같은 캐릭터의 활성 원문·기억끼리만 연결한다. 두 FK만으로 같은 캐릭터가 보장되는 것은 아니다.
  관리 쓰기에서 소유권·삭제 상태를 잠금 하에 확인하고 reader도 방어적으로 검사한다.
- 연결된 조각은 never_prompt여야 한다. 어휘·벡터 검색과 상시 입력 모두에서 제외한다.
- 연결 대상의 injection이 공식 기록 주입 정책의 유일한 정본이다. 연결 자체는 강제 회수 신호가 아니다.
- 이관 범위가 불완전한 조각은 먼저 정확히 분할한다. 문장을 버리거나 내용을 몰래 요약하지 않는다.
- 사용 중 끊어진 연결·타 캐릭터 연결을 발견하면 원문을 fallback 주입하지 않고 문맥 무결성 오류로
  답변 생성 전에 차단한다. 프록시 모드로 조용히 전환하지 않는다.

### 4.3 character_memories 추가 컬럼 3개

| 필드 | 타입 / nullable | 의미 |
| --- | --- | --- |
| source_refs | jsonb / nullable | 작성 근거의 참조와 원문 snapshot 배열 |
| occurred_label | text / nullable | 알고 있는 사건 시점의 표현 |
| occurred_precision | text / nullable | year / month / day / instant / approximate 중 하나 |

source_refs의 허용 item은 kind(persona_source/post/manual), sourceId, quote, sha256이다.
sha256은 quote의 UTF-8 해시다. persona_source는 추가로 원문 전체 sourceSha256과 바이트 범위를
가져 어느 버전의 어느 부분인지 재현한다. post 참조는 게시물 근거이지 사건 시점의 자동 증명이 아니다.
manual은 sourceId가 없을 수 있지만 명시적 승인·작성 기록을 연결해야 한다.
생성된 초안이나 자동 추론을 승인된 공식 사실의 근거로 취급하지 않는다.

DB는 배열/허용값/필드 조합의 기본 제약을 맡고, 관리 API는 실제 source 존재·캐릭터 소유권·
원문 인용 일치·해시·날짜 의미를 검증한다. source snapshot의 hash는 승인·진실의 증명은 아니다.
기존 행의 NULL을 “출처 없음”으로 유지한다. reason을 자동으로 신뢰 가능한 출처로 승격하지 않는다.

시점 규칙:

- year/month/day: label을 각각 YYYY / YYYY-MM / YYYY-MM-DD로 정규화하고 달력 유효성을 검사한다.
  occurred_at은 NULL. 날짜만 아는데 임의 자정·타임존을 발명하지 않는다.
- instant: 명시된 timezone/offset이 있는 시각을 occurred_at에 저장한다. label은 원문 표현을 보존한다.
- approximate: “2025년 겨울”, “입학 무렵” 등의 원문 표현만 보존하며 occurred_at은 NULL.
- 모르면 새 두 필드도 NULL. 이미 있는 occurred_at 값은 검증 없이 지우거나 재해석하지 않는다.
- 생성일·게시일·최근 접근일을 사건일로 복사하지 않는다. precision이 불충분한 두 사건의 선후를
  임의로 확정하지 않으며 현재 활동으로 사용하지 않는다.
- 이 범위는 과거 사건 표현이다. 미래 약속·취소·현재 일과·시간별 감정 모델은 포함하지 않는다.

### 4.4 동시 편집과 호환성

현재 sourceSha256은 원문만 확인하므로 같은 원문의 분류 변경은 last-write-wins다.
새 연결을 안전하게 편집하려면 구조 API의 응답에 structureSha256을 추가해 원문·조각 순서·
kind/injection/keys·연결 집합을 함께 검증한다. 공식 기억 관리에는 content와 정책·시간·출처를
포함하는 memorySha256을 추가한다. 해시는 서버에서 정규화된 표현으로 계산한다.
쓰기 시 관련 행을 고정 순서로 잠그고 기대 해시가 다르면409, 부분 저장은 하지 않는다.

기존 API를 병행 유지하되 연결이 생긴 자료의 구조·정본 내용/정책 변경에는 새 토큰을 요구한다.
구버전 요청은 연결을 조용히 지우지 않고409로 새 조회를 요구한다. 신규 필드를 모르는 소비자에는
기존 필드 형태를 유지한다. 새로운 시각적 편집기 작업은 이번 구현 계약에서 제외하고 관리 API·
검수용 JSON 패키지로 먼저 검증한다. 기존 편집기의409 응답 처리가 데이터 손실 없이 동작하는지도 본다.

## 5. 한소이로 보는 이관 예시

아래는 **미적용 설계 예시**다. 실제 신규 row ID나 사용자 승인 설정이 아니다.
기존 공식 사건 ID는 유지하고, 새로운 사실은 원문에서 직접 확인되는 내용만 정리한다.

| 현재 원문 / 사건 | 목표 정본 | 원문 조각 처리 |
| --- | --- | --- |
| personality의 낯가림·완벽주의와 허술함 | behavior/always 그대로 | 내용 유지 |
| values의 신뢰·자기 기준·좋아하는 일을 오래 하고 싶은 마음 | behavior/always 그대로 | 내용 유지 |
| social_style의 불편하면 거리 두기·원칙에는 단호함 | behavior/always 그대로 | 내용 유지 |
| voice의 수더분한 존댓말 | voice/always 그대로 | 제작용 캡션·해시태그는 계속 제외 |
| relationships의 담이 묘사 | fact: “소이는 반려묘 담이와 산다. 담이는 회색 코숏이다.” | 원문 보존 + never_prompt + 사실/기존 입양 사건 연결 |
| 2023년7월 담이를 발견·입양한 기존 사건 | 기존 event ID 유지, month=2023-07 | 이름 유래·시점 상세는 사건 한 곳에서 주입 |
| world의 카메라 구매 설명과 기존 구매 사건 | 기존 구매 event ID에 인용 근거 연결 | 중복되는 구매 설명은 never_prompt, 다른 성장 내용은 별도 유지 |
| “내 돈 주고 산36장”의 의미처럼 기존 사건에 없는 내용 | 기존 원문에 근거한 사건 상세 보강 후보 | 검토·승인 후 정본에 합치기 전까지 내용 유실 금지 |
| 지우와 가끔 동반 출사 | fact/retrieved | 내용은 유지하고 공식 사실 정본으로 이관 연결 |
| 연애 상태 비공개·사적 질문 경계 | behavior/always 유지 | 사실 기록으로 옮기지 않음 |
| 사용자와의 경험 | 현재0 유지 | 가짜 사용자 기억 추가 금지 |

담이 입양 event는 기존 “2023년7월 장마철…” 본문을 보존한다. 현재 반려동물 관계와 과거 입양
사건은 서로 다른 명제이므로 두 기록 자체가 잘못은 아니다. 같은 날짜·이름 유래 상세를 여러
활성 문서에서 독립 편집하는 것을 없애려는 설계다.
출처가 같은 기록 두 개를 서로 독립 증거처럼 신뢰도에 중복 가산하지 않는다.

한소이 identity/world/preferences에 반복된 동일 명제와 공개 bio도 함께 감사해야 한다.
위 표 몇 줄만 옮긴 뒤 “한소이 중복 정리 완료”라고 하지 않는다. 모든 활성 입력의 의미 중복은
명시적 대응표로 검수하며 임베딩 유사도만으로 자동 병합하지 않는다.

## 6. 주입과 기억 쓰기 계약

### 답변 읽기 경로

1. 캐릭터 정체성·성격·말투·경계와 허용된 최소 공식 사실을 상시 입력에 둔다.
2. 이전 대화 원문을 유지한다. 짧은 후속 질문은 기존 contextRecallQuery로 검색 문맥을 만든다.
3. 공식 사실·사건은 character 범위, 학습 기억은 user+character 범위에서 각각 검색한다.
4. 이관된 원문 조각은 never_prompt이므로 후보에서 빠진다. canon ID 중복은 한 번만 주입한다.
5. 사건은 시점 정밀도와 함께 과거 자료로, 사용자 기억은 발화 근거·유형과 함께 전달한다.
   source_refs의 관리 사유/지시문/전체 문서를 모델에 넣지 않는다. 원문은 검수·감사용이다.
6. 기존32,000 UTF-8 바이트 예산·현재 메시지 위치·원문 보호를 유지한다. 과거 사건이나 친밀도가
   “지금 무엇을 하는지”의 근거가 되지 않는다. 공통 안전 경계를 캐릭터 데이터로 덮어쓰지 않는다.

### 사용자 기억 쓰기 경로

- 실제 raw turns → 기존 queue → 출처 검증 추출 → archival → 새 세션에서 회수.
- user_fact는 명시적 사용자 진술에 근거한 기억이지 외부 검증된 객관적 사실이라는 뜻은 아니다.
- shared_episode는 실제로 주고받은 말·약속의 맥락이다. AI가 임의로 한 말을 실제 발생 사건으로
  승격하지 않는다. interpretation은 계속 해석으로 표시한다.
- 기존 operation_key/ordinal, 증거 위치/해시 검증, summary CAS를 유지한다.
- 테스트에서 새 세션에는 이전 사용자 원문을 일부러 주지 않고 저장된 근거 기억의 회수를 확인한다.
  테스트 사용자·캐릭터는 격리하고 합성 자료를 실제 사용자 기록으로 옮기지 않는다.
- 자동 정정·망각·가짜 관계 형성·공식 성격 자동 변경은 만들지 않는다.

### 벡터 경계

기존 exact lexical+vector 검색 소유자를 유지한다. 테이블 저장 타입이 달라도 reader의
동일 모델/1024차원/유한값/0이 아닌 벡터/원문 hash 계약을 공유한다. 원문 변경 시 기존 무효화 유지.
출처·시점만 바뀌어도 최종 문맥 snapshot 해시는 바뀌어야 하지만, content-only embedding을
불필요하게 재생성하지 않는다. 실제 임베딩 모델 선택·호출은 별도 승인 후이며 synthetic 벡터
테스트를 의미 검색 품질로 보고하지 않는다. ANN은 측정 후 별도 범위로 둔다.

## 7. Existing Owner Check와 구현 경계

두 신호는 실제 심벌/호출 경로와 기존 테스트·가이드 대조다. 이번에는 로직을 작성하지 않았다.

| 책임 | 결과 | 기존 소유자 / 검증 경로 |
| --- | --- | --- |
| 스키마·migration | owner-found | backend src/domain/database/schema.ts; test/character-context-migration.e2e-spec.ts |
| 원문·조각·기억 관리 | owner-found | admin CharacterRepository.replacePersonaStructure/updateMemory/updateMemoryRouting; CharactersService/Controller; test/character-context.e2e-spec.ts |
| 새 정본 연결의 소유권 검증 | owner-absent(현재 링크 기능 없음) | 새 독립 서비스 대신 기존 CharacterRepository 트랜잭션에 추가 |
| 문맥 로딩·정책·선택 | owner-found | agent PostgresPersonaStore.get/retrieveContext; routePersona; persona-context.test.ts |
| 시점·출처 표현 | owner-found(기존 nullable 시점 경계 확장) | persona.ts/turn-context.ts; turn-context.test.ts |
| 사용자 기억 쓰기·회수 | owner-found | parsing.ts/consolidation.ts/postgres-memory-store.ts; character-context.integration.test.ts |
| 관계 단계 | owner-found | memory/bond.ts/types.ts; chat/turn-context.ts; 기존 계산 보존 |

backend guide 관련 schema가 working tree에서 변경되어 실제 schema와 대조했다.
admin guide의 관련 repository도 working 변경이 있어 가이드의 과거 테스트 수를 새 검증으로 사용하지 않았다.

예상 변경 파일(승인 후):

- backend: src/domain/database/schema.ts, 신규 drizzle/* migration/snapshot,
  test/character-context-migration.e2e-spec.ts, 필요 시 test/drizzle-migrations.e2e-spec.ts.
- admin: src/domain/database/schema.ts 미러, src/characters/character.repository.ts,
  characters.service.ts/controller.ts, dto/put-persona-structure.dto.ts와 memory DTO,
  test/character-context.e2e-spec.ts, 기존 service spec. 임의 별도 SQL 복제본 금지.
- agent: src/persona/persona.ts, postgres-persona-store.ts, persona-router.ts,
  src/chat/turn-context.ts/chat-service.ts와 관련 기존 테스트. memory 코드 변경은 경계 결함의
  재현이 있을 때만 계획을 보완하며, 현재 계획은 기존 사용자 기억 흐름의 검증을 우선한다.
- 자료: 캐릭터별 원문 snapshot/이관 대응표/적용·복구 payload/검수 파일. 기존 검수 원본과 분리.
- 문서: 검증 후 각 repo 코드베이스 가이드의 해당 경계만 갱신. 새 가설은 정본 문서로 승격 금지.

## 8. 순서와 통과 기준

설계 단계에서는 자동 테스트를 새로 만들거나 실행해 품질 숫자를 만들지 않는다.
아래는 승인 후 실행할 수직 슬라이스다. 실제 경로와 다른 손으로 만든 프롬프트는 제품 검증으로 세지 않는다.

- [x] S1 원문→정본 이관과 관리 원자성: schema+admin+reader를 연결해 합성 캐릭터의 반복 사실을
  한 번만 주입한다. stale 구조 hash409, 잘못된 source/타 캐릭터 연결400, 미인증401/403,
  참조 중 삭제409, 중간 실패 전체 rollback, 구버전 편집409를 DB/API에서 검증.
  명령: backend `npm run test:e2e -- --runTestsByPath test/character-context-migration.e2e-spec.ts`;
  admin `npm run test:e2e -- --runTestsByPath test/character-context.e2e-spec.ts`;
  agent `npm test -- src/persona/postgres-persona-store.test.ts src/persona/persona-context.test.ts`.
- [x] S2 사건 시점·출처를 실제 요청에 연결: month/day/approximate/unknown과 잘못된 날짜·다른
  캐릭터 source·해시 불일치를 검증. reason이 입력에 새로 들어오지 않고 “2023-07”이 현재
  활동으로 표현되지 않도록 자료 표시를 확인. 명령: admin 위 E2E + agent
  `npm test -- src/chat/turn-context.test.ts src/chat/character-context.integration.test.ts`.
- [x] S3 기억 저장→재접속 회수: 기존 Consolidation을 사용해 raw근거/화자/중복작업/요약범위/
  사용자·캐릭터 격리를 확인. 의미 검색은 synthetic/실제 모델을 분리.
  명령: agent `npm test -- src/memory/consolidation.test.ts src/memory/postgres-memory-store.test.ts src/chat/character-context.integration.test.ts src/chat/context-budget.test.ts`.
- [ ] S4 한소이 데이터 이관 리허설: 격리 복제본에서 전체 활성 명제의 보존·중복 대응·조각 재구성,
  인사/담이/입양시점/지우/주제중단 입력을 캡처. 다른3명은 동일한 공통 코드로 격리 회귀.
  복구 payload를 복제본에 실제 적용해 기준 원문·정책·기억이 복원되는지 검증한다.
  **기계적 이관·8입력·복구는 완료. 모든 명제의 의미 보존 및 후보 문장 내용 검수는 미완료이므로
  단계 전체를 완료로 표시하지 않는다.**
- [ ] S5 실제 모델·사용자 검수: 비용/외부전송 별도 승인 후 동일 문맥 A/B 비교.
  A=현재 integrated+현재 내용, B=정본 이관 integrated+의미가 동일한 내용.
  새 성격을 동시에 쓰지 않아 구조 효과를 분리한다. 그다음 C=같은 새 구조+사용자 승인 내용 고도화.
  관계 단계/시각/이전 대화/모델/샘플링을 고정하고 다중 턴·새 문맥·새 세션을 별도 평가한다.

DB 테스트는 검증된 일회용 TEST_DATABASE_URL이 필요하다. DB 미설정으로 skip한 결과를 성공으로
세지 않는다. backend/admin의 build/lint/schema:check와 agent typecheck/typecheck:eval/관련 전체
회귀를 실제 변경 범위에 맞춰 실행한다. 모든 외부 호출은 예산 합계에 포함한다.
기존 테스트 수431/96 등은 이 새 구조의 검증 결과가 아니다.

완료 수준은 별도 기록한다: 설계 승인 / 로컬 구조 검증 / 실제 모델 실험 / 사용자 검수 / 적용 준비.
상대 선호만으로 절대 품질 합격을 만들지 않는다. 인간 품질 합격 기준은 비교 전 사용자에게
명시적으로 확인하며 개별 not-reviewed는 그대로 둔다. 자연스러움·캐릭터성의 미해결 지적을
별도 목록으로 유지한다. 실제 답변이 없으면 제품 품질 완료를 선언하지 않는다.

## 9. 이관·복구와 적용 대상

- 기본 목표는 localhost의 전용55433 DB에서 만든 **격리 복제본**과 일회용 테스트 DB.
  기존5433·개발DB는 제외. 대상·권한·데이터 상태는 실행 직전에 재검증한다.
- 승인 후에도 기준 schema/data 백업, 복원 시험, 해당 캐릭터 행·기억·분류·연결의 해시를 먼저 고정한다.
- 기존12개 원문/13개 사건 등 실제 정본의 ID·텍스트를 무작정 바꾸지 않는다. 후보 문장과
  추가 fact는 내용 검토를 거쳐 별도 적용 payload로 만든다. 적용은 관리 API를 사용한다.
- 동일 패키지 재실행은 중복 fact·연결을 만들지 않도록 manifest의 ID/해시를 검증한다.
- **모드만 legacy로 바꾸는 것은 데이터 이관의 복구가 아니다.** never_prompt로 바꾼 조각 정책과
  추가 fact도 되돌려야 한다. 복구는 해당 변경 자료의 기대 해시를 확인한 뒤 보관한 정책·연결·
  추가 기록 상태를 원자적으로 되돌리고 새 컬럼은 남긴다. 다른 편집이 있으면409로 중단한다.
- DROP/TRUNCATE/원본 전체 덮어쓰기/벡터 일괄 재생성은 포함하지 않는다. 컬럼·테이블 down 시험은
  일회용 DB에서만 수행한다. 개발 서버 반영·배포·commit/push·웹 공개는 별도 요청이다.

## 10. 결정 장부와 다음 승인

| ID | 결정 | 근거 / 상태 |
| --- | --- | --- |
| C1 | 구조 우선, 특정 캐릭터 분기 금지, 사용자 검수만 품질 판정 | user-confirmed / active |
| C2 | 성격·말투 서술형 유지, 기존 관계 상태 재사용 | recommended-unconfirmed / active; 현재 코드 재사용 제안 |
| C3 | 이관 원문 보존+never_prompt, 공식 사실·사건 정본+참조 연결 | recommended-unconfirmed / active; 편집·주입 계약 변경 |
| C4 | 연결 테이블1개와 공식 기억 컬럼3개 추가 | recommended-unconfirmed / active; 새 DDL 승인 필요 |
| C5 | 기존 벡터 저장 타입 유지, exact검색 우선 | agent-assumed / active; 기존 동작 보존, 새 ANN은 deferred |
| C6 | 새 감정·일과·정정·망각·graph DB·자동 성격 진화 | deferred |
| C7 | 외부 모델/embedding 제공자·전송 범위·비용, 품질 합격 기준 | deferred; 실제 실험 전에 별도 확정 |

현재 설계의 핵심 미결정은 **C2~C4를 묶은 정본 관리 방향의 채택**이다.
이 방향 승인과 실제 DDL 작성·적용 승인을 혼동하지 않는다. 일반 “진행해”를 새 DDL 승인으로
해석하지 않으며, 방향이 확정되면 이 명세의 파일·대상·검증·복구 경계로 DDL 포함 승인을 요청한다.

이번 검증: 현재 schema/reader/router/관리 트랜잭션/기억 추출/관계 상태 소스와 인계 대조,
문서의 참조 경로·작업 범위 검토. 제품 테스트·DB 변경·외부 모델 호출은0.
Knowledge Delta: 제안은 이 계획에만 기록했다. 확정된 제품 아키텍처나 품질 개선으로 승격하지 않았다.

## 11. 승인 후 실행 기록 — 2026-09-11

### 실제 변경

- C2~C4는 사용자 `DDL 포함 승인`으로 user-confirmed가 됐다. 백엔드 생성 migration
  `20260911074900_character_canon_sources`와 schema/admin 미러를 변경했다.
- 기존 CharacterRepository/Service/DTO에 canonIds, 구조·기억 CAS, 출처·시점 검증을 추가했다.
  캐릭터 행을 먼저 잠가 구조 편집·기억 편집·삭제 간 경쟁을 직렬화한다. 같은 캐릭터의 활성 기억만
  연결하며 linked source는 never_prompt, 연결 중 삭제는409다. 추가 시각 편집기는 없다.
- PostgresPersonaStore/ChatService/turn-context에 링크 무결성 차단, 출처 해시·시간·정책을 포함한
  snapshot freshness, 과거 사건의 label/precision 주입을 연결했다. source_refs 본문과 reason은
  주입하지 않는다. content-only embedding hash와 출처/시점 snapshot hash를 분리했다.
- 검토 중 발견한 PostgreSQL 축약 offset(+00/+09) reader 거부, 잘못된 날짜의500,
  빈 출처 인용 허용을 수정하고 회귀에 포함했다. 수동 출처(manual)는 검증 가능한 승인 기록
  owner가 없어400으로 막았다. 승인 기록 DB/서비스를 새로 발명하지 않았다.
- 코드에 특정 캐릭터 분기는 없다. 한소이만 별도 내용 후보를 사용한 격리 리허설이며 다른
  캐릭터의 성격·메모리 내용을 이번에 일괄 고도화한 것이 아니다.

### 격리 데이터와 실제 복구

- 원본: `127.0.0.1:55433/opod_persona_memory_local`. 읽기 전용 snapshot과 dump 후 별도
  임시 PostgreSQL에 복원, 관련8개 테이블 hash 일치 후 신규 migration을 적용했다.
- 한소이 원문12개/조각28개와 기존 사건13개의 기준 자료를 고정했다. 검색 조각14개를 보존형
  never_prompt로 옮기고 canon 연결, 신규 후보12개, 기존 카메라 사건1개 본문 후보를 기록했다.
  사건 시점은 본문에서 확인되는 정밀도로만 별도 저장했다. 사용자 경험은 합성하지 않았다.
- 제품 ChatService 준비 경로로 한소이5입력(인사/담이/입양/지우/주제중단)과 다른3명 인사를
  전후 캡처했다. 담이 회색 코숏 사실이 한 번만 주입됨, 다른3명 요청이 동일함을 검증했다.
  전체45원문 및 조각 재구성은 원문과 정확히 일치했다.
- 실제 관리 API로 원래 조각 정책·기존 사건 본문·metadata를 복원하고 신규 후보는 soft delete,
  연결은 해제했다. 원문/활성 기억 내용/정책의 **논리 복구**다. 조각 ID·감사 로그·수정 시각까지
  비트 단위로 되돌렸다는 뜻은 아니다. 원본8개 테이블 hash와 원본 DDL은 최종 재확인해 불변이었다.
- 비공개 증거 디렉터리: `opod-agent/evals/results/canon-local-2026-09-11-9C2AlF/`.
  before.dump, source-before/source-hashes, before/after-captures, rehearsal-manifest,
  candidate-db, verification, final-verification, after-rollback.dump를 보관한다.
  접속 정보와 전체 원문이 있어 공개하거나 commit하지 않는다. 재실행은 baseline hash/manifest를
  먼저 확인해야 하며 이미 적용한 후보를 새로 생성하지 않는다.
  검증 종료 후 임시 컨테이너는 정리했다. 새 DDL과 논리 복구 상태는 after-rollback.dump로 복원할 수
  있다. 원본55433은 계속 유지하며 이번 새 구조가 적용된 상시 서버는 아직 없다.

### Fresh verification

| 범위 | 실행 | 결과 |
| --- | --- | --- |
| Backend 단위 | `npm test -- --runInBand` | 27 suites /149 tests 통과 |
| Backend DDL | `npm run test:e2e -- --runTestsByPath test/drizzle-migrations.e2e-spec.ts test/character-context-migration.e2e-spec.ts` | 2 suites /5 tests 통과, 빈 DB·legacy·복구 포함 |
| Admin 단위 | `npm test -- --runInBand` | 47 suites /445 tests 통과 |
| Admin 정본 API | `npm run test:e2e -- --runTestsByPath test/character-context.e2e-spec.ts` | 9 tests 통과 |
| Agent 전체 | `TEST_DATABASE_URL`을 격리 DB로 주입한 `npm test` | 41 files /438 tests 통과, DB 테스트 skip 없음 |
| 정적 검증 | backend/admin build·lint, admin schema:check; agent typecheck·typecheck:eval·build·lint; 각 diff check | 통과; private 리허설 파일 lint 경고는 제품 오류와 구분 |

초기 red: 신규 metadata 컬럼 부재로 migration 테스트 실패 후 migration 적용해 통과.
리허설 준비의 실패(기존 admin 존재로 bootstrap 미실행, JSON undefined 비교, 직접 만든 테스트
admin의 필수 필드 누락)는 테스트 하네스에서 수정했다. 한소이 내용 쓰기 전에 발생했고 원본에는
영향이 없었다. 대화 품질 실패/성공으로 집계하지 않는다.

### 인계와 미완료 경계

- **검증됨; 병합 전 사람의 검토 필요.** 검토 우선순위: migration/FK/CHECK,
  CharacterRepository의 잠금·CAS·출처 검증, reader의 무결성·snapshot 경계.
- S4 내용 후보의 전 명제 검수와 S5 실제 모델 비교는 남아 있다. 실제 응답0, 사용자 PASS0,
  실제 embedding 호출0이다. 기존 not-reviewed/상대 선호 판정은 변경하지 않았다.
- 게시물 제작 소비자는 원문을 그대로 읽는다. 해당 소비자의 정본 전환, 공유 DB 적용,
  외부 전송·유료 모델, 개발 서버 배포, commit/push·웹 공개는 하지 않았다.
- 서브에이전트2개는 사용자 지시대로 `gpt-5.6-sol`; 관리 API와 채팅 경로를 분담했다.
  주 에이전트가 schema·리허설·실제 diff 검토·최종 회귀를 맡았다.
- Knowledge Delta(repo-evidenced): backend/admin `docs/07-codebase-guide.md`와 agent 기존
  `docs/adr/0008-explicit-persona-routing.md`에 검증된 소유 경계·CAS·출처·주입 계약만 기록했다.
  한소이 후보 문장은 사용자 승인 설정으로 승격하지 않았다.
