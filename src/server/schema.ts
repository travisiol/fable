/**
 * SQL migrations, applied in order and recorded in `schema_migrations`. One schema for Postgres
 * (DATABASE_URL: Neon / Vercel Postgres) and PGlite (local and tests). Never edit an applied
 * migration: append a new one.
 *
 * Conventions: timestamps are epoch milliseconds (BIGINT), SOL amounts are lamports (BIGINT),
 * credits are integers (BIGINT). Accounting invariants are enforced by the schema itself:
 *  - an account can never go negative and can never reserve more than it holds (CHECKs);
 *  - a job has exactly one payer source (CHECK) and exactly one reservation (partial UNIQUE);
 *  - a job ends with at most one of spend / release (partial UNIQUE on job_id): no double refund,
 *    no refund after a spend;
 *  - every ledger entry carries an idempotency key (UNIQUE);
 *  - a fee receipt is keyed on its transaction signature + mint (PRIMARY KEY): ingestion is idempotent;
 *  - a character has at most one active launch, and a mint is used once (partial UNIQUE / UNIQUE).
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "init",
    sql: `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, created_at BIGINT NOT NULL);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  storage TEXT NOT NULL CHECK (storage IN ('blob','local')),
  location TEXT NOT NULL,
  character_id TEXT,
  job_id TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  number INTEGER UNIQUE,
  owner TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','saved','discarded')),
  idea TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT '',
  niche TEXT NOT NULL DEFAULT '',
  look TEXT NOT NULL DEFAULT '',
  portrait_media_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  saved_at BIGINT
);
CREATE INDEX IF NOT EXISTS characters_owner ON characters(owner, updated_at DESC);
CREATE INDEX IF NOT EXISTS characters_saved ON characters(status, saved_at DESC);

CREATE TABLE IF NOT EXISTS credit_accounts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('holder_credits','character_budget','holder_pool')),
  owner TEXT,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at BIGINT NOT NULL,
  CHECK (reserved <= balance)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('character','portrait','image','video')),
  preset TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  payer TEXT NOT NULL CHECK (payer IN ('holder_credits','character_budget')),
  payer_account TEXT NOT NULL REFERENCES credit_accounts(id),
  cost BIGINT NOT NULL CHECK (cost > 0),
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  provider_job_id TEXT,
  error TEXT,
  result_media_id TEXT,
  result_json TEXT,
  idempotency_key TEXT NOT NULL,
  lease_until BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  finished_at BIGINT,
  UNIQUE (owner, idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_character ON jobs(character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_open ON jobs(status, lease_until);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('funding','allocation','allocation_out','reserve','spend','release','grant','grant_out')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  job_id TEXT REFERENCES jobs(id),
  ref TEXT,
  note TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_entries(account_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_reserve ON ledger_entries(job_id) WHERE kind = 'reserve';
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_settlement ON ledger_entries(job_id) WHERE kind IN ('spend','release');

CREATE TABLE IF NOT EXISTS launches (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id),
  owner TEXT NOT NULL,
  mint TEXT NOT NULL UNIQUE,
  cluster TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared','submitted','confirmed','failed','rejected','expired')),
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '{}',
  uri TEXT NOT NULL,
  initial_buy_lamports BIGINT NOT NULL DEFAULT 0,
  last_valid_block_height BIGINT,
  create_sig TEXT,
  sharing_status TEXT NOT NULL DEFAULT 'none' CHECK (sharing_status IN ('none','prepared','submitted','active','failed')),
  sharing_sig TEXT,
  sharing_last_valid_block_height BIGINT,
  error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  confirmed_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS launches_one_active ON launches(character_id) WHERE status IN ('prepared','submitted','confirmed');

CREATE TABLE IF NOT EXISTS fee_receipts (
  signature TEXT NOT NULL,
  mint TEXT NOT NULL,
  character_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('distribution','deposit')),
  total_lamports BIGINT NOT NULL,
  pool_lamports BIGINT NOT NULL,
  budget_lamports BIGINT NOT NULL,
  creator_lamports BIGINT NOT NULL,
  pool_credits BIGINT NOT NULL,
  budget_credits BIGINT NOT NULL,
  credit_lamports BIGINT NOT NULL,
  slot BIGINT,
  block_time BIGINT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (signature, mint)
);
CREATE INDEX IF NOT EXISTS receipts_character ON fee_receipts(character_id, created_at DESC);

CREATE TABLE IF NOT EXISTS holder_snapshots (
  day TEXT NOT NULL,
  wallet TEXT NOT NULL,
  amount BIGINT NOT NULL,
  PRIMARY KEY (day, wallet)
);
CREATE TABLE IF NOT EXISTS snapshot_runs (
  day TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  holders INTEGER NOT NULL,
  taken_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS allocation_runs (
  week TEXT PRIMARY KEY,
  pool_available BIGINT NOT NULL,
  budget BIGINT NOT NULL,
  allocated BIGINT NOT NULL,
  eligible INTEGER NOT NULL,
  snapshot_days INTEGER NOT NULL,
  rules TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS allocations (
  week TEXT NOT NULL,
  wallet TEXT NOT NULL,
  average_amount BIGINT NOT NULL,
  credits BIGINT NOT NULL,
  PRIMARY KEY (week, wallet)
);
`,
  },
];
