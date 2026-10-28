import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { SCHEMA_SQL } from './schema';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ledger',
  });

  async onModuleInit() {
    // Advisory lock so parallel starts do not race on DDL.
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(727001)');
      await client.query(SCHEMA_SQL);
      await client.query('SELECT pg_advisory_unlock(727001)');
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /** Runs fn in a single DB transaction; rolls back on any error. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
