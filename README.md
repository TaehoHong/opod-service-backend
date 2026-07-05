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

The server owns `docker-compose.yml` and `.env`. Do not keep production
compose files in this repo or overwrite them during deploy.

```bash
rsync -a --delete --exclude-from=deploy/rsync-exclude.txt ./ taeho@121.141.156.200:~/opod-backend/
ssh taeho@121.141.156.200 'cd ~/opod-backend && docker compose build api && docker compose up -d api'
```

Keep ports, database URL, volumes, nginx, certificates, and PostgreSQL exposure
in the server-local `~/opod-backend/docker-compose.yml` and `.env`.
