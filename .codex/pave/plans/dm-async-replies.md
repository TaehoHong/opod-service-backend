# DM 답변 비동기 전환 계획

## 상태

- 목표 구조 문서화: 완료 (2026-08-10)
- 제품·운영 세부 결정: 완료
- 범위 축소: 발화 묶음 제외 (2026-08-11)
- 코드·테스트 편집 승인: 완료 (2026-08-11)
- 구현·검증: 진행 중

## 목표

- 사용자 메시지와 영속 답변 작업은 service-backend 저장 성공까지 동기 처리한다.
- service-backend worker가 기존 opod-agent API를 요청-응답 방식으로 호출한다.
- opod-web은 기존 `GET /messages` cursor로 새 메시지를 주기적으로 조회한다.

## 범위

- service-backend: 사용자 메시지 저장 응답, 영속 답변 작업, worker, 크레딧 수명주기
- opod-agent: 기존 동기 요청-응답 API 재사용, 원칙적으로 변경 없음
- opod-web: 기존 cursor 조회 계약만 보존하며 구현은 제외
- 제외: 발화 묶음, Web 코드와 폴링 UX, Agent callback, SSE, WebSocket, 관리자 생성 잡

## 확정된 결정

- [x] `POST /messages`는 Agent 답변을 기다리지 않는다.
- [x] service-backend가 영속 답변 작업과 worker를 소유한다.
- [x] worker가 기존 opod-agent 요청-응답 API를 호출한다.
- [x] 사용자 메시지 1건이 답변 작업 1건이고 답변 1건을 만든다.
- [x] 같은 대화의 작업은 직렬, 다른 대화는 병렬 처리한다.
- [x] Web은 cursor polling으로 새 메시지를 조회한다.
- [x] 사용자 메시지 ID인 `turnId`를 작업과 Agent 요청의 연결 키로 사용한다.
- [x] 캐릭터 메시지 저장과 크레딧 캡처는 하나의 완료 단위로 처리한다.
- [x] Agent 연결 실패·일시 장애·timeout은 동일 `turnId`로 최대 3회 시도하고,
      영구 실패는 재시도하지 않는다.
- [x] 차후 Backend↔Agent 전달을 MQ 또는 Kafka로 교체하되 이번에는 기존 HTTP
      요청-응답을 사용하고 브로커 구조를 미리 만들지 않는다.
- [x] `chat_reply` 크레딧은 작업마다 한 번 예약하고 대기·생성·재시도 중 유지한다.
      실제 처리 시작 후 15분 안에 성공하면 캡처하고, 최종 실패하거나 15분을
      넘으면 해제한다.
- [x] 최종 실패는 사용자 메시지를 유지한 채 작업을 `failed`로 기록하고
      예약을 해제한 뒤 다음 작업을 처리한다.
- [x] 실패한 작업의 명시적 재시도는 대화 마지막 순서에 새 처리 기회로 배치하고,
      새 예약과 최대 3회·15분 정책을 적용하며 중복 요청은 하나로 처리한다.
- [x] worker는 새 스케줄러 의존성 없이 자체 주기 tick으로 준비된 작업을 선점한다.

## 보류된 결정 (2026-08-11 범위 축소)

아래는 2026-08-10에 확정했으나 이번 구현에서 제외한다. 되살릴 때 스키마 변경은
필요 없다 — `messages.reply_job_id`가 이미 N:1이라 여러 사용자 메시지를 한 작업에
묶을 수 있다.

- 짧게 연속된 사용자 메시지를 하나의 발화 묶음으로 합쳐 한 번 답한다.
- 첫 메시지 뒤 1.5초 무입력 또는 최초 메시지 후 5초에 묶음을 닫는다.
- 생성 중 도착한 메시지는 다음 묶음으로 넘긴다.

이 제외의 제품적 결과: 사용자가 연속으로 3번 보내면 답변 3건이 생기고 크레딧도
3회 차감된다. 묶음은 원래 이 비용을 없애려던 장치였다.

## 미해결 결정

- 없음

## 구현 제외

- opod-web 코드 변경
- Web 폴링 주기와 화면 이탈 시 중단 조건
- Web의 pending·failed 표시 방식

## 기능 준비 상태

| 항목            | 계약                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| Actor / trigger | 인증한 사용자가 `POST /messages`로 캐릭터에게 메시지를 전송                                                   |
| Happy path      | 사용자 메시지와 답변 작업 저장 후 즉시 201 → worker가 작업 처리 → 답변 저장·크레딧 캡처                       |
| 순서            | 같은 대화는 작업별 직렬, 다른 대화는 최대 4건 병렬 처리                                                       |
| 권한            | 메시지 조회·전송·재시도는 대화 소유 사용자만 가능                                                             |
| 데이터          | 작업마다 예약 1건, 사용자 메시지 ID를 `turnId`로 사용, 성공 답변·usage는 각각 최대 1건                        |
| 실패            | 일시 장애·timeout 최대 3회/처리 시작 후 15분, 영구 실패는 즉시 `failed` + release                             |
| 수동 재시도     | `failed`인 본인 작업만 현재 대화의 마지막 순서로 재등록, 새 예약, 중복 요청 멱등                              |
| 공개 상태       | 내부 queued/running은 `pending`, 완료는 `completed`, 최종 실패는 `failed`; 내부 오류 원문은 비공개            |
| 수용 기준       | POST가 Agent를 기다리지 않고, 순서·재시도·크레딧·실패 상태가 재시작과 중복 요청에도 일관됨                    |

## API 계약

- `POST /messages`: 기존 인증·입력·잔액 검증을 유지하고, 응답 `messages`에는 방금
  저장한 사용자 메시지만 반환한다. 메시지에는 `turnId`와
  `replyStatus: pending`을 포함한다.
- `GET /messages`: 기존 cursor pagination을 유지하고 각 메시지에 `turnId`와
  `replyStatus(pending|completed|failed)`를 포함한다.
- `POST /messages/retry`: `{ turnId }`로 본인의 최종 실패 작업을 재시도하고 202로
  pending 상태를 반환한다. 없는 작업은 404, pending/completed 작업은 409,
  잔액 부족은 기존 크레딧 오류를 사용한다.

## 데이터·처리 설계

- `MessageReplyJob`이 영속 답변 작업을 나타낸다. conversation, `turnId`, credit
  reservation reference, 상태, 준비 시각, 시도 횟수, lease, 시작·기한·완료·실패
  시각과 내부 실패 분류를 가진다.
- `Message.replyJobId`가 작업을 참조한다. 사용자 메시지와 그 답변이 같은 작업을
  가리킨다. 관계는 N:1이라 나중에 발화 묶음을 되살려도 스키마가 바뀌지 않는다.
- 일반 예약은 기존 5분 TTL을 유지한다. `chat_reply` 작업 예약은 `expiresAt=null`로
  작업이 직접 release/capture하며, 가용 잔액 계산에는 활성 예약으로 포함한다.
- worker는 대화 단위 advisory lock 안에서 준비된 작업을 선점하고 DB lease로
  처리 중임을 표시한다. 한 대화에서 한 작업만 실행한다. 만료된 lease는 다음
  tick이 회수하며, 현재 배포에서는 최대 4개 대화를 병렬 처리한다.
- worker의 주기 tick이 필요한 이유는 두 가지다. 재시도는 `readyAt`이 미래인
  작업을 만들고, 프로세스가 죽으면 메모리에 있던 깨우기 신호가 사라져 `queued`
  작업과 만료 lease를 아무도 집지 않는다. 작업을 DB에 영속화한 의미를 지키려면
  시간 기반 회수가 있어야 한다.
- 처리 순서는 `readyAt asc, id asc`다. 재시도는 `readyAt`을 현재 시각으로 다시
  찍어 자연히 대화의 마지막 순서로 간다.
- Agent 문맥은 해당 작업의 사용자 메시지 시각까지만 포함한다. 뒤에 도착해 대기
  중인 메시지는 제외한다.
- 성공 트랜잭션은 캐릭터 메시지, reservation capture/usage, 작업 completed,
  conversation `lastMessageAt`을 함께 반영한다. 최종 실패 트랜잭션은 작업 failed와
  reservation release를 함께 반영하고 durable service log를 남긴다.
- 차후 MQ/Kafka 전환은 worker의 Agent 전달 부분만 대체하며 이번에 transport
  abstraction이나 broker dependency를 만들지 않는다.

## 테스트 가치

- `MessagesService` 단위 테스트: Agent 응답을 기다리지 않는 201 계약, 작업·예약
  1건 생성, 소유권·상태별 수동 재시도를 보호한다.
- `MessageReplyWorker` 단위 테스트: 대화별 직렬, 미래 메시지 문맥 제외, 최대 3회
  재시도, lease 회수, 성공·최종 실패의 멱등 상태 전이를 보호한다.
- provider 단위 테스트: retryable 일시 장애·timeout과 영구 실패 분류를 보호한다.
- messages E2E: POST pending → cursor polling completed/failed, 작업당 답변과
  usage 한 건, 명시적 재시도의 인증·멱등 계약을 실제 PostgreSQL로 보호한다.
- credits E2E: nullable job-managed reservation이 만료 예약과 달리 가용 잔액에서
  빠지고, capture/release가 한 번만 반영되는 원장 불변식을 보호한다.

## 구현 체크리스트

- [x] 구현 전 결정 원장을 확정한다.
- [x] 변경 파일·테스트 가치·검증 명령을 정리한다.
- [x] 코드·테스트 편집에 대한 통합 승인을 받는다.
- [x] `prisma/schema.prisma`와 새 migration에 `message_reply_jobs`, `messages`
      참조, nullable 예약 만료와 인덱스를 추가한다.
      (`20260810232053_add_message_reply_jobs`)
- [x] `src/domain/credits/credits.service.ts`에 동일 트랜잭션에서 사용할
      capture/release 경계를 추가하고 job-managed 예약을 잔액·만료 계산에
      반영한다. `activeReservationFilter`를 purchases 환불 차단에도 공유한다.
- [x] `src/domain/messages/messages.service.ts`에서 동기 Agent 호출을 제거하고
      메시지·작업·예약 저장, 상태 포함 조회, 실패 작업 재시도를 구현한다.
- [x] 새 `src/domain/messages/message-reply.worker.ts`와 spec에 advisory lock 선점,
      DB lease, 대화별 직렬, 문맥 경계, 3회·15분 재시도, 성공·실패 원자적 완료와
      재시작 회수를 구현한다.
- [x] `src/domain/messages/message-reply.provider.ts`와 spec이 Agent 오류를
      retryable/terminal로 구분하게 하고, `messages.module.ts`에 worker를 등록한다.
- [x] `src/service/messages/messages.controller.ts`, `message.dto.ts`,
      `src/service/swagger.ts`에 pending 응답과 `POST /messages/retry` 계약을 추가하고
      `test/messages.e2e-spec.ts`에서 실제 PostgreSQL 상태 전이를 검증한다.
- [x] `docs/07-codebase-guide.md`, `06-architecture.md`, `01-roadmap.md`,
      `credit-policy.md`, `03-deployment-rules.md`, `.env.production.example`을
      검증된 구현 사실에 맞춘다.
- [x] `npm run format`, `npm run lint`, `npm run test`, `npm run test:e2e`,
      `npm run build`를 실행하고 모두 성공해야 한다.

## 남은 일 (이번 범위 밖)

- opod-web: 폴링 주기, 화면 이탈 시 중단, pending·failed 표시. 이게 없으면
  답변이 저장돼도 사용자 화면은 그대로다.
- 개발 서버 DB에 `20260810232053_add_message_reply_jobs` 반영.
- opod-admin의 prisma 미러 스키마 동기화(drift 검사).
- 발화 묶음 되살리기 판단 — 연속 발화의 중복 차감이 실제로 문제가 되는지 관측 후.
