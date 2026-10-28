// Applied on startup; fully idempotent.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  balance    numeric(18,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id),
  type         text NOT NULL CHECK (type IN ('credit', 'debit')),
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  description  text,
  reference_id text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_account_reference UNIQUE (account_id, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_tx_account_created
  ON transactions (account_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION block_tx_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tx_immutable ON transactions;
CREATE TRIGGER tx_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION block_tx_mutation();
`;
