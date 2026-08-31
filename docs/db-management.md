# DB 관리

Status: 운영 중 (Drizzle v1 전환 2026-08-31)

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

## 스키마 변경 절차 — Drizzle migration (2026-08-31 결정)

공유 DB에 `db:push`로 직접 변경하면 적용 이력이 남지 않아 코드와 DB가 어긋난다.
정본과 적용 책임은 다음처럼 고정한다.

1. **backend schema 수정**: `src/domain/database/schema.ts`가 유일한 정본이다.
2. **SQL 생성·검토**: `npm run db:generate`로 `drizzle/<timestamp>_<name>/`을
   만들고 `migration.sql`과 `snapshot.json`을 함께 검토·커밋한다. 데이터 백필이나
   seed가 필요하면 같은 migration SQL에 명시한다.
3. **로컬 적용·검증**: `npm run db:migrate`로 로컬 DB에 적용하고 unit/E2E/build를
   통과시킨다. E2E는 매번 빈 PostgreSQL 16에 migration 전체를 적용한다.
4. **admin 미러 갱신**: opod-admin의 `src/domain/database/schema.ts`를 동일하게
   맞추고 admin에서 `npm run schema:check`를 실행한다. admin은 migration을
   생성하거나 적용하지 않는다.
5. **배포 적용**: backend 컨테이너가 시작 전에 `npm run db:migrate:deploy`를
   실행한다. production image에는 `drizzle-kit`이 없으므로 이 명령은
   `drizzle-orm`과 `pg` 기반 실행기를 사용한다.
6. **배포 순서**: 스키마 변경 릴리스는 backend를 먼저 배포해 migration을 적용한
   뒤 admin을 배포한다.

`db:push`는 **로컬 DB 전용**이다. Drizzle `1.0.0-rc.4`의 PostgreSQL introspection은
기존 `character_status` enum을 다른 이름으로 오인하는 사례가 확인됐으므로 공유
개발 DB나 운영 DB에는 사용하지 않는다. DB 용어는
[02-development-rules.md](./02-development-rules.md)가 정본이다.

### Prisma에서 전환하는 기존 DB baseline (최초 1회)

`20260831062118_baseline`은 빈 DB용 전체 DDL이다. 이미 31개 레거시 migration이
적용된 DB에 이 SQL을 다시 실행하면 안 된다. 첫 Drizzle 배포 전에 다음 명령으로
baseline만 적용 완료로 등록한다.

```bash
# DATABASE_URL 대상과 백업을 확인한 뒤 1회 실행
DATABASE_URL=<url> npm run db:baseline

# 등록 직후 pending migration 확인·적용. 현재 baseline만 있으면 no-op
DATABASE_URL=<url> npm run db:migrate:deploy
```

서버의 compose 환경에서는 새 backend image를 받은 뒤 API를 재시작하기 전에
다음처럼 실행한다.

```bash
docker compose run --rm --no-deps api npm run db:baseline
docker compose up -d --no-build api
```

`db:baseline`은 application DDL을 실행하지 않는다. 다음 조건을 모두 만족할 때만
`drizzle.__drizzle_migrations`에 승인된 baseline 이름·SHA-256을 기록한다.

- Drizzle migration 기록이 아직 없음
- 남아 있는 `_prisma_migrations`에 미완료 행이 없음
- `opod`의 table·column type/nullability·enum·index·PK/FK/check가 baseline
  snapshot과 일치
- baseline의 크레딧 상품 4개와 local development 결제 mapping 4개가 존재

하나라도 다르면 등록을 중단한다. 이 경우 `db:push`로 맞추지 말고 차이를 별도
검토해 명시적인 정합화 migration을 만든다. **이 작업에서는 로컬/개발/운영 DB에
baseline을 실행하지 않았으므로 각 기존 환경은 최초 Drizzle 배포 전에 따로
등록해야 한다.**

기존 `opod._prisma_migrations`는 삭제하지 않고 과거 적용 이력으로 읽기 전용
보존한다. 전환 뒤 현재 상태의 정본은 다음 쿼리다.

```sql
SELECT name, hash, applied_at
FROM drizzle.__drizzle_migrations
ORDER BY id;
```

### 배포 전 점검과 롤백

기본값 없는 `NOT NULL` 컬럼을 기존 행이 있는 테이블에 바로 추가하면 실패한다.
생성 SQL을 검토하고, 기존 데이터가 있으면 nullable 추가 → 백필 → NOT NULL 전환을
같은 migration이나 순차 migration으로 명시한다. destructive DDL, long lock,
대량 백필은 행 수와 실행 계획을 별도로 검토한다.

Drizzle 실행기는 pending migration과 metadata 기록을 transaction으로 묶는다.
실패한 migration은 수정해 덮어쓰지 말고 원인을 제거한 새 migration으로 전진한다.
배포 후 코드 롤백이 필요해도 이미 적용된 schema와 호환되는 버전만 되돌린다.
데이터 손실 가능성이 있는 schema rollback은 자동화하지 않으며, 새 forward
migration 또는 검증된 백업 복구로 처리한다.

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

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE opod.character_memories
  ADD COLUMN embedding vector(1536),
  ADD COLUMN embedded_at timestamptz(6);
ALTER TABLE opod.character_visual_profile_references
  ADD COLUMN embedding vector(1536),
  ADD COLUMN embedded_at timestamptz(6);
```

실제 도입 시 이 SQL과 같은 변경을 Drizzle 정본 schema에도 선언하고 migration으로
생성·검토한다.

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
