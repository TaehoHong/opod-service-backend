# Polar checkout 고객 IP 전달

## 목표

Polar의 국가·통화 감지와 세금 계산에 사용할 고객 IP를 브라우저 입력이 아니라
Backend의 신뢰 경계에서 판정해 checkout 생성 요청에 전달한다.

## 결정 원장

| ID     | 결정                                                          | 근거              |
| ------ | ------------------------------------------------------------- | ----------------- |
| PCI-01 | Web 요청 body/header로 고객 IP를 직접 받지 않는다             | security boundary |
| PCI-02 | Express `request.ip`를 정규화해 Polar에 전달한다              | repo/API evidence |
| PCI-03 | forwarded header는 `TRUST_PROXY_HOPS`가 명시한 hop만 신뢰한다 | security boundary |
| PCI-04 | 기본 hop 수는 0이고 잘못된 설정은 시작 단계에서 거부한다      | fail-safe default |

## 수용 조건

- 기본 설정에서 위조된 `X-Forwarded-For`가 Polar 입력으로 사용되지 않는다.
- 신뢰 proxy 1 hop 설정에서는 전달된 실제 고객 IPv4가 사용된다.
- IPv4-mapped IPv6는 표준 IPv4로 정규화한다.
- Polar checkout 요청에 `customerIpAddress`가 포함된다.
- Web API body 계약은 바뀌지 않는다.

## 검증

- Polar provider unit test
- 결제 집중 E2E의 trust proxy 회귀 test
- Backend format, lint, unit, 결제 집중 E2E, build

## 결과

- `CheckoutRequest`부터 Polar SDK의 `customerIpAddress`까지 기존 checkout 경계를
  확장했다.
- Controller가 판정한 `request.ip`만 사용하며 body의 같은 이름 필드는 신뢰하지
  않는다.
- `TRUST_PROXY_HOPS` 기본값은 `0`이고 양의 정수일 때만 Express trust proxy를
  활성화한다.
- 실제 배포의 proxy hop 수는 운영자가 토폴로지에 맞춰 설정해야 한다.

## 실행 증거

- Polar provider unit: 4/4 성공
- Backend unit: 155/155 성공
- 결제 집중 E2E: 26/26 성공
- 고객 IP 보안 회귀 E2E 최신 재실행: 1/1 성공
- 변경 범위 Prettier, 전체 lint, production build, `git diff --check` 성공
- 실제 Polar Sandbox 거래는 사용자 검증 범위로 남김
