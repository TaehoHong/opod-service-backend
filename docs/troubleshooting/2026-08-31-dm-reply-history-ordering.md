---
id: TS-20260831-01
status: resolved
area: dm-reply-context
severity: medium
root-cause-confidence: proven
evidence-source: repo-evidenced
affected-paths:
  - src/domain/messages/message-reply.worker.ts
  - ../opod-agent/src/chat/system-prompt.ts
created: 2026-08-31
verified: 2026-08-31
superseded-by: null
summary: "빠른 연속 발화에서 직전 캐릭터 답변이 Agent 문맥에서 누락되고 greeting이 반응형 DM마다 주입되던 문제를 작업 단위 정렬과 블록 용도 분리로 해결했다."
---

# Troubleshooting: DM Reply History Ordering

## Symptom and Impact

사용자가 캐릭터 답변 생성 중 다음 메시지를 빠르게 보내면, 다음 답변이 직전 캐릭터
발화를 모르는 것처럼 이어졌다. 이미 대화가 진행 중인데도 첫인사에 가까운 태도가
반복돼 캐릭터의 페르소나와 메모리가 빈약하거나 일관되지 않은 것처럼 보였다.

## Reproduction or Diagnostic Evidence

개발 환경의 최근 Agent 요청을 민감한 원문 없이 순서만 비교했다.

- 저장 순서: `user1 → user2 → assistant1`
- 두 번째 Agent 요청의 기존 문맥: `user1 → user2`
- 필요한 논리 문맥: `user1 → assistant1 → user2`

Backend 워커 테스트에서 같은 순서를 구성하자 기존 코드가
`user1 → user2 → assistant1`로 전달해 실패했다. Agent 테스트에서는 authored
`greeting` 내용이 일반 DM 시스템 프롬프트에 그대로 포함돼 실패했다.

## Investigation

| Hypothesis | Diagnostic action | Result | Confidence |
| --- | --- | --- | --- |
| 페르소나 또는 메모리 데이터가 비어 있음 | Agent 요청의 persona·memory 섹션 확인 | 데이터는 전달됐으나 직전 assistant 발화가 없었음 | rejected |
| 워커가 같은 대화 작업을 동시에 실행함 | claim·advisory lock·running sibling 조건과 테스트 확인 | 작업은 직렬화됨 | rejected |
| 메시지 시각 경계가 비동기 답변을 누락함 | 사용자·답변 저장 시각과 `replyContext` 쿼리 비교 | 이전 답변이 다음 사용자 발화 뒤에 저장돼 경계 밖으로 밀림 | proven |
| greeting이 모든 답변의 태도를 첫인사 쪽으로 유도함 | `assembleSystemPrompt`의 블록 조립 확인 | 용도 구분 없이 모든 authored block을 주입함 | proven |

## Proven Root Cause

`MessageReplyWorker.replyContext`가 현재 사용자 메시지의 물리적 생성 시각까지만
조회했다. 답변 생성 중 다음 사용자 메시지가 먼저 저장되면, 이전 작업의 캐릭터
답변은 그 시각보다 늦게 생겨 다음 작업 문맥에서 제외된다. 작업은 직렬이어도 메시지
행의 생성 순서는 논리 대화 순서와 다를 수 있다.

별도로 `assembleSystemPrompt`는 캐릭터가 대화를 먼저 열 때 쓰는 `greeting` 블록을
일반 반응형 DM에도 포함했다. 이 블록은 데이터가 잘못된 것이 아니라 사용 경계가
없었던 것이다.

## Resolution

Backend는 현재 `MessageReplyJob`까지 연결된 메시지만 조회하고, 작업의
`createdAt/id`로 작업 순서를 정한 뒤 같은 작업 안에서 `user → character`로 정렬한다.
비동기 전환 이전의 `replyJobId = null` 메시지는 기존 사용자 턴 시각 경계를 유지한다.

Agent는 authored persona를 변경하지 않고 `greeting` 제목만 반응형 DM 시스템
프롬프트 조립에서 제외한다. 연속 발화를 한 답변으로 합치거나 입력을 잠그는 방식은
현재 one-message/one-reply 계약을 바꾸므로 적용하지 않았다.

## Regression Guard and Verification

- Guard: 빠른 연속 발화의 모델 입력이 `user1 → assistant1 → user2`인지 검증
- Guard: `greeting`은 persona에 남지만 반응형 시스템 프롬프트에는 없는지 검증
- Narrow verification: Backend 17/17, Agent 12/12 통과
- Broader verification: Backend format·lint·build, unit 195/195, E2E 96/96;
  Agent lint·build, unit 265/265 통과
- Residual risk: 실제 운영 데이터의 오래된 null 작업 메시지는 시각 순서를 유지하므로,
  별도 작업 연결 정보가 없는 과거 행의 잘못된 물리 순서는 복원할 수 없다.

## Durable Project Knowledge

소유 지점이나 구조는 바뀌지 않아 `docs/07-codebase-guide.md`는 수정하지 않았다. 이
기록이 비동기 저장 순서와 논리 대화 순서의 차이, 회귀 가드, 복구 원칙을 보존한다.

## Evidence Links

- Files: `src/domain/messages/message-reply.worker.ts`,
  `src/domain/messages/message-reply.worker.spec.ts`,
  `../opod-agent/src/chat/system-prompt.ts`,
  `../opod-agent/src/chat/system-prompt.test.ts`
- Commit, pull request, or issue: 없음
- Related troubleshooting records: 없음
