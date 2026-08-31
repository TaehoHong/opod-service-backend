# opod-service-backend

Public service backend for OPOD.

## Structure

- `src/service`: user-facing HTTP controllers and modules
- `src/domain`: service domain logic and database access
- `src/domain/database/schema.ts`: canonical Drizzle PostgreSQL schema
- `drizzle`: reviewed SQL migrations and snapshots
- `test`: service-only tests
- `docker`: local PostgreSQL/service container config

## Local

```bash
npm install
npm run db:up
npm run db:migrate
npm run start:dev
```

기존 Prisma-era DB를 재사용할 때는 migration DDL을 재실행하지 말고
[`docs/db-management.md`](./docs/db-management.md)의 1회 baseline 절차를 따른다.

Admin API and admin UI live in `../opod-admin`.

## Production

The server owns `docker-compose.yml` and `.env`. Do not keep production
compose files in this repo or overwrite them during deploy.

```bash
./deploy.sh
```

This sends the local build context to the VPS Docker daemon over SSH, builds the
Linux/amd64 image natively on the VPS, and restarts only the `api` service. Keep
ports, database URL, volumes, nginx, certificates, and PostgreSQL exposure in
the server-local `~/opod-backend/docker-compose.yml` and `.env`.
