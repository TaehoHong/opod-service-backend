# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS build
WORKDIR /app

COPY nest-cli.json prisma.config.ts tsconfig.build.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=opod
RUN npm run db:generate
RUN npm run build
RUN npm prune --omit=dev

FROM build AS runtime
ENV NODE_ENV=production
ENV PORT=7000
EXPOSE 7000

# 시작 전 미적용 마이그레이션을 순서대로 적용한다 — 코드와 DB 스키마가
# 어긋난 채 뜨는 사고(예: 컬럼 누락 500)를 구조적으로 막는다.
# 기존 DB 최초 1회는 baseline 필요: docs/db-management.md 참고.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]
