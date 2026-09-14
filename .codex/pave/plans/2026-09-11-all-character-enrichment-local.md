# 모든 로컬 캐릭터 페르소나·메모리 구체화

사용자 승인: 캐릭터별 Astra 1개로 직전 공통 프롬프트를 실행하고 로컬DB에 저장.
추가 승인: `DDL 수정 포함 승인`. 대상은 확인한127.0.0.1:55433/opod_persona_memory_local.
대상4명: 한소이/서린/권도건/나희. 로컬 게시물은 모두0건이므로 읽었다고 가정하지 않는다.

## 계약
- source-preserving 새 내용 버전, 공통 스키마/관리API/채팅reader 재사용.
- 원문45개와 기존canon79개 백업. 새 성격/말투/판단/생활/기억은 local candidate, not-reviewed.
- 원문에 없는 중요 정체성 변경/충돌은 보류. 기존 사용자 경험·agent_*는 변경하지 않는다.
- 기존 검증 migration20260911074900_character_canon_sources를 로컬에 적용한다.
  새 migration/추가 DDL설계는 없다. 원문 보존, 정본연결1테이블, 출처/시점3컬럼과 기존 제약.
- 역할: 4명의 Astra는 담당폴더 candidate.json/report.md 작성, 메인은 검토·백업·적용·검증.
- DB rollback은 적용journal+원래 정책/내용을 사용하고 새행은 soft delete. full backup은 재해복구용.
  자동 DROP/TRUNCATE/원본전체덮어쓰기는 하지 않는다. 실패한 후보는 local반영 전 수정한다.
- 임시복제 DB에서 먼저 리허설, 이후 동일 candidatehash를 로컬에 저장하고 연결 새로열어읽기검증.
- 개발DB/5433/외부채팅LLM/embedding/배포/공개/commit/push는 제외한다.

## Existing owner
- owner-found: backend scripts/db-migrations.mjs와 drizzle migration/E2E가 스키마 소유.
- owner-found: admin CharactersController/Service/Repository와 test/character-context.e2e-spec.ts가
  원문·조각·기억·정책 저장/CAS검증 소유. 이번에는 제품 코드를 바꾸지 않고 API로 적용한다.
- owner-found: agent PostgresPersonaStore/ChatService와 기존리허설 스크립트가 입력캡처 경로.
- authoring metadata는 private manifest에 저장. manual 출처 승인기록을 발명하거나 userPASS를만들지않는다.

## 단계
- [x] 목록과 입력고정: 로컬4캐릭터의 source/memory hash와 자료 스냅샷.
- [x] 내용제작: 캐릭터마다 별도 Astra, 실제 보강과 기존내용 재배치 구분.
- [x] 내용검토: 사실충돌/정보소실/동일성격화/대화예시와정본혼입 방지. 사용자 품질검수와 구분.
- [x] 격리리허설: 전체백업 복원 → migration → API적용 → reader/검색/이전대화/예산검증 → 논리복구.
- [x] 로컬저장: 후보hash와baseline확인 → 승인DDL → 같은내용API적용 → 새연결재조회.
- [x] 결과기록: 캐릭터별추가/변경/보류/기계검증/실제LLM미실행 명시.

## 산출물과 검증
비공개 작업폴더: opod-agent/evals/results/persona-enrichment-2026-09-11-XMRhLN/.
원문/input, candidate, 제작report, DB백업, APIjournal/rollback, 제품입력captures 및verification.
제품코드 단위test추가는 하지 않음: 데이터 hash·ID·UTF8·정책·원문보존·실제DB/제품경로캡처가
이 작업의 정보소실/캐릭터섞임/예산초과/실제저장누락을 직접 검증한다. 자연스러움PASS는 별도사용자검수.

## 결과
- 4명 각 Astra 제작 완료, 상시 블록24개와 추가기억46개(기존이관25/창작후보21) 로컬 저장.
- 기존 페르소나 원문45개 보존/never_prompt, 기존 기억79개 유지(소이 사건1개 내용통합).
- 활성 원문69행, 활성 기억125행. 새연결 reader 재조회와 사용자 기억4테이블 해시 보존 확인.
- 같은58개 입력을 격리/로컬에서 각각 검사. 격리는 논리복구 확인, 로컬은 보강 상태 유지.
- 초기 나희 '집' 검색 누락은 후보 recallKeys 구체화 후 재검증. 실패와 복구 기록도 보존.
- 백업 before.dump/after.dump 유지. 외부 chat/embed0회, 후보 not-reviewed, 배포/커밋/푸시 없음.
- 결과 문서: opod-agent/docs/reports/character-persona-enrichment-local-2026-09-11.md.
- Knowledge Delta: user-confirmed 승인 범위와 repo-evidenced 로컬 상태만 기록; 내용 품질은 승격하지 않음.
