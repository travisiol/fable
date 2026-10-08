/**
 * Database adapter: Postgres through `DATABASE_URL` (node-postgres pool: Neon, Vercel Postgres,
 * any Postgres), else PGlite (Postgres compiled to WASM) in `./data/pglite` — or the OS temp dir
 * when the disk is read-only, flagged as ephemeral. Tests open PGlite in memory.
 *
 * Both sides speak the same SQL with $1 placeholders. `tx()` runs a function inside one
 * transaction: on Postgres with a dedicated client (BEGIN … COMMIT, row locks with FOR UPDATE);
 * on PGlite under a process-wide mutex, so a transaction is never interleaved with other queries.
 */
import { accessSync, constants, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "./schema.ts";

export type Row = Record<string, unknown>;

export interface Q {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Q {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  info: { driver: "postgres" | "pglite"; persistent: boolean; location: string };
}

// ───────────────────────────── helpers for driver differences (BIGINT comes back as string or bigint)

export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
export const big = (v: unknown): bigint => (v === null || v === undefined ? BigInt(0) : BigInt(String(v)));
export const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Serialises bigint params (pg accepts strings for BIGINT). */
const params = (p: unknown[] = []) => p.map((v) => (typeof v === "bigint" ? v.toString() : v));

// ───────────────────────────── a tiny async mutex (PGlite)

class Mutex {
  private last: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.last;
    this.last = prev.then(() => next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

// ───────────────────────────── PGlite

export async function openPglite(dataDir: string | null): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const lock = new Mutex();
  const raw = async <T extends Row>(sql: string, p?: unknown[]) => ((await pg.query<T>(sql, params(p))).rows as T[]);
  const db: Db = {
    query: (sql, p) => lock.run(() => raw(sql, p)),
    tx: (fn) =>
      lock.run(async () => {
        await pg.exec("BEGIN");
        try {
          const out = await fn({ query: raw });
          await pg.exec("COMMIT");
          return out;
        } catch (e) {
          await pg.exec("ROLLBACK").catch(() => {});
          throw e;
        }
      }),
    close: () => pg.close(),
    info: { driver: "pglite", persistent: Boolean(dataDir) && !process.env["VERCEL"], location: dataDir ?? "memory" },
  };
  await migrate(db, (sql) => lock.run(() => pg.exec(sql).then(() => undefined)));
  return db;
}

// ───────────────────────────── Postgres

export async function openPostgres(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 5, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  const db: Db = {
    query: async (sql, p) => (await pool.query(sql, params(p))).rows,
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: async (sql, p) => (await client.query(sql, params(p))).rows });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
    info: { driver: "postgres", persistent: true, location: url.replace(/\/\/[^@]*@/, "//***@") },
  };
  await migrate(db, async (sql) => {
    await pool.query(sql);
  });
  return db;
}

// ───────────────────────────── migrations

async function migrate(db: Db, exec: (sql: string) => Promise<void>) {
  await exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at BIGINT NOT NULL)");
  const done = new Set((await db.query<{ id: number }>("SELECT id FROM schema_migrations")).map((r) => num(r.id)));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await exec(m.sql);
    await db.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", [m.id, m.name, Date.now()]);
  }
}

// ───────────────────────────── the process-wide handle

function localDir(): { dir: string; persistent: boolean } {
  const explicit = process.env["FABLE_PGLITE_DIR"]?.trim();
  const dir = explicit || join(process.cwd(), "data", "pglite");
  try {
    mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
    accessSync(/* turbopackIgnore: true */ dir, constants.W_OK);
    return { dir, persistent: !process.env["VERCEL"] };
  } catch {
    const t = join(tmpdir(), "fable-pglite");
    mkdirSync(t, { recursive: true });
    return { dir: t, persistent: false };
  }
}

const holder = globalThis as unknown as { __fableDb?: Promise<Db> };

/** The process-wide database (survives dev hot reloads). */
export function db(): Promise<Db> {
  if (!holder.__fableDb) {
    const url = process.env["DATABASE_URL"]?.trim();
    holder.__fableDb = (url ? openPostgres(url) : openPglite(localDir().dir)).then((d) => {
      if (!url) d.info.persistent = localDir().persistent;
      return d;
    });
    holder.__fableDb.catch(() => {
      holder.__fableDb = undefined;
    });
  }
  return holder.__fableDb;
}

/** Tests: an in-memory PGlite with the schema applied. */
export function memoryDb(): Promise<Db> {
  return openPglite(null);
}
