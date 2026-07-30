# PAVE Runtime

이 프로젝트는 PAVE를 사용합니다. PAVE는 **Plan, Approve, Verify, Execute**의 약자입니다.

PAVE는 AI에게 기능 구현, 버그 수정, 분석, 리뷰를 맡길 때 계획, 승인, 구현, 검증, 보고가 한 흐름으로 진행되도록 돕습니다.

English documentation: [README.md](README.md)

## 가장 쉬운 사용법

Codex에서는 `$pave:pave`로 요청합니다.

```text
$pave:pave 이 기능 구현해줘
$pave:pave 이 버그 원인 찾고 고쳐줘
$pave:pave 현재 변경사항 리뷰해줘
$pave:pave 이전 작업 이어서 진행해줘
```

Claude Code에서는 `/pave`로 요청합니다.

```text
/pave 이 기능 구현해줘
/pave 이 버그 원인 찾고 고쳐줘
/pave 현재 변경사항 리뷰해줘
/pave 이전 작업 이어서 진행해줘
```

계획과 보고서는 Codex와 Claude Code 모두 `.codex/pave/`를 공유합니다.

## 작업 흐름

1. AI가 `AGENTS.md`, `CLAUDE.md`, `.codex/pave/config.md`를 읽습니다.
2. `docs/07-codebase-guide.md`를 먼저 읽고 요청 관련 evidence path의
   신선도를 확인한 뒤, 대상 코드·직접 의존 코드·관련 테스트·canonical
   example만 조사합니다. 소유권이 없거나 오래됐거나 충돌할 때만 범위를
   넓힙니다.
3. 사용자가 구현을 직접 요청했고, 직접 수정 파일 2개 이하와 실질 변경
   20줄 이하를 모두 만족하며, 저위험이고 좁은 검증이 가능할 때만 fast
   path를 사용합니다.
4. 그 외에는 기획, 정책, 디자인, 배포, 검증 기준에서 애매한 점을 먼저 질문합니다.
5. 필요한 경우 `.codex/pave/plans/`에 계획서를 만듭니다.
6. 코드나 테스트를 수정하기 직전에 한 번만 종합 승인 요청을 합니다.
   설계 선택이나 질문에 대한 답변은 구현 승인이 아닙니다.
7. Test Value Gate로 의례적, 중복, 구현 세부사항, coverage-only 테스트를
   제외합니다.
8. 가치 있는 테스트 또는 가장 강한 비테스트 검증으로 구현을 확인합니다.
9. 리뷰와 검증을 진행합니다.
10. 필요한 경우 역할별 subagent를 사용합니다.
11. 검증 결과와 잔여 위험을 보고합니다.
12. 필요하면 `.codex/pave/reports/`에 final 또는 blocked 보고서를 남깁니다.

## Codex와 Claude Code 차이

| 항목 | Codex | Claude Code |
| --- | --- | --- |
| 호출 | `$pave:pave ...` | `/pave ...` |
| 먼저 보는 파일 | `AGENTS.md` | `CLAUDE.md`, 그 다음 `AGENTS.md` |
| runtime 위치 | `.codex/pave/` | `.codex/pave/` |
| 역할별 보조 에이전트 | PAVE skill references | `.claude/agents/` |

## 이 폴더 안의 파일

- `config.md`: 이 프로젝트에서 PAVE가 따를 규칙입니다.
- `../../docs/07-codebase-guide.md`: 모듈, 공통 코드, 관례, 검증 위치를
  재사용하는 영속 탐색 인덱스입니다.
- `plans/`: 구현 전 계획서가 저장됩니다.
- `reports/`: 완료 또는 blocked 보고서가 저장됩니다.
- `templates/`: 계획서와 보고서 양식입니다.
- `adapters/`: Codex, Claude Code, generic agent별 사용 안내입니다.

## 설치 상태 확인

Codex에서 이렇게 요청하세요.

```text
$pave:pave 이 repo의 PAVE 설치 상태 확인해줘
```

터미널 fallback은 PAVE 소스 repo에서 실행합니다.

```bash
./scripts/doctor.js <repo-path>
```
