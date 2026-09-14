# Troubleshooting Index

> 고신호·근거 기반 장애 기록의 탐색 지점이다. 기록은 역사적 증거이며 현재 코드와
> 정본 프로젝트 문서가 최종 source of truth다.

## Records

| ID | Date | Status | Area | Symptom | Root cause | Record |
| --- | --- | --- | --- | --- | --- | --- |
| TS-20260831-01 | 2026-08-31 | resolved | DM reply context | 빠른 연속 발화 뒤 캐릭터가 직전 답변을 잊고 첫인사처럼 반응함 | 메시지 물리 시각 경계가 이전 비동기 답변을 누락했고 greeting이 모든 DM에 주입됨 | [DM reply history ordering](2026-08-31-dm-reply-history-ordering.md) |

## Usage

- 새 기록을 만들기 전에 이 색인을 검색한다.
- 같은 실패는 중복 기록 대신 기존 기록을 갱신한다.
- 오래된 결론은 `superseded-by`를 먼저 확인한다.
- 현재 코드와 회귀 가드를 새로 검증한다.
