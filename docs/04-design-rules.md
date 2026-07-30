# 04. 디자인 규칙

> 분류 범례는 [00-overview.md](./00-overview.md) 참조.

## UI/UX

**(해당없음)** — 이 리포는 유저용 HTTP API + 정본 스키마만 제공한다. 화면·
UI·UX·접근성은 opod-web(프론트엔드) 소관이다. (결정)

여기서는 UI 규칙 대신 **API 계약·응답 형태 규칙**을 둔다.

## API 설계 규칙 (사실 — 현재 코드 컨벤션)

- 프로토콜: REST/HTTP, JSON. Swagger UI는 `/docs`, `RequestValidationPipe`는
  `whitelist: true, transform: true`. (`src/service/service.module.ts`,
  `src/service/swagger.ts`)
- 페이지네이션: 커서 방식. 공통 헬퍼 `parsePageQuery`/`decodeCursor`/
  `pageFromRows` (`src/domain/database/page.ts`). 기본 limit 20, 최대 50.
  응답은 `{ items, nextCursor? }`.
- 인증: `Authorization: Bearer <accessToken>`. 컨트롤러가
  `AuthService.userIdFromAuthorization`으로 userId 추출. 공개 조회는 인증 없이,
  선택 인증은 `optionalUserIdFromAuthorization`. (사실)
- 공개 범위: 탐색(캐릭터·게시글·스토리·검색·FAQ·공지·약관)은 비로그인 공개,
  개인 데이터·쓰기는 로그인 필요. (결정)
- 오류 규약:
  - 존재하지 않거나 소유하지 않은 리소스는 **404로 정규화**(존재 노출 방지).
    uuid 형식이 아닌 id도 질의 전에 404로 정규화(`isUuid`, `src/domain/
    database/uuid.ts`).
  - 검증 실패는 400, 인증 실패는 401, 상태 충돌은 409, 레이트 초과는 429.
  - 현재 비밀번호 불일치는 401이 아닌 **400**(재로그인 vs 재입력 구분,
    account-support-policy §1).
- Swagger 예시·태그는 `src/service/swagger.ts`에서 operationId 기준으로 주입.
- 응답 필드: 선택 필드는 값이 있을 때만 포함(예: `profileImageUrl`), 날짜는
  ISO 문자열. (사실 — 각 service의 `to*` 매퍼)

## Product Tone

- 캐릭터의 "관계가 깊어지는" 경험이 핵심. 점수(호감도)는 유저에게 직접 노출하지
  않고 캐릭터의 반응 변화로 전달한다. (결정, 근거: `affinity-policy.md` 노출 정책)
- 문구·마이크로카피는 opod-web 소관. (해당없음)
