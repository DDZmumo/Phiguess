import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { configuration } from './config';

export interface Sql {
  query<T extends Record<string, any> = Record<string, any>>(sql: string, values?: any[]): Promise<{ rows: T[] }>;
}
@Injectable()
export class Db implements Sql, OnApplicationShutdown {
  private readonly pool = new Pool({ connectionString: configuration().DATABASE_URL, max: 5 });
  async query<T extends Record<string, any> = Record<string, any>>(sql: string, values: any[] = []): Promise<{ rows: T[] }> {
    return this.pool.query<T>(sql, values);
  }
  async transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async close() { await this.pool.end(); }
  async onApplicationShutdown() { await this.close(); }
}
