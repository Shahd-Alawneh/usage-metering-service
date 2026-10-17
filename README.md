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


Copy the example environment file to create your local configuration:

```bash
cp .env.example .env
```

Update `POSTGRES_PASSWORD` and the matching password in `DATABASE_URL` before starting the application.

The `DATABASE_URL` in `.env` is used when running the API locally. Docker Compose automatically configures the database connection between containers.


```dotenv
PORT=3000
POSTGRES_DB=usage_metering
POSTGRES_USER=usage_app
POSTGRES_PASSWORD=replace_with_a_local_password
DATABASE_URL=postgresql://usage_app:replace_with_a_local_password@localhost:5433/usage_metering
```

Do not commit `.env` or real API keys.

## Database setup

Migrations run automatically when starting the API with `npm start` or Docker Compose.

The migration runner applies SQL files in order, records completed migrations in `schema_migrations`, and skips previously applied files.

For a fresh installation, run:

    docker compose up --build -d

No manual SQL migration commands are required.

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
| PATCH | `/plans/:planId` | Update an account-owned custom plan |
| PATCH | `/plans/account/current` | Change the account plan |
| PATCH | `/plans/users/:userId/current` | Change a user's plan |
| POST | `/usage` | Record an idempotent usage decision |
| GET | `/usage/summary` | View account and user quota summaries |
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

## Usage Summary

The service provides a usage summary endpoint:

```http
GET /usage/summary
x-api-key: YOUR_API_KEY
```

The summary reports consumed and remaining units for the account and its users, based on their assigned plans.

## Demo Scenario

An automated demo script demonstrates the main project requirements.

Run the API and PostgreSQL first, then execute:

```bash
node demo/run-demo.mjs
```

The demo creates a new account and two users with different plans. It demonstrates:

- Accepted usage requests.
- Rejection when a user's per-request limit is exceeded.
- Rejection when the account's monthly allowance is exceeded.
- Updating an account plan.
- Successfully submitting usage after the plan change.
- Checking remaining account and user allowances.

The verified local demo passed all seven checks.

At the end of that run:

| Resource | Consumed | Remaining |
|---|---:|---:|
| Account | 105 | 45 |
| User A | 15 | 15 |
| User B | 90 | 10 |

These values are from one example run. The script creates fresh records when executed again.

## Automated Testing

Run all automated tests:

```bash
npm test
```

The test suite covers authentication, account isolation, accepted and rejected usage, idempotency, pagination, plan changes, usage summaries, and concurrency.

The verified local test run completed successfully:

- Test files: 2 passed
- Tests: 11 passed
- Failed tests: 0

### Concurrency Test

The concurrency test submits 20 usage requests simultaneously against an account with a monthly allowance of 10 units.

Expected and verified results:

- 10 requests accepted.
- 10 requests rejected.
- Exactly 10 units consumed.
- Zero remaining account units.

This checks that concurrent requests cannot consume more than the configured allowance.

## Performance Testing

Run the performance test while the API and database are running:

```bash
node performance/load-test.mjs
```

The script creates a fresh account and user, configures their allowances, and submits 100 usage requests using 10 concurrent workers.

Results from one local test run:

| Metric | Result |
|---|---:|
| Total requests | 100 |
| Concurrent workers | 10 |
| Accepted requests | 100 |
| Rejected requests | 0 |
| Errors | 0 |
| Total duration | 1.40 seconds |
| Throughput | 71.61 requests/second |
| Average latency | 134.98 ms |
| P50 latency | 116.02 ms |
| P95 latency | 213.48 ms |
| P99 latency | 234.06 ms |
| Account units consumed | 100 |

The performance test passed. These measurements describe a single local run and may vary with hardware, database state, and system load.

