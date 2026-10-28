import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateTransactionDto {
  @IsIn(['credit', 'debit'])
  type: 'credit' | 'debit';

  // Positive, max 2 decimals. Accepts a number or a numeric string.
  @Transform(({ value }) => (typeof value === 'number' ? String(value) : value))
  @Matches(/^(?!0+(\.0+)?$)\d{1,16}(\.\d{1,2})?$/, {
    message: 'amount must be a positive number with at most 2 decimal places',
  })
  amount: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reference_id: string;
}
