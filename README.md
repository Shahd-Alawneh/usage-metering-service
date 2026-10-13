# Usage Metering Service

A TypeScript, Express, and PostgreSQL service for account-level and user-level usage quotas.

## Features

- API-key authentication for account-scoped operations.
- Account and user creation.
- Built-in Starter, Pro, Basic, and Premium plans seeded by SQL migrations.
- Custom account-owned plans and plan assignment endpoints.
- Monthly UTC usage accounting at account and user level.
- Per-request unit limits and monthly allowances.
- Atomic usage decisions with accepted/rejected request history.
- Idempotency using an account-scoped request ID.
- Paginated usage history with optional month and user filters.
- Browser-based client dashboard.
- Docker Compose setup for PostgreSQL and the API.

## Requirements

- Node.js 22+
- Docker Engine or Docker Desktop with Compose

## Configuration

Create `.env` in the project root:

```dotenv
PORT=3000
POSTGRES_DB=usage_metering
POSTGRES_USER=usage_app
POSTGRES_PASSWORD=replace_with_a_local_password
DATABASE_URL=postgresql://usage_app:replace_with_a_local_password@localhost:5433/usage_metering
```

Do not commit `.env` or real API keys.

## Database setup

Start PostgreSQL:

```bash
docker compose up -d db
```

Apply migrations in order against the local database. Each migration must be applied once and recorded in `schema_migrations`. If the database already contains the schema and migration records, do not reapply them.

For a new database, apply:

```bash
for file in migrations/*.sql; do
  docker compose exec -T db psql -v ON_ERROR_STOP=1 \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$file"
done
```

The migration loop above requires `POSTGRES_USER` and `POSTGRES_DB` to be exported in the shell. Alternatively, run each SQL file individually with the appropriate database credentials.

## Run locally

```bash
npm ci
npm run typecheck
npm test
npm run dev
```

Open `http://localhost:3000` for the client dashboard.

## Run with Docker Compose

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f api
```

Open `http://localhost:3000`. Stop the stack with `docker compose down`. Persistent database data remains in the named volume unless you explicitly remove it.

## API overview

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service health check |
| GET | `/db/health` | Database connectivity check |
| POST | `/accounts` | Create an account and issue an API key |
| POST | `/users` | Create a user under the authenticated account |
| GET | `/plans` | List built-in and account-owned plans |
| POST | `/plans` | Create a custom plan |
| PATCH | `/plans/account/current` | Change the account plan |
| PATCH | `/plans/users/:userId/current` | Change a user's plan |
| POST | `/usage` | Record an idempotent usage decision |
| GET | `/usage` | Paginated usage history |

Authenticated routes use the `x-api-key` header.

### Create an account

```bash
curl -X POST http://localhost:3000/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name":"Example Company"}'
```

Save the returned API key securely. It is not returned again by this endpoint.

### Create a user

```bash
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: YOUR_API_KEY' \
  -d '{"name":"Example User"}'
```

### Submit usage

```bash
curl -X POST http://localhost:3000/usage \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: YOUR_API_KEY' \
  -d '{"userId":"USER_UUID","requestId":"request-001","units":10}'
```

The same `requestId` and payload replay the original decision. Reusing it with a different user or unit count returns a conflict. Rejected requests are logged but do not consume units.

### Query usage history

```bash
curl 'http://localhost:3000/usage?page=1&limit=20&month=2026-10' \
  -H 'x-api-key: YOUR_API_KEY'
```

Optional filters are `userId` and `month` (`YYYY-MM`). The maximum page size is 100.

## Tests

Run:

```bash
npm run typecheck
npm test
```

Integration tests use the configured PostgreSQL database and create test accounts and users. They do not automatically delete the test records.

## Security notes

- Store API keys securely and never commit them.
- API keys are stored as SHA-256 hashes in the database.
- Use HTTPS, secret management, rate limiting, and key rotation in production.
- The supplied Compose setup is intended for local development and evaluation, not as a production deployment configuration.
