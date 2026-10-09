import type { DatabaseSync } from 'node:sqlite';
import type { DatabaseSession } from './database.ts';

/**
 * Adapter wrapping Node's built-in synchronous SQLite for tests.
 */
export class NodeSqliteAdapter implements DatabaseSession {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    const stmt = this.db.prepare(sql);
    stmt.run(...(params as (string | number | bigint | null | Uint8Array)[]));
  }

  async getAll<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...(params as (string | number | bigint | null | Uint8Array)[]));
    return rows as T[];
  }

  async getFirst<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...(params as (string | number | bigint | null | Uint8Array)[]));
    return (row as T) ?? null;
  }
}
