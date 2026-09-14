# DM 문맥 연속성과 greeting 분리

## 목표

사용자가 답변 생성 중 다음 메시지를 보내도 Agent 요청 문맥을
`첫 사용자 발화 → 첫 캐릭터 답변 → 다음 사용자 발화` 순서로 전달하고,
캐릭터가 먼저 말을 걸 때 쓰는 `greeting` 블록은 일반 반응형 DM 프롬프트에서
제외한다.

## 범위 지도

- in-scope: Backend 답변 작업별 논리 문맥 정렬, Agent 반응형 프롬프트의
  `greeting` 제외, 회귀 테스트, 트러블슈팅 기록
- preserve-current-behavior: 사용자 메시지마다 답변 1회, 크레딧 예약·캡처·해제,
  작업 직렬화·재시도, 페르소나 원본 블록 보존
- out-of-scope: DB schema·migration·DDL, 개발 DB/Admin 데이터 수정, 연속 발화
  묶음 답변, 프런트 입력 잠금, 모델 교체, 전체 페르소나·메모리 재작성

## Existing Owner Check

| 동작 | 결과 | 정본 |
| --- | --- | --- |
| 답변 작업의 Agent 문맥 구성 | owner-found | `MessageReplyWorker.replyContext` |
| 사용자 발화와 캐릭터 답변의 작업 연결 | owner-found | `Message.replyJobId`, `MessageReplyJob.messages` |
| 안정적인 페르소나 시스템 프롬프트 조립 | owner-found | `assembleSystemPrompt` |

검색 근거는 `replyContext`, `replyJobId`, `assembleSystemPrompt` 호출부와 각 소유
파일의 단위 테스트다. 새 서비스나 공유 추상화는 만들지 않는다.

## Proven Root Cause

1. Backend는 현재 답할 사용자 메시지의 `createdAt`까지만 과거 메시지를 조회했다.
2. 비동기 답변 생성 중 다음 사용자 메시지가 먼저 저장되면, 이전 캐릭터 답변의
   물리적 `createdAt`은 다음 사용자 메시지보다 늦어진다.
3. 따라서 다음 작업의 문맥에서 직전 캐릭터 답변이 빠져 사용자 발화 두 개가 연속된
   것처럼 Agent에 전달됐다.
4. Agent는 `greeting`을 다른 페르소나 블록과 함께 모든 반응형 DM에 주입해, 이미
   대화 중인 답변에도 첫인사 성향을 반복 적용했다.

페르소나·메모리 자체의 품질보다, 그 앞단의 대화 이력 누락과 용도별 블록 분리 실패가
관찰된 어색한 답변의 직접 원인이었다.

## 구현 체크리스트

1. `src/domain/messages/message-reply.worker.spec.ts`
   - 빠른 연속 발화에서 이전 답변이 다음 발화보다 먼저 전달되는 회귀 테스트 추가
   - red 확인: 기존 구현은 `user1 → user2 → assistant1`로 실패
2. `src/domain/messages/message-reply.worker.ts`
   - 현재 작업까지의 메시지만 조회하고 `replyJob.createdAt/id`로 작업 순서를 구성
   - 같은 작업 안에서는 `user → character` 순서로 정렬
   - 비동기 전환 이전 `replyJobId = null` 메시지는 기존 시각 경계를 유지
3. `../opod-agent/src/chat/system-prompt.test.ts`, `system-prompt.ts`
   - `greeting` 블록 보존과 반응형 DM 미주입 회귀 테스트 추가
   - 제목의 대소문자·주변 공백을 정규화해 `greeting`만 제외
4. `docs/troubleshooting/`
   - 증상, 원인, 해결, 회귀 가드를 고신호 기록으로 남김

## Test Value Gate

두 테스트는 각각 모델이 실제로 받는 메시지 배열과 최종 시스템 프롬프트를 검증한다.
내부 헬퍼 호출 횟수가 아니라 사용자에게 멍청하게 보였던 대화 단절과 첫인사 반복을
직접 검출하므로 회귀 가치가 있다.

## 승인

- 구현 승인: 2026-08-31 사용자 `진행해`
- DDL: 없음

## 구현 결과

- 물리적 메시지 생성 시각 대신 답변 작업의 논리 순서로 문맥을 복원했다.
- 미래 작업의 사용자 메시지는 제외하면서 이전 완료 답변은 다음 작업에 포함한다.
- `greeting` 원본은 유지하되 일반 DM 시스템 프롬프트에서는 제외했다.
- 기존 답변 완료·크레딧 트랜잭션은 변경하지 않았다.

## 검증 결과

- Backend narrow: `message-reply.worker.spec.ts` 17/17 통과
- Agent narrow: `system-prompt.test.ts` 12/12 통과
- Backend lint/build: 통과
- Agent lint/typecheck: 통과
- Backend full: format·lint·build 통과, unit 195/195, E2E 96/96 통과
- Agent full: lint·build 통과, unit 265/265 통과(환경 의존 14개 skip)
- `git diff --check`: Backend·Agent 모두 통과
