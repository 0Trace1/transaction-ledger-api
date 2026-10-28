import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { DbModule } from './db/db.module';

@Module({ imports: [DbModule, AccountsModule] })
export class AppModule {}
