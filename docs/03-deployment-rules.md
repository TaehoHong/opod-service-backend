# 03. 배포 규칙

> 분류 범례는 [00-overview.md](./00-overview.md) 참조.

## Environments

> DB를 가리키는 용어는 [02-development-rules.md](./02-development-rules.md)
> "DB 환경 용어"가 정본이다 — 로컬 / 개발 / 운영(아직 없음) / 테스트.

- 로컬: 개별 PC의 Docker Postgres(`docker/docker-compose.yml`, 5433) +
  `npm run start:dev`. `.env`에서 환경변수 로드. (사실)
- 개발 서버: `dev-run-taeho`(`deploy.sh`의 원격 호스트). 서버가
  `~/opod-backend/docker-compose.yml`과 `.env`를 소유한다. **`deploy.sh`가
  배포하는 대상은 여기다.** (결정 2026-08-06 — 이전 문서는 이를 "Production"
  이라 적었으나 오기였다)
- 운영: **아직 없다.** (결정 2026-08-06)
- Staging: **미정** — 별도 staging 환경 없음(확인됨). (미해결)

## Release Flow

- 브랜치 전략: main 중심. (사실 — 현재 리포 상태)
- 배포: `./deploy.sh` — 소스를 서버로 전송한 뒤 원격 Docker 이미지를 빌드하고
  서버 소유 compose의 `api` 서비스를 재시작한다. 개발 서버 배포가 운영 전환을 뜻하지 않는다. (사실)
- 스키마 마이그레이션: 컨테이너 시작 시 `npm run db:migrate:deploy` 자동 실행
  (`docker/Dockerfile` CMD). 미적용 마이그레이션만 순서대로 적용. (사실)
- 배포 순서: 스키마 변경 포함 릴리스는 **backend 먼저** 배포(마이그레이션 적용)
  후 opod-admin 배포. (사실 — db-management.md)
- 기존 DB는 첫 Drizzle 배포 전에 `20260831062118_baseline`을 최초 1회 등록해야
  한다 (db-management.md). (사실)
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
  Google provider credential. Web provider는 DB `admin_settings['payments.webProvider']`,
  상품·가격·통화·provider 상품 ID는 `payment_product_mappings`가 정본이다.
  Nginx 한 단계를 거치는 배포라면 `TRUST_PROXY_HOPS=1`로 실제 고객 IP를 복원한다.
  실제 hop 수는 배포 토폴로지와 일치시켜야 한다. 정확한 키는 `.env.production.example`을 따른다. (사실)
- Polar는 `POLAR_SERVER=sandbox|production`을 반드시 명시한다. 누락·오타는
  503으로 거절하며 production으로 추측하지 않는다. sandbox는 `POLAR_SANDBOX_API_KEY`,
  production은 `POLAR_ACCESS_TOKEN`만 사용하고 다른 환경의 토큰으로 fallback하지 않는다.
  `POLAR_WEBHOOK_SECRET`도 선택한 환경·merchant의 endpoint secret이어야 한다. (결정)
- DM 답변 worker는 서비스 프로세스 안에서 함께 돈다. 기본값으로 동작하므로
  설정은 선택이며, 모두 `MESSAGE_REPLY_` 접두사다: `WORKER_ENABLED`(false면 API만
  뜨고 worker는 안 돔), `POLL_INTERVAL_MS`(1000), `CONCURRENCY`(동시에 처리할 대화
  수, 4), `MAX_ATTEMPTS`(3), `DEADLINE_MS`(900000), `LEASE_MS`(360000),
  `RETRY_BACKOFF_MS`(5000). (사실)
- 인스턴스를 여러 개 띄워도 lease와 대화 단위 advisory lock이 중복 처리를 막는다.
  worker를 한 프로세스에만 두고 싶으면 나머지에 `MESSAGE_REPLY_WORKER_ENABLED=false`
  를 준다. (사실)

## Polar 운영 전환 게이트

아래 조건을 확인하기 전에는 `POLAR_SERVER`만 바꿔 배포하지 않는다.

1. **데이터와 처리 중 거래 확인.** 신규 web 결제는 `payments.provider_environment`에
   생성 당시 환경을 저장한다. 기존 Polar 행이 NULL이면 checkout 재사용·조회 복구·환불·
   정산이 409로 차단된다. 기존 거래의 환경은 결제사 기록으로 독립 검증한 뒤 승인된 데이터
   이관으로 확정해야 한다. 현재 환경값을 일괄 복사하거나 임의로 sandbox라고 추측하지 않는다.
2. **환경 격리.** backend 하나는 Polar 환경 하나만 처리한다. 변경 후에는 과거 환경의
   pending 결제·webhook·완료된 구매의 환불과 중복 요청도 거절된다. 기존 흐름을 먼저 해소하거나
   별도 backend·DB로 운영 환경을 분리한다. 환경 binding은 기존 sandbox 잔액·크레딧 원장을
   지우거나 운영용으로 변환하지 않는다. 원장 이관은 별도 승인·검증이 필요하다.
3. **동일 merchant의 운영 설정.** 서버에 `POLAR_SERVER=production`, `POLAR_ACCESS_TOKEN`,
   해당 endpoint의 `POLAR_WEBHOOK_SECRET`을 등록한다. DB web provider를 `polar`로 선택하고
   활성 `payment_product_mappings`의 `channel=web`, `provider=polar`,
   `environment=production` 상품 ID·가격·통화를 결제사와 대조한다. 같은 environment 안에서
   merchant만 바뀌는 것은 코드가 탐지하지 못하므로 토큰·상품·webhook·DB를 함께 확인한다.
4. **Web 연결 확인.** 운영 backend의 `/payments/webhooks/polar`에 `order.paid`,
   `order.refunded`를 연결한다. 정규화 event의 환경은 서명을 확인한 서버 설정에서 나오며
   결제사 payload의 별도 환경 증명을 뜻하지 않는다. 프런트 API URL과 `WEB_APP_URL`도
   실제 운영 도메인을 향해야 한다. success 경로는 `/profile/payment-return`,
   return 경로는 `/profile`이다.
5. **검증 후 활성화.** `/health`와 공개 상품 목록만으로 토큰·merchant·실결제 준비 완료를
   판정하지 않는다. 격리된 테스트와 아래 회귀 검사를 먼저 통과시키고, 실제 소액 결제·환불은
   운영자 승인 후 별도로 확인한다. 이 문서는 운영 전환 또는 실거래 실행의 증거가 아니다.

관련 회귀: `src/payments/payments.service.spec.ts`,
`src/payments/polar-payment.provider.spec.ts`, `test/polar-environment.e2e-spec.ts`.

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
- Proxy IP: 기본은 forwarded header를 신뢰하지 않는다. 배포 환경이 명시한
  `TRUST_PROXY_HOPS`만큼만 신뢰하고, 그 결과인 `request.ip`를 Polar checkout의
  `customer_ip_address`로 전달한다. (사실)
- Backups: **미정** — 문서화된 백업 절차 없음. (미해결)
- Monitoring: **미정** — 문서화된 모니터링 없음. (미해결)
