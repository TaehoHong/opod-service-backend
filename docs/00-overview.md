# 00. 프로젝트 개요

> 분류 범례: **(사실)** 코드·구성에서 확인된 repo fact · **(결정)** 사용자가 확정한
> product/policy 결정 · **(미해결)** 질문했으나 아직 미확정 · **(유보)** 사용자가
> 의도적으로 뒤로 미룸 · **(해당없음)** 이 리포 범위 밖 · **(gap)** 정책과 현재
> 코드가 어긋난 지점(구현 대기).
>
> 이 문서 세트는 2026-07-29 project-init 인터뷰에서 확정한 방향을 담는다.
> 상세 정책은 `docs/`의 개별 정책 문서를, 코드 내비게이션은
> [07-codebase-guide.md](./07-codebase-guide.md)를 따른다.

## 한 줄 정의

OPOD 서비스 백엔드 — **AI 캐릭터가 피드·스토리를 올리고 유저가 팔로우·DM으로
관계를 쌓는 "AI 컴패니언 SNS"** 의 공개(유저용) HTTP API. (결정)

## 대상 사용자

- 주 사용자: AI 캐릭터와 대화·팔로우하며 관계를 쌓는 일반 유저. (결정)
- 내부 운영자: opod-admin으로 캐릭터·콘텐츠·크레딧을 운영하는 관리자.
  이 리포는 관리자 기능을 **소유하지 않는다**. (사실)
- 연령·등급: 만 14세 이상 필수 동의. 성인인증 후 NSFW 허용, 미인증은 SFW만. (결정)

## 문제

유저가 AI 캐릭터와 지속적 관계(피드 소비, DM 대화, 팔로우)를 맺는 소셜 경험을
제공하되, 액션당 정액 종량제 크레딧으로 대화 비용을 통제한다.

## 프로젝트 방향

- 제품 약속: **시간이 지날수록 깊어지는 캐릭터 관계** — 관계는 돈이 아니라
  시간(대화·재방문)으로 쌓인다. (결정)
- 전략 제약:
  - 개인정보 최소수집 (IP·User-Agent 미저장, 증빙만 보관). (결정)
  - 크레딧 원장은 불변 — 삭제·덮어쓰기 없이 정정 거래로만 상쇄. (결정)
- 비목표(Non-goals):
  - 관리자 API·UI (opod-admin 소관). (결정/사실)
  - 미디어 생성·기획·게시 파이프라인 (opod-admin/opod-agent 소관). (결정/사실)
  - 웹/앱 프론트엔드 (opod-web 소관). (결정)
  - 당분간 이메일 발송 인프라 — 차후 연결 예정. (결정)

## 온보딩 요약

- **액터**: 유저(User) / AI 캐릭터(Character, 게시·댓글·반응·DM 답장의 주체) /
  관리자(Admin, opod-admin). (사실)
- **핵심 워크플로**: 가입·로그인 → 피드/게시글/스토리 탐색 → 캐릭터 팔로우 →
  DM 대화(크레딧 차감) → 크레딧 충전/환불 → 고객지원(FAQ·공지·1:1 문의). (사실)
- **기술 형태**: NestJS 서비스가 `src/service`(HTTP) → `src/domain`(DB 로직) →
  `prisma`(정본 스키마) 계층으로 구성. 대화 생성은 외부 opod-agent 호출. (사실)
- **현재 우선순위(Now)**: "캐릭터 관계 기능" — 구체적으로 **DM 사용자 메시지는
  영속 답변 작업 저장까지 동기 처리하고, Backend worker가 Agent 요청-응답을
  처리하며, Web은 cursor polling으로 새 답변을 조회하는 구조로 전환**. (결정)

## 현재 범위

- In scope: 유저용 HTTP API(인증·피드·게시글·스토리·팔로우·DM·크레딧/결제·
  약관동의·고객지원·신고·검색·알림·이벤트), 정본 Prisma 스키마, DB 스키마 작업
  (`prisma db push`/migrate). (사실)
- Out of scope: `/admin/*` 라우트, admin UI, admin 미디어 업로드, 크레딧 수동
  지급, 생성 잡 운영, 기타 관리자 전용 동작. (사실 — `AGENTS.md` 경계)

## 아키텍처 스냅샷

- 런타임: NestJS 10 (Node 22), TypeScript strict. 진입점 `src/main.ts` →
  `AppModule` → `ServiceModule`. (사실)
- 데이터: PostgreSQL(스키마 `opod`), Prisma 7 + `@prisma/adapter-pg`. 정본
  스키마 `prisma/schema.prisma`. (사실)
- 외부 시스템: opod-agent(대화 생성·관계 메모리, `OPOD_AGENT_URL`), S3(미디어
  공개 URL, `S3_PUBLIC_BASE_URL`), 결제 provider(웹 Polar adapter, Apple/Google
  IAP adapter, 개발용 local adapter), 성인인증 provider(미구성). (사실)
- 데이터 보존: 전면 무기한 보존, 정리 배치 없음. (결정)

## 문서 색인

- [01-roadmap.md](./01-roadmap.md)
- [02-development-rules.md](./02-development-rules.md)
- [03-deployment-rules.md](./03-deployment-rules.md)
- [04-design-rules.md](./04-design-rules.md)
- [05-quality-rules.md](./05-quality-rules.md)
- [06-architecture.md](./06-architecture.md)
- [07-codebase-guide.md](./07-codebase-guide.md)

### 정책 문서 (별도, 이번 init 대상 아님 — 감사만 수행)

- [credit-policy.md](./credit-policy.md) — 크레딧·요금·환불. **확정** (단
  `chat_reply` 원가·마진은 (미해결), 2크레딧 가격은 (미확정)).
- [consent-policy.md](./consent-policy.md) — 약관·개인정보 동의. **확정**.
- [account-support-policy.md](./account-support-policy.md) — 계정·고객지원.
  **수정 확정** — 본문 일부가 새 결정과 어긋나 갱신 대기 (gap, 01-roadmap 참조).
- [db-management.md](./db-management.md) — DB 관리·마이그레이션·pgvector.
  **확정** (보존은 무기한으로 통일 — 본문 "보존 정책으로 정리"는 stale).
- [affinity-policy.md](./affinity-policy.md) — 호감도. **초안(미확정·미구현)**.
- `api/auth.md`, `api/support.md`, `api/terms.md` — 구현 계약·상태 문서(reference).
