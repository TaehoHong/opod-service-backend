# Polar Sandbox credential 분리와 배포

## 목표

Sandbox API credential을 production credential과 분리하고, 결제 변경 전체를 각
저장소 `main`에 병합한 뒤 개발 서버와 Web 배포 경로에 반영한다.

## 결정 원장

| ID     | 결정                                                          | 근거                               |
| ------ | ------------------------------------------------------------- | ---------------------------------- |
| PSD-01 | `POLAR_SERVER=sandbox`이면 `POLAR_SANDBOX_API_KEY`만 사용한다 | user-confirmed / security boundary |
| PSD-02 | production은 기존 `POLAR_ACCESS_TOKEN`을 유지한다             | repo-evidenced / compatibility     |
| PSD-03 | credential 선택 owner는 `PolarPaymentProvider.client()`다     | owner-found                        |
| PSD-04 | Backend 배포 대상은 `deploy.sh`가 소유한 개발 서버다          | repo-evidenced                     |

## 검증

- Sandbox SDK client가 Sandbox key와 server를 함께 받는 단위 테스트: 5/5 통과
- Backend format, lint, unit 191개, E2E 93개, build: 모두 통과
- 결제 E2E 28개 및 inquiry 동시 제한 회귀 테스트 단독 실행: 모두 통과
- Web lint(오류 0, 기존 경고 2), Relay compile, 결제 API test, production build: 모두 통과
- 최초 전체 E2E에서 inquiry 테스트 1개가 `ECONNRESET`으로 실패했으나 단독 재실행과
  전체 순차 재실행에서 통과했다. E2E 프로세스 병렬 실행은 같은 테스트 DB 수명주기를
  공유해 충돌하므로 사용하지 않는다.
- 각 저장소 local/remote `main` SHA 일치
- Backend 배포 헬스체크 및 Web 배포 상태 확인
