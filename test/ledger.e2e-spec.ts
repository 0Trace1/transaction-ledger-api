process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ledger_test';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DbService } from '../src/db/db.service';

describe('Transaction ledger API', () => {
  let app: INestApplication;
  let db: DbService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(DbService);
  });

  beforeEach(async () => {
    await db.pool.query('TRUNCATE transactions, accounts CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  const newAccount = async (name = 'Alice') =>
    (await http().post('/accounts').send({ name })).body.id as string;

  const tx = (id: string, type: string, amount: number | string, ref: string) =>
    http().post(`/accounts/${id}/transactions`).send({ type, amount, description: 'test', reference_id: ref });

  const balanceOf = async (id: string) =>
    (await http().get(`/accounts/${id}/balance`)).body.balance;

  describe('create account', () => {
    it('creates with balance 0 and system fields', async () => {
      const res = await http().post('/accounts').send({ name: 'Alice' }).expect(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Alice');
      expect(Number(res.body.balance)).toBe(0);
      expect(new Date(res.body.created_at).getTime()).not.toBeNaN();
    });

    it('requires name', async () => {
      await http().post('/accounts').send({}).expect(400);
      await http().post('/accounts').send({ name: '   ' }).expect(400);
    });

    it('does not let the client set balance', async () => {
      await http().post('/accounts').send({ name: 'Bob', balance: 500 }).expect(400);
      const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM accounts`);
      expect(rows[0].n).toBe(0);
    });
  });

  describe('transactions', () => {
    it('applies the spec example: 0 +100 +50 -30 -20 = 100', async () => {
      const id = await newAccount();
      await tx(id, 'credit', 100, 'r1').expect(201);
      await tx(id, 'credit', 50, 'r2').expect(201);
      await tx(id, 'debit', 30, 'r3').expect(201);
      await tx(id, 'debit', 20, 'r4').expect(201);
      expect(Number(await balanceOf(id))).toBe(100);
    });

    it('rejects a debit above balance and leaves state untouched', async () => {
      const id = await newAccount();
      await tx(id, 'credit', 100, 'r1').expect(201);
      await tx(id, 'debit', 150, 'r2').expect(422);
      expect(Number(await balanceOf(id))).toBe(100);
      const list = await http().get(`/accounts/${id}/transactions`);
      expect(list.body.total).toBe(1);
    });

    it('validates input', async () => {
      const id = await newAccount();
      await tx(id, 'refund', 10, 'r1').expect(400);
      await tx(id, 'credit', -5, 'r2').expect(400);
      await tx(id, 'credit', 0, 'r3').expect(400);
      await tx(id, 'credit', '10.999', 'r4').expect(400);
      await tx(id, 'credit', 'abc', 'r5').expect(400);
      await http().post(`/accounts/${id}/transactions`).send({ type: 'credit', amount: 5 }).expect(400);
    });

    it('returns 404 for unknown or malformed account ids', async () => {
      await tx('00000000-0000-4000-8000-000000000000', 'credit', 10, 'r1').expect(404);
      await tx('not-a-uuid', 'credit', 10, 'r1').expect(400);
    });

    it('treats a repeated reference_id as a no-op for the same account', async () => {
      const id = await newAccount();
      const first = await tx(id, 'credit', 100, 'dup').expect(201);
      const again = await tx(id, 'credit', 100, 'dup').expect(200);
      expect(again.body.already_exists).toBe(true);
      expect(again.body.transaction.id).toBe(first.body.transaction.id);
      expect(Number(await balanceOf(id))).toBe(100);
      expect((await http().get(`/accounts/${id}/transactions`)).body.total).toBe(1);
    });

    it('allows the same reference_id on different accounts', async () => {
      const a = await newAccount('A');
      const b = await newAccount('B');
      await tx(a, 'credit', 10, 'shared').expect(201);
      await tx(b, 'credit', 10, 'shared').expect(201);
    });
  });

  describe('balance', () => {
    it('returns account_id and balance', async () => {
      const id = await newAccount();
      const res = await http().get(`/accounts/${id}/balance`).expect(200);
      expect(res.body).toEqual({ account_id: id, balance: '0.00' });
    });

    it('404s for a missing account', async () => {
      await http().get('/accounts/00000000-0000-4000-8000-000000000000/balance').expect(404);
    });
  });

  describe('history', () => {
    it('filters, paginates and sorts latest first', async () => {
      const id = await newAccount();
      for (let i = 1; i <= 5; i++) await tx(id, 'credit', 10, `c${i}`).expect(201);
      for (let i = 1; i <= 2; i++) await tx(id, 'debit', 1, `d${i}`).expect(201);

      const all = await http().get(`/accounts/${id}/transactions?limit=3&page=1`).expect(200);
      expect(all.body).toMatchObject({ page: 1, limit: 3, total: 7, total_pages: 3 });
      expect(all.body.data.map((t: any) => t.reference_id)).toEqual(['d2', 'd1', 'c5']);

      const p3 = await http().get(`/accounts/${id}/transactions?limit=3&page=3`);
      expect(p3.body.data.map((t: any) => t.reference_id)).toEqual(['c1']);

      const credits = await http().get(`/accounts/${id}/transactions?type=credit`);
      expect(credits.body.total).toBe(5);
      expect(credits.body.data.every((t: any) => t.type === 'credit')).toBe(true);

      const debits = await http().get(`/accounts/${id}/transactions?type=debit`);
      expect(debits.body.total).toBe(2);
    });

    it('rejects bad query params and unknown accounts', async () => {
      const id = await newAccount();
      await http().get(`/accounts/${id}/transactions?type=nope`).expect(400);
      await http().get(`/accounts/${id}/transactions?page=0`).expect(400);
      await http().get(`/accounts/${id}/transactions?limit=1000`).expect(400);
      await http().get('/accounts/00000000-0000-4000-8000-000000000000/transactions').expect(404);
    });
  });

  describe('immutability', () => {
    it('exposes no update or delete routes', async () => {
      const id = await newAccount();
      const t = await tx(id, 'credit', 10, 'r1');
      const url = `/accounts/${id}/transactions/${t.body.transaction.id}`;
      await http().put(url).send({ amount: 1 }).expect(404);
      await http().patch(url).send({ amount: 1 }).expect(404);
      await http().delete(url).expect(404);
    });

    it('is enforced by the database too', async () => {
      const id = await newAccount();
      await tx(id, 'credit', 10, 'r1').expect(201);
      await expect(db.pool.query(`UPDATE transactions SET amount = 999`)).rejects.toThrow(/immutable/);
      await expect(db.pool.query(`DELETE FROM transactions`)).rejects.toThrow(/immutable/);
    });
  });

  describe('concurrency', () => {
    it('never overdraws under parallel debits', async () => {
      const id = await newAccount();
      await tx(id, 'credit', 100, 'seed').expect(201);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => tx(id, 'debit', 10, `p${i}`)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(10);
      expect(results.filter((r) => r.status === 422)).toHaveLength(10);
      expect(Number(await balanceOf(id))).toBe(0);
    });

    it('creates only one transaction for parallel duplicate references', async () => {
      const id = await newAccount();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => tx(id, 'credit', 10, 'same')),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 200)).toHaveLength(9);
      expect(Number(await balanceOf(id))).toBe(10);
    });

    it('balance always equals the sum of recorded transactions', async () => {
      const id = await newAccount();
      await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          tx(id, i % 3 === 0 ? 'debit' : 'credit', 7 + (i % 5), `m${i}`),
        ),
      );
      const { rows } = await db.pool.query(
        `SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) AS s
           FROM transactions WHERE account_id=$1`, [id]);
      expect(Number(rows[0].s)).toBe(Number(await balanceOf(id)));
    });
  });
});
