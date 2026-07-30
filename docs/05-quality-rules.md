# 05. 품질 규칙

> 분류 범례는 [00-overview.md](./00-overview.md) 참조.

## Completion Bar

작업은 선언된 검증(아래)이 통과하거나, 통과할 수 없는 이유를 blocked 리포트로
설명할 때만 완료로 본다. 신선한 검증 근거 없이 완료를 주장하지 않는다.

## Test Strategy

기준은 `AGENTS.md`의 Testing Guidance와 동일하다.

- 테스트는 관측 가능한 동작, 외부 계약, 입증된 회귀, 고위험 경계를 보호하고
  현실적 결함을 잡을 수 있을 때만 추가한다.
- 무의미한 테스트(커버리지만·mock 호출 검증·구현 세부·프레임워크 동작·근거
  없는 스냅샷·기존 보장 중복)는 배제한다.
- 새 자동 테스트의 회귀 가치가 낮으면, 가장 강한 비례 검증을 쓰고 잔여 위험을
  기록한다.

배치 (사실 — 현재 리포):

- Unit: `*.spec.ts` (jest, `npm run test`). 도메인 서비스 중심
  (예: `credits.service.spec.ts`, `auth.service.spec.ts`, 컨트롤러 spec).
- Integration/E2E: `test/*.e2e-spec.ts` (`npm run test:e2e`). Testcontainers로
  실제 Postgres를 띄우고 `prisma db push` 후 supertest로 HTTP를 구동
  (`test/e2e-global-setup.ts`, `test/e2e-env.ts`). **Docker 필요.**
- 결제·환불 커버리지: `src/domain/credits/payment-refund-coverage.spec.ts`,
  시나리오 문서 `docs/payment-refund-test-usecases.md`.
- 아키텍처 규칙 테스트: `src/architecture.spec.ts` (계층·경계·UUIDv7 강제).
- Manual QA: **미정** — 문서화된 수동 QA 절차 없음. (미해결)

## Regression Risk (위험 영역)

- **크레딧/결제/환불**: 예약→확정/해제, 부분환불, 음수 잔액, 동일인 미정산,
  프로모션 회수. 원장 불변·멱등·사용자 단위 직렬화가 깨지면 금전 사고.
  (`credit-policy.md`, `credits.service.ts`, advisory lock)
- **인증/세션**: 비번 변경·탈퇴 시 토큰 폐기, 세션 advisory lock, 동시성
  (`auth.service.ts`). 탈퇴 익명화 범위(삭제 vs 보존).
- **탈퇴 데이터 처리**: 삭제/보존 매트릭스. **정책↔코드 drift 존재**(이메일
  보관·재가입 차단은 결정됐으나 코드는 아직 `email=null`) — 01-roadmap Drift 표.
- **공개/권한 경계**: 소유 아닌 리소스 404 정규화, 비활성 캐릭터 필터
  (`character.status = active`).
- **동시성**: DM 예약, refund reserve, 성인인증 동일인 연결 — 사용자/식별키
  단위 advisory lock에 의존.
