import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Only `name` is accepted. Any other field (e.g. `balance`) is rejected with 400
// by the global ValidationPipe (whitelist + forbidNonWhitelisted).
export class CreateAccountDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;
}
