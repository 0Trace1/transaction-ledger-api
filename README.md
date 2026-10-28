# Transaction Ledger API

NestJS + TypeScript + PostgreSQL. Accounts, credit/debit transactions, balances, and paginated history.

## Run

```bash
docker compose up -d          # Postgres on :5432 (or point DATABASE_URL at your own)
cp .env.example .env
npm install
npm run start:dev             # http://localhost:3000, schema is applied on startup
```

## Test

Needs a Postgres with a `ledger_test` database (or set `TEST_DATABASE_URL`).

```bash
docker compose exec db createdb -U postgres ledger_test
npm test
```

The suite covers validation, the balance example from the brief, rejected debits, duplicate
references, pagination/filter/sort, immutability, and concurrency (parallel debits and parallel
duplicate references).

## API

| Method | Path                                            | Notes                                                                                                                          |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/accounts`                                     | Body: `{ "name": "Alice" }`. Returns the account with `balance: "0.00"`. Sending `balance` (or any unknown field) returns 400. |
| POST   | `/accounts/:id/transactions`                    | Body: `{ "type": "credit"\|"debit", "amount": 50, "description": "...", "reference_id": "abc" }`                               |
| GET    | `/accounts/:id/balance`                         | `{ "account_id", "balance" }`, 404 if missing                                                                                  |
| GET    | `/accounts/:id/transactions?type=&page=&limit=` | Latest first. Returns `data, page, limit, total, total_pages`                                                                  |

Responses for `POST /accounts/:id/transactions`:

- `201` created: `{ already_exists: false, transaction, balance }`
- `200` duplicate `reference_id` for this account: `{ already_exists: true, transaction }` (original transaction, nothing changed)
- `422` insufficient balance for a debit (nothing changed)
- `400` validation error, `404` unknown account

```bash
curl -X POST localhost:3000/accounts -H 'content-type: application/json' -d '{"name":"Alice"}'
curl -X POST localhost:3000/accounts/<id>/transactions -H 'content-type: application/json' \
  -d '{"type":"credit","amount":100,"description":"top up","reference_id":"ref-1"}'
curl localhost:3000/accounts/<id>/balance
curl 'localhost:3000/accounts/<id>/transactions?type=credit&page=1&limit=10'
```

## Design decisions

- **Money is `NUMERIC(18,2)`**, never floating point. Amounts are returned as strings.
  Amounts must be positive with at most 2 decimals.
- **One DB transaction per write.** The account row is locked (`SELECT ... FOR UPDATE`), so
  concurrent writes to the same account are serialized and a balance can never be overdrawn.
- **Idempotency lives in the database:** `UNIQUE (account_id, reference_id)` with
  `INSERT ... ON CONFLICT DO NOTHING`. The same reference on a different account is allowed.
- **Rejected debits are atomic.** The insert and the balance update share one transaction, so
  a rejection rolls everything back.
- **Immutability, two layers:** the API has no update or delete routes for transactions, and a
  database trigger rejects any `UPDATE` or `DELETE` on the `transactions` table.
- **Balance consistency:** the balance is only changed inside the same transaction that inserts
  the ledger row. `CHECK (balance >= 0)` is a backstop, and a test asserts
  `balance == SUM(credits) - SUM(debits)` after parallel mixed traffic.
- **History ordering:** `created_at DESC, id DESC` (id breaks ties), backed by an index on
  `(account_id, created_at DESC, id DESC)`.
- Duplicate returns `200` with the original transaction, which is the usual idempotent-retry
  behaviour. It is easy to switch to `409` in the controller if preferred.
- Schema is applied from `src/db/schema.ts` at startup to keep setup to one command. In a larger
  system this would be a migration tool.
