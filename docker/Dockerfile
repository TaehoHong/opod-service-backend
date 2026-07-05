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

CMD ["npm", "run", "start:prod"]
