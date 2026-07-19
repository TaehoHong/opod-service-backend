# DB 관리

Status: 운영 중 (마이그레이션 체계 도입 2026-07-19)

이 문서는 opod DB의 스키마 변경·적용 절차와, 차후 pgvector 확장 설계를
기록한다. 스키마 소유권은 이 리포(opod-service-backend)에 있고 opod-admin은
부분 미러다 (opod-admin/docs/media-generation-pipeline.md "스키마 소유권").

## 데이터 도메인과 관리 원칙

| 도메인 | 성격 | 원칙 |
|---|---|---|
| 캐릭터 설정 (personas, memories, visual profile) | 정본 | 운영자가 admin UI로 수정. 벡터화의 원천 |
| 레퍼런스 캡션, (차후) 임베딩 | 파생 | 정본에서 언제든 재생성 가능해야 한다 — 백필 멱등, 유실은 사고가 아니다 |
| drafts, generation jobs, action logs | 런타임 산출물 | append 중심 추적 데이터. 보존 정책으로 정리 |
| admin_settings | 설정 | DB 값이 env보다 우선 |

핵심 원칙: **임베딩을 포함한 파생 데이터는 절대 정본이 아니다.** 재생성
가능성이 보장되면 모델 교체·장애·마이그레이션이 전부 "백필 재실행"으로
수렴한다.

## 스키마 변경 절차 — Prisma Migrate (2026-07-19 결정)

`prisma db push` 수동 적용은 배포 DB drift 사고를 냈다 (2026-07-16,
`character_visual_profile_references.description` 컬럼 누락 500). 변경 이력이
없고 적용이 사람 기억에 의존하기 때문이다. 이후 절차:

1. **스키마 수정은 이 리포에서**: `prisma/schema.prisma` 수정 →
   `npm run db:migrate` (prisma migrate dev) → `prisma/migrations/`에 SQL
   생성·로컬 적용 → 마이그레이션 파일을 git에 커밋.
2. **admin 미러 갱신**: opod-admin의 schema.prisma를 동일하게 맞추고
   `node scripts/check-schema-sync.mjs`로 drift 검사. admin은 마이그레이션을
   갖지 않는다 (적용 주체가 아님).
3. **배포 적용은 자동**: backend 컨테이너가 시작 전에
   `prisma migrate deploy`를 실행한다 (docker/Dockerfile CMD). 미적용
   마이그레이션만 순서대로 적용된다.
4. **배포 순서**: 스키마 변경이 포함된 릴리스는 **backend 먼저** 배포(=
   마이그레이션 적용) 후 admin을 배포한다. admin은 스키마를 적용하지 않고
   전제한다.
5. `db:push`는 로컬 개발 편의 전용으로 강등. 운영 DB에 직접 실행하지 않는다.

### 기존 DB baseline (최초 1회)

마이그레이션 도입 전부터 존재하던 DB(운영·로컬)는 `0_init`을 "이미 적용됨"
으로 표시해야 한다:

```bash
# 1. drift 확인 — 출력이 비어 있어야 한다. 차이가 있으면 먼저 정합화한다.
DATABASE_URL=<url> npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma

# 2. (drift가 있을 때만) 정합화 — 변경 내용 검토 후:
DATABASE_URL=<url> npx prisma db push

# 3. baseline
DATABASE_URL=<url> npx prisma migrate resolve --applied 0_init

# 4. 검증 — "No pending migrations to apply" 가 나와야 한다.
DATABASE_URL=<url> npx prisma migrate deploy
```

로컬 DB는 2026-07-19에 baseline 완료. 이때 두 번째 drift 사례가 확인됐다:
`user_withdrawals.email_hash` 컬럼·인덱스가 스키마에선 제거됐는데(커밋
b73a336) DB에는 남아 있었다 — db push로 정합화했다. **운영 DB에도 같은
잔존이 있을 가능성이 높으니** 1단계 drift 확인에서 email_hash 제거가 나오면
예상된 차이다.

**운영 DB는 다음 backend 배포 전에 위 절차를 1회 실행해야 한다** — 하지
않으면 컨테이너 시작 시 migrate deploy가 0_init을 새로 적용하려다 기존
테이블과 충돌한다.

## pgvector 확장 설계 (차후 — 트리거 도달 시)

컨텍스트 선별은 현재 LLM 선별이다 (opod-admin
docs/media-generation-pipeline.md "컨텍스트 선별"). 아래 트리거 중 하나라도
관측되면 "임베딩 1차 축소 → LLM 최종 선별" 하이브리드로 전환한다:

1. 캐릭터당 활성 메모리 > 100개
2. 캐릭터당 레퍼런스 > 30장
3. 기획 호출 입력이 상시 10K 토큰 초과

관측 지점: post_drafts.concept_json의 planInput 스냅샷, draft 워커 로그.

### 왜 외부 벡터 DB가 아니라 pgvector인가

- 선별 쿼리 범위가 "캐릭터 1명의 수십~수백 행"이라 검색 규모가 작다.
- 정본과 같은 트랜잭션 — cascade 삭제·정합성이 공짜.
- 인프라 추가 없음. RDS가 pgvector를 지원한다.
- 외부 벡터 스토어는 수백만 행 규모에서만 재검토한다.

### 스키마 (전환 시 마이그레이션 1건)

```prisma
datasource db {
  extensions = [vector]   // generator previewFeatures: postgresqlExtensions
}

model CharacterMemory {
  embedding  Unsupported("vector(1536)")?
  embeddedAt DateTime?    // 어느 시점의 content 기준인지
}
model CharacterVisualProfileReference {
  embedding  Unsupported("vector(1536)")?
  embeddedAt DateTime?
}
```

- 별도 임베딩 테이블(polymorphic)이 아니라 **정본 테이블의 컬럼**: 조인
  불필요, cascade 공짜. 다중 임베딩 모델 버전 관리는 이 규모에서
  오버엔지니어링이다.
- 임베딩 모델은 admin_settings `embedding.*` 네임스페이스(apiUrl/apiKey/model,
  generation-settings 패턴 복제)로 전역 고정. 모델 교체 = 전체 백필.

### 쓰기 경로

- 메모리 생성/수정, 캡셔닝 완료 시점에 동기 임베딩. **실패해도 저장은 막지
  않는다** (embedding null → 백필 대상).
- 정본 텍스트 갱신 시 embedding을 null로 리셋하거나 즉시 재임베딩.
- admin UI "임베딩 백필" 버튼: `embedding IS NULL OR embedded_at < updated_at`
  행만 처리 (캡션 생성 버튼과 같은 멱등 패턴).

### 읽기 경로 (하이브리드 선별)

```sql
SELECT id FROM opod.character_memories
WHERE character_id = $1 AND deleted_at IS NULL AND embedding IS NOT NULL
ORDER BY embedding <=> $2 LIMIT 20
```

이 top-20 + 임베딩 없는 행 최신순 소수(폴백)를 기획 LLM에 전달하고, **최종
선별은 지금처럼 LLM이 한다.** 파이프라인 계약은 바뀌지 않고 입력 크기만
줄어든다.

### 인덱스 정책

도입 시점엔 인덱스를 만들지 않는다 — 캐릭터당 수백 행은 seq scan이 더
빠르다. 전체 행이 수만을 넘으면 HNSW 인덱스를 별도 마이그레이션으로 추가:

```sql
CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);
```
