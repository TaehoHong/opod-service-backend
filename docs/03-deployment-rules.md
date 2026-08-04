# 03. 배포 규칙

> 분류 범례는 [00-overview.md](./00-overview.md) 참조.

## Environments

- Local: Docker Postgres(`docker/docker-compose.yml`, 5433) + `npm run start:dev`.
  `.env`에서 환경변수 로드. (사실)
- Staging: **미정** — 별도 staging 환경 없음(확인됨). (미해결)
- Production: 자택 단일 서버(`deploy.sh`의 원격 호스트). 서버가
  `~/opod-backend/docker-compose.yml`과 `.env`를 소유한다. (사실)

## Release Flow

- 브랜치 전략: main 중심. (사실 — 현재 리포 상태)
- 배포: `./deploy.sh` — linux/amd64 이미지 로컬 빌드 → `docker save` → 서버로
  scp → 서버의 `deploy.sh` 실행(`api` 서비스만 재시작). (사실)
- 스키마 마이그레이션: 컨테이너 시작 시 `prisma migrate deploy` 자동 실행
  (`docker/Dockerfile` CMD). 미적용 마이그레이션만 순서대로 적용. (사실)
- 배포 순서: 스키마 변경 포함 릴리스는 **backend 먼저** 배포(마이그레이션 적용)
  후 opod-admin 배포. (사실 — db-management.md)
- 기존 DB는 최초 1회 `0_init` baseline 필요 (db-management.md). (사실)
- Rollback: **미정** — 명시된 롤백 절차 없음. (미해결)
- Required checks: **미정** — CI 파이프라인 없음(로컬 `build`/`lint`/`test`
  수동). (미해결)

## Secrets

- 문서·플랜·리포트·wiki에 시크릿을 쓰지 않는다.
- 운영 시크릿은 서버-로컬 `.env`에 둔다. 리포의 `.env`·`.env.*`는 gitignore.
  `.env.production.example`만 커밋(플레이스홀더). (사실)
- 필수 환경변수 (`.env.production.example`):
  `DATABASE_URL`, `AUTH_JWT_SECRET`(≥32B), `ADULT_IDENTITY_HASH_SECRET`(별도
  안정 시크릿), `AUTH_REFRESH_TOKEN_TTL_SECONDS`, `OPOD_AGENT_URL`,
  `S3_PUBLIC_BASE_URL`, `PORT`, `PURCHASE_ACCOUNT_TOKEN_SECRET`, Polar/Apple/
  Google provider credential·상품 ID. 정확한 키는 `.env.production.example`을
  따른다. (사실)

## Operations

- Health checks: `GET /health` → `{ status: "ok", service: "ai-sns-backend" }`.
  (사실 — `src/service/health/health.controller.ts`)
- Logs:
  - 애플리케이션 로그: `RequestLoggingInterceptor` — 성공한 읽기(GET/HEAD/
    OPTIONS)는 로그하지 않고, 쓰기와 모든 실패만 남긴다. (사실)
  - DB 로그: `service_logs`(시스템/워커 이벤트), `console_logs`(관리자 행위),
    `llm_logs`(LLM 호출). **전면 무기한 보존, 정리 배치 없음**. (결정)
- CORS: `https://opod-web.vercel.app` 및 localhost/127.0.0.1 허용
  (`src/main.ts`). (사실)
- Backups: **미정** — 문서화된 백업 절차 없음. (미해결)
- Monitoring: **미정** — 문서화된 모니터링 없음. (미해결)
