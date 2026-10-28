import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';

// Note: there are intentionally no PUT/PATCH/DELETE routes for transactions.
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.accounts.createAccount(dto.name);
  }

  @Post(':id/transactions')
  async addTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTransactionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.accounts.addTransaction(id, dto);
    // 201 when created, 200 when the reference_id already existed.
    res.status(result.already_exists ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  @Get(':id/balance')
  balance(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.getBalance(id);
  }

  @Get(':id/transactions')
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListTransactionsDto,
  ) {
    return this.accounts.listTransactions(id, query);
  }
}
