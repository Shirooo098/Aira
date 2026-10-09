/**
 * Narrow database interface shared between Expo SQLite and Node test SQLite adapter.
 */
export interface DatabaseSession {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  getAll<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirst<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
}
