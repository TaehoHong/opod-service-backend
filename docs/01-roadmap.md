# 01. 로드맵

> 분류 범례는 [00-overview.md](./00-overview.md) 참조.

## Now (현재)

- 현재 단계: **캐릭터 관계 기능**. (결정)
- 활성 목표: **DM 읽음 처리 / 미읽음 카운트 구현**. (결정)
  - 근거: `MessagesService.toConversationSummary`가 `unreadCount`를 하드코딩
    `0`으로 반환하며 읽음(read-receipt) 테이블이 없다
    (`src/domain/messages/messages.service.ts` 주석: "no read-receipt table
    yet"). 실제 읽음 상태·미읽음 카운트를 구현하는 것이 "관계 기능"의 첫 실체.

## Product Principles (제품 원칙)

1. **시간으로 쌓는 관계** — 캐릭터 관계는 돈이 아니라 시간(대화·재방문)으로
   깊어진다. 일당 상한이 어뷰징을 막는다. (결정, 근거: `affinity-policy.md`)
2. **개인정보 최소수집** — 필요한 증빙만 남기고 IP·User-Agent 등은 저장하지
   않는다. (결정, 근거: `consent-policy.md`)
3. **원장은 불변, 정정만** — 크레딧 원장은 삭제·덮어쓰기 없이 정정 거래로만
   상쇄한다. (결정, 근거: `credit-policy.md`)

## Next (다음)

- 근거리 마일스톤: **미정**. (유보 — 2026-07-29 인터뷰에서 사용자가 아직
  정하지 않음)
- 후보(관계 기능 계열, 코드 근거 있는 것):
  - 실시간 채팅 POST + SSE 전환 (현재 `POST /messages`는 동기 REST). (미해결)
  - 관계 상태 조회 확장 (현재 `GET /characters/:id/relationship`은
    `isFollowing`/`followedAt`만).
  - `story_view` 이벤트 추가 (현재 `POST /events`는 `feed_view`/`post_open`만).
  - 에이전트 관계 메모리(observation/reflection) 서비스 노출.

## Later (이후)

- 확장 아이디어:
  - 호감도(affinity) 구현 — 현재 **초안·미확정·미구현**. 착수하려면 정책
    확정(미정 7항목)이 선행. (유보, 근거: `affinity-policy.md`)
  - 선톡(캐릭터가 먼저 DM, 호감도 ≥80) — 호감도 선행 필요. (유보)
  - pgvector 기반 하이브리드 컨텍스트 선별 — 트리거 도달 시 전환
    (근거: `db-management.md`).
- 의존:
  - 결제 provider 실연동 (현재 local stub). (미해결 — 방향 미정)
  - 성인인증 provider 실연동 (현재 미구성 → NSFW 게이트 완성 전제). (미해결)
  - 이메일 발송 인프라 (이메일 인증·비밀번호 재설정·계정/비번 복구의 전제). (결정: 차후 연결)

## Decision Log

2026-07-29 project-init 인터뷰에서 확정한 결정.

| 날짜 | 결정 | 근거/이유 |
| --- | --- | --- |
| 2026-07-29 | 제품 정의 = "AI 컴패니언 SNS" | 캐릭터가 피드/스토리 게시, 유저가 팔로우·DM으로 관계 형성 |
| 2026-07-29 | NSFW = 성인인증 후 허용, 미인증 SFW | 코드의 `adultVerifiedAt`·SFW 게이팅·동일인 미정산 로직과 일치 |
| 2026-07-29 | 공개 범위 = 탐색 공개, 개인·쓰기 로그인 | 현재 컨트롤러 인증 동작을 정책으로 확정 |
| 2026-07-29 | Now = 캐릭터 관계 기능 → DM 읽음/미읽음 | `unreadCount` 하드코딩 0, 읽음 테이블 없음 |
| 2026-07-29 | Next = 미정 | 사용자 유보 |
| 2026-07-29 | 데이터·로그·런타임 산출물 전면 무기한 보존 | 정리 배치 없음. `db-management.md`의 "보존 정책으로 정리"를 대체 |
| 2026-07-29 | 신고 = 접수·조회만, 처리는 admin | 이 리포 역할 경계 |
| 2026-07-29 | 실시간 채팅 목표 = POST + SSE | 현재는 동기 REST(`opod-agent` 호출) |
| 2026-07-29 | `chat_reply` 원가 = 측정 필요, 2크레딧 가격 = 미확정 | 원가·마진이 산출·기록된 적 없음 (아래 gap) |
| 2026-07-29 | 탈퇴 시 이메일 원문을 법적 보관기간 유지 → 동일 이메일 재가입 차단, 계정/비번 복구 지향 | 기존 "이메일 미보관·즉시 재가입·복구 불가" 폐기 (아래 gap) |
| 2026-07-29 | 1:1 문의 일일 10건 제한 제거 (2000자·submitted 삭제 규칙은 유지) | (아래 gap) |
| 2026-07-29 | 이메일 발송 인프라 차후 연결 예정 | 이메일 인증·비번 재설정은 연결 후 제공 |
| 2026-07-29 | 결제·성인인증 provider 방향 미정 | 현재 결제 local stub, 성인인증 미구성 |
| 2026-07-29 | affinity 정책 = 초안 유지(미확정·미구현) | 참고 설계로만 보존 |
| 2026-07-29 | 배포 = 자택 단일 서버, staging 미정 | `deploy.sh` |
| 2026-07-29 | 입력 검증 = 계층 분리(DTO=구문, 도메인=불변식, 비-DTO만 방어) | 현재 도메인 과방어 정리 방향 (02·07) |
| 2026-07-29 | 주석 = 한국어, 식별자 = 영어 | 현재 관행 확정 |
| 2026-07-29 | 신규 도메인 = 2단계(풀스택 / 서비스-only) | 순수 조회는 service-only(search·health) |
| 2026-07-29 | 커밋 = Conventional Commits, main 직커밋 | 현재 git log 관행 확정 |

## 정책↔코드 Drift (구현 대기 — 이번 init에서 코드/기존 문서 수정 안 함)

새 결정과 현재 코드·기존 문서가 어긋난 지점. 후속 작업으로 정합화 필요.

| 결정 | 어긋난 대상 (gap) |
| --- | --- |
| 동일 이메일 재가입 차단 + 이메일 원문 보관 | `auth.service.ts`(`deleteAccountFromAuthorization`가 `email=null`), `test/auth.e2e-spec.ts`(재가입 검증), `docs/api/auth.md`(즉시 재가입), `account-support-policy.md` 본문, `consent-policy.md`(재가입 재동의 문구, 경미) |
| 1:1 문의 일일 제한 제거 | `inquiries.service.ts`(하루 10건), `docs/api/support.md`(429), `account-support-policy.md` §1:1 문의 |
| 무기한 보존 통일 | `db-management.md`("런타임 산출물은 보존 정책으로 정리") |
| `chat_reply` 원가 측정 + 가격 재확정 | `credit-policy.md`(가격표), `credit-pricing.ts`(`chat_reply: 2`) — 원가 산출 후 재검토 |
