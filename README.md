# opod-service-backend

Public service backend for OPOD.

## Structure

- `src/service`: user-facing HTTP controllers and modules
- `src/domain`: service domain logic and database access
- `prisma`: canonical PostgreSQL schema
- `test`: service-only tests
- `docker`: local PostgreSQL/service container config

## Local

```bash
npm install
npm run db:generate
npm run db:up
npm run db:push
npm run start:dev
```

Admin API and admin UI live in `../opod-admin`.

## Production

```bash
PORT=7000 DATABASE_URL='postgresql://postgres:change-me@localhost:5432/postgres?schema=opod' npm run start:prod
```
