# 캐릭터 참조 링크 — 2026-10-19

## 승인 및 현재 결정
- user-confirmed: 캐릭터마다 별도 테이블에 여러 참조 URL을 관리하고 새 탭에서 연다.
- user-confirmed: link id는 BIGINT IDENTITY. character_id는 기존 characters UUID FK를 유지한다.
- user-confirmed: URL CHECK는 만들지 않는다. HTTP(S) 검증·정규화는 소유 Service가 맡는다.
- user-confirmed: 구현·개발 DB migration·배포·해나/유하 링크 등록. 나머지 네 명은 SNS 후보 조사.
- 기존 uuid 링크 PK 제안과 URL CHECK 제안은 위 사용자 결정으로 superseded.
- 막힌 제품 결정: 0. 사용자 요청에 따라 개별 파일 전송 대신 기능별 커밋·push·해당 커밋 배포를 사용한다.

## Existing Owner Check
- owner-absent: 별도 링크 저장/API. schema와 character API 검색에서 기존 소유자 없음.
- owner-found: CharacterService.requireActivityCharacter로 존재 확인. 새 Repository가 characters를 직접 읽지 않는다.
- owner-found: aiConfigId의 BIGINT 검증을 shared/utils/bigint-id.ts로 추출하여 기존 오류 계약 유지.
- owner-found: UI URL 표시/검증은 shared/media/previewUrl.ts, 요청은 apiRequest.
- owner-absent: backend 참조 주소 정규화 정책은 CharacterReferenceLinkService가 소유. URL 및 DTO/저장 경로 검색 근거.

## 구현과 검증
- [x] backend 정본 schema와 drizzle/20261019002237_character_reference_links 생성; admin mirror 일치.
- [x] 전용 Repository→Service→Controller와 관리자/CSRF 경계; BIGINT는 문자열로 직렬화.
- [x] Mantine 프로필 패널에서 추가·수정·삭제·새 탭 열기, 로딩·빈 목록·오류·입력 보존.
- [x] UI 111개, admin unit 713개, backend unit 149개, 양쪽 build/lint/format 및 schema:check 통과.
- [x] 참조 링크 release의 admin HTTP/DB E2E 110개, backend E2E 127개 통과. 전체 로컬 통합 후 다시 검증한다.
- [ ] 서버 내부 백업·복구 태그·명시적 release commit으로 additive migration 후 admin 배포.
- [ ] 해나/유하 URL을 소유 Service로 등록하고 API·브라우저 재조회.
- [ ] 남은 네 캐릭터의 현재 컨셉에 맞는 SNS 후보와 확인 제한을 보고.

## 화면 기준
repo-evidenced: docs/04-design-rules.md, CharacterProfilePanel.tsx:45의 Mantine Paper/Stack/Group 폼, MutationAlert/OperationErrorAlert. 신규 토큰·디자인 변형 없음.

## 테스트 가치와 범위
HTTP 테스트는 영속화·중복·타 캐릭터 ID 격리·인증·CSRF·위험 URL·BIGINT 정밀도를 보호한다. 실제 PostgreSQL을 사용한다. UI 테스트는 네 가지 사용자 조작과 저장 실패 후 입력 보존을 보호하며 HTTP만 MSW로 대체한다. migration 테스트는 identity·FK·캐릭터별 unique·cascade 및 기존 migration 이력 보존을 보호한다.

## 배포/복구
이번 기능 변경만 커밋·push하고 개발 서버에서 해당 커밋을 checkout하여 검증·build·배포한다. 기존 user 미커밋 변경은 보존한다. rollback은 이전 보존 image로 복구하고 새 테이블은 보존한다.

## 2026-10-19 전체 로컬 변경 배포 승인

사용자 요청: 로컬 변경 전체를 커밋·푸시·개발 배포하고 브랜치를 확인한다. 별도 원격 미병합 기능은 합치지 않는다.
admin 최신 main(이미지 계약/사진 검수), 로컬과 내용이 일치하는 기존 사진 기획 커밋의 이력을 통합했다. 로컬 AI 연결/모델 관리·페르소나 임베딩과 agent의 채팅 설정/메모리 수정, 기존 문서 정리를 포함한다.
로컬 통합 검증: admin lint/format/unit 713/UI 111/build/schema:check, backend lint/format/unit 149/build, agent npm run check 통과. 최종 Git commit의 서버 E2E 및 개발 서비스 전환은 진행 중이다.
