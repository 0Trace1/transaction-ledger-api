import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly db: DbService) {}

  async createAccount(name: string) {
    // balance is never taken from the client; the column default (0) applies.
    const { rows } = await this.db.pool.query(
      `INSERT INTO accounts (name) VALUES ($1)
       RETURNING id, name, balance, created_at`,
      [name],
    );
    return rows[0];
  }

  async getBalance(accountId: string) {
    const { rows } = await this.db.pool.query(
      `SELECT id AS account_id, balance FROM accounts WHERE id = $1`,
      [accountId],
    );
    if (!rows.length) throw new NotFoundException('Account not found');
    return rows[0];
  }

  async addTransaction(accountId: string, dto: CreateTransactionDto) {
    return this.db.tx(async (client) => {
      // 1. Lock the account row: concurrent writers to this account are serialized,
      //    so the balance check and update below cannot interleave.
      const acc = await client.query(
        `SELECT balance >= $2::numeric AS sufficient
           FROM accounts WHERE id = $1 FOR UPDATE`,
        [accountId, dto.amount],
      );
      if (!acc.rows.length) throw new NotFoundException('Account not found');

      // 2. Idempotency: the unique (account_id, reference_id) constraint decides.
      const ins = await client.query(
        `INSERT INTO transactions (account_id, type, amount, description, reference_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, reference_id) DO NOTHING
         RETURNING *`,
        [accountId, dto.type, dto.amount, dto.description ?? null, dto.reference_id],
      );
      if (!ins.rows.length) {
        const existing = await client.query(
          `SELECT * FROM transactions WHERE account_id = $1 AND reference_id = $2`,
          [accountId, dto.reference_id],
        );
        return { already_exists: true, transaction: existing.rows[0] };
      }

      // 3. Insufficient funds: throwing rolls back the insert above too, so a
      //    rejected debit leaves no row and no balance change.
      if (dto.type === 'debit' && !acc.rows[0].sufficient) {
        throw new UnprocessableEntityException('Insufficient balance');
      }

      // 4. Apply to balance (CHECK (balance >= 0) is a last-line backstop).
      const delta = dto.type === 'credit' ? dto.amount : `-${dto.amount}`;
      const upd = await client.query(
        `UPDATE accounts SET balance = balance + $1::numeric
          WHERE id = $2 RETURNING balance`,
        [delta, accountId],
      );

      return {
        already_exists: false,
        transaction: ins.rows[0],
        balance: upd.rows[0].balance,
      };
    });
  }

  async listTransactions(accountId: string, q: ListTransactionsDto) {
    await this.getBalance(accountId); // 404 if the account does not exist

    const type = q.type ?? null;
    const offset = (q.page - 1) * q.limit;

    const [data, count] = await Promise.all([
      this.db.pool.query(
        `SELECT * FROM transactions
          WHERE account_id = $1 AND ($2::text IS NULL OR type = $2)
          ORDER BY created_at DESC, id DESC
          LIMIT $3 OFFSET $4`,
        [accountId, type, q.limit, offset],
      ),
      this.db.pool.query(
        `SELECT count(*)::int AS total FROM transactions
          WHERE account_id = $1 AND ($2::text IS NULL OR type = $2)`,
        [accountId, type],
      ),
    ]);

    const total: number = count.rows[0].total;
    return {
      data: data.rows,
      page: q.page,
      limit: q.limit,
      total,
      total_pages: Math.ceil(total / q.limit),
    };
  }
}
