# 06. 아키텍처

> 분류 범례는 [00-overview.md](./00-overview.md) 참조. 모듈별 상세는
> [07-codebase-guide.md](./07-codebase-guide.md).

## System Shape (사실)

- 런타임: NestJS 10 (Node 22, TypeScript strict). 진입점 `src/main.ts` →
  `AppModule` → `ServiceModule`.
- 주요 계층:
  - `src/service/<area>`: HTTP 컨트롤러 + DTO + service 모듈(도메인 wiring).
  - `src/domain/<area>`: DB 접근·비즈니스 로직(`*.service.ts`), 도메인 모듈.
  - `src/domain/database`: 공유 DB 인프라(`PrismaService`, 페이지네이션, uuid).
  - `prisma/schema.prisma`: 정본 데이터 모델.
- 소유권 경계:
  - 이 리포: 유저용 API + 공유 도메인 + **정본 스키마**.
  - opod-admin: 관리자 API·UI, 콘텐츠 작성/발행, 미디어 업로드, 스키마 미러.
  - opod-agent: 대화 생성(OpenAI 호환) + 관계 메모리(observation/reflection).
  - opod-web: 프론트엔드.

## Data Flow (사실)

- Inputs: 유저 HTTP 요청(`Authorization: Bearer` JWT), 결제/환불 webhook,
  클라이언트 이벤트(`POST /events`).
- Processing: 컨트롤러가 인증→도메인 서비스 호출. DM은 크레딧 예약→
  opod-agent 호출→캡처. `purchases`가 구매·환불 유스케이스를 조정하고,
  `payments`가 금전 상태·provider adapter, `credits`가 크레딧 원장을 소유한다.
- Outputs: JSON 응답(커서 페이지네이션), DB 기록, opod-agent로의 아웃바운드
  호출.
- Persistence: PostgreSQL(스키마 `opod`), Prisma. UUIDv7 PK. 미디어는 URL/
  storageKey로 참조하고 공개 URL은 `S3_PUBLIC_BASE_URL`로 조립
  (`src/domain/media/media-url.ts`).

## Integrations (사실)

- 외부 서비스:
  - opod-agent (`OPOD_AGENT_URL`): DM 답장 생성. OpenAI 호환 chat completion,
    `x-opod-*` 헤더로 관계 식별, 15초 타임아웃
    (`src/domain/messages/message-reply.provider.ts`).
  - S3 (`S3_PUBLIC_BASE_URL`): 미디어 공개 URL.
  - 결제 provider: 공통 `PaymentProvider` 경계 뒤에 Web Polar, Apple App Store,
    Google Play adapter가 있으며 local adapter는 개발 환경 전용이다. 운영 전환에는
    credential·상품 ID 등록과 sandbox 검증이 필요하다.
  - 성인인증 provider: **미구성**(production에서 501). 실연동 방향 미정. (미해결)
- 내부 서비스: opod-admin(공유 스키마 미러), opod-agent(공유 스키마의 agent_*
  테이블 read/write).
- 큐/스케줄 잡: 생성·기획·게시(`generation_jobs`, `post_drafts`), consolidation
  (`agent_memory_jobs`)는 **opod-admin/opod-agent가 소유**. 이 리포는 스키마만
  가지며 잡을 실행하지 않는다. (사실 — 스키마 주석)

## Operational Constraints

- 성능: 커서 페이지네이션(limit ≤ 50), 인덱스 기반 조회. pgvector는 트리거
  도달 시 도입(db-management.md).
- 보안: JWT(HS256, `AUTH_JWT_SECRET`), scrypt 비번 해시, refresh token은 해시로
  저장·폐기, 세션 advisory lock, 성인인증 식별키는 HMAC 해시로만 보관
  (`ADULT_IDENTITY_HASH_SECRET`). 원문 성인인증 응답·주민번호 미저장.
- 프라이버시: 개인정보 최소수집(IP·UA 미저장). 탈퇴 시 익명화 + 증빙 보존.
  **결정 변경**: 이메일 원문은 법적 보관기간 유지(재가입 차단) — 코드 반영 대기
  (gap, 01-roadmap).
- 신뢰성: 크레딧 예약/캡처/해제 멱등, 사용자 단위 직렬화. DM 답장 실패는
  예약 해제 + `service_logs` 기록. 결제 provider event는 서명 검증 후 고유 event
  ID로 한 번만 처리하고, provider transaction key로 중복 지급을 차단한다.

## Decision Records

| 날짜       | 결정                                                                 | 이유                                                         | 대안                                    |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| 2026-07-19 | 스키마 변경은 Prisma Migrate로 일원화                                | `db push` 수동 적용이 배포 DB drift 사고를 냄                | db push 유지(기각)                      |
| (스키마)   | agent 관계 메모리 테이블을 이 리포 스키마에 호스팅(FK 없음, TEXT id) | 정본 스키마 소유자가 여기이고, 식별자는 X-Opod-* 헤더로 유입 | 별도 DB(기각)                           |
| (스키마)   | 임베딩·캡션 등 파생 데이터는 정본 아님, 백필 재생성                  | 모델 교체·장애가 "백필 재실행"으로 수렴                      | 정본 취급(기각)                         |
| 2026-07-29 | 데이터 전면 무기한 보존                                              | 정리 배치 없이 단순 유지                                     | 보존기간 정리(기각)                     |
| 2026-07-29 | 실시간 채팅 목표 = POST+SSE                                          | 스트리밍 UX. 현재는 동기 REST                                | WebSocket(후보)                         |
| 2026-08-04 | purchases/payments/credits 분리, Web Polar + Apple/Google IAP        | PG 교체와 금전·재화 책임 분리                                | Polar 직접 의존(기각), 일반 Order(기각) |

세부 아키텍처 판단은 opod-agent의 ADR(`opod-agent/docs/adr/*`)도 참조(대화·
메모리 계약). 이 리포 밖 근거이므로 변경 전 확인 필요.
