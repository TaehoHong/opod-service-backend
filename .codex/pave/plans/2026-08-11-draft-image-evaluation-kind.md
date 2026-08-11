# Draft 생성 이미지 평가 kind

- 날짜: 2026-08-11
- 승인 범위: admin의 생성 이미지 비전 평가 결과를 저장하기 위한 canonical
  `DraftEvaluationKind.image` 추가.

## 변경

- `prisma/schema.prisma` enum에 `image` 추가.
- Prisma가 생성하는 migration으로 PostgreSQL enum을 확장.
- Prisma client 생성과 build/test로 계약 검증.

## 비범위

- public service API 변경 없음.
- 평가 실행·UI·자동 재생성은 `opod-admin` 소유.

