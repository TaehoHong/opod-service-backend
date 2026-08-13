# Polar SDK 안정판 적용 계획

## 상태

- 요청: Polar TypeScript SDK 안정판 사용 및 후속 작업 우선순위 정리
- 결정: `@polar-sh/sdk@0.49.0` exact pin
- 구현 승인: 2026-08-13 사용자 지시로 확인
- blocking decision: 0개

## 목표

Backend의 Polar SDK를 현재 npm 안정 배포판인 `0.49.0`에 정확히 고정한다.
public preview인 versioned SDK 전환은 제외하고, 기존 `Polar` client 기반 adapter를
유지한다. 후속 Polar 작업은 결제 데이터 정확성과 실제 Sandbox 호환성을 먼저
확보하는 순서로 진행한다.

## 근거와 결정

- npm `latest` tag가 가리키는 안정 배포판은 `0.49.0`이다.
  (`externally-evidenced`)
- Polar 공식 문서의 versioned SDK는 public preview 배포판을 사용하므로 이번
  안정판 적용 범위에 포함하지 않는다. (`externally-evidenced`, `user-confirmed`)
- 현재 `PolarPaymentProvider`는 안정판의 `Polar` client와 camelCase API,
  `page.result.items` 응답 구조를 사용한다. (`repo-evidenced`)
- 실제 설치 버전도 이미 `0.49.0`이므로 adapter 코드 변경 없이 package range만
  exact version으로 고정하는 것이 가장 작은 호환성 변경이다. (`repo-evidenced`)

## 변경 범위

1. `package.json`, `package-lock.json`
   - `@polar-sh/sdk`를 `0.49.0`에 정확히 고정한다.
2. 루트 `docs/polar-payment-architecture.md`
   - 안정판 선택과 versioned preview 미채택을 명시한다.
   - 후속 Polar 작업을 결제 정확성 우선으로 정렬한다.

`PolarPaymentProvider`의 호출 계약은 현재 안정판과 일치하므로 변경하지 않는다.
모듈 owner나 canonical test 위치도 바뀌지 않아 `docs/07-codebase-guide.md`는
수정하지 않는다.

## Test Value Gate

exact dependency pin 자체만 검증하는 새 unit test는 추가하지 않는다. lockfile과
`npm ls`가 설치 버전을 직접 검증하고, 기존 전체 lint·test·E2E·build가 안정판에서
compile/runtime 회귀를 확인한다. Polar 원격 계약은 credential이 필요한 Sandbox
E2E에서 검증해야 하므로 별도 P0 후속 작업으로 둔다.

## 작업 우선순위

| 순서 | 우선순위 | 상태 | 작업                                          | 선행 이유                                          |
| ---: | -------- | ---- | --------------------------------------------- | -------------------------------------------------- |
|    1 | P0       | 완료 | SDK 안정판 `0.49.0` exact pin                 | 이후 작업의 재현 가능한 SDK 기준 확보              |
|    2 | P0       | 대기 | 금액·세금·통화 검증 기준 확정                 | 정상 결제 미지급 또는 다른 통화 오지급 방지        |
|    3 | P0       | 대기 | 부분 환불의 비례 크레딧 회수                  | 부분 환불에 전체 크레딧을 회수하는 오류 방지       |
|    4 | P0       | 대기 | Polar Sandbox E2E                             | checkout→webhook→지급→환불의 실제 외부 호환성 확인 |
|    5 | P1       | 대기 | Web checkout 진입과 복귀 화면 연결            | 결제 정확성 검증 후 사용자에게 노출                |
|    6 | P1       | 대기 | 복귀 URL allowlist와 고객 IP 전달             | redirect 및 세금·통화 감지 보강                    |
|    7 | P1       | 대기 | webhook 실패 alert와 수동 재처리              | 2xx acknowledge된 domain 실패 복구                 |
|    8 | P2       | 대기 | webhook 처리 시간 계측 및 필요 시 worker 분리 | Polar 2초 권장 응답 안정성 확보                    |
|    9 | P2       | 대기 | checkout 만료·장기 pending 정리               | 운영 데이터와 사용자 상태 정리                     |
|   10 | P2       | 대기 | OpenAPI header·response·error 보강            | client 생성 및 운영 가시성 개선                    |

## 검증 결과

- `npm install`: 성공
- `npm run format`: 변경 범위 밖의 기존 파일 1개로 실패
- `npm run lint`: 성공
- `npm run test`: 151개 성공
- `npm run test:e2e`: 69개 성공
- `npm run build`: 성공
- package, lockfile, 설치본의 `@polar-sh/sdk@0.49.0` 일치 확인
- Polar-only 범위, Markdown fence, 로컬 링크, 공식 문서 링크 확인

실제 Polar credential이 없어 원격 Sandbox 호출은 이번 변경 검증에 포함하지 않는다.
