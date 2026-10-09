import type { SQLiteDatabase, SQLiteBindValue } from 'expo-sqlite';
import type { DatabaseSession } from './database.ts';

/**
 * Adapter wrapping Expo's SQLiteDatabase for React Native runtime.
 */
export class ExpoSqliteAdapter implements DatabaseSession {
  private readonly db: SQLiteDatabase;

  constructor(db: SQLiteDatabase) {
    this.db = db;
  }

  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.db.runAsync(sql, ...(params as SQLiteBindValue[]));
  }

  async getAll<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await this.db.getAllAsync<T>(
      sql,
      ...(params as SQLiteBindValue[])
    );
    return rows;
  }

  async getFirst<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const row = await this.db.getFirstAsync<T>(
      sql,
      ...(params as SQLiteBindValue[])
    );
    return row ?? null;
  }
}
