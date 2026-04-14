import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateExpenseDto {
  @ApiProperty({ example: 'Team lunch' })
  @IsString({ message: 'Title must be a string' })
  @MaxLength(255, { message: 'Title can be up to 255 characters' })
  title: string;

  @ApiPropertyOptional({ example: 'Sprint planning lunch for engineering team' })
  @IsOptional()
  @IsString({ message: 'Description must be a string' })
  description?: string;

  @ApiProperty({ example: 'Meals' })
  @IsString({ message: 'Category must be a string' })
  @MaxLength(120, { message: 'Category can be up to 120 characters' })
  category: string;

  @ApiProperty({ example: 14500 })
  @IsNumber({}, { message: 'Amount must be a number' })
  @Min(0, { message: 'Amount cannot be negative' })
  amount: number;

  @ApiPropertyOptional({ example: 'PKR', default: 'PKR' })
  @IsOptional()
  @IsString({ message: 'Currency must be a string' })
  @MaxLength(10, { message: 'Currency can be up to 10 characters' })
  currency?: string;

  @ApiPropertyOptional({ enum: ExpenseStatus, default: ExpenseStatus.DRAFT })
  @IsOptional()
  @IsEnum(ExpenseStatus, { message: 'Invalid expense status' })
  status?: ExpenseStatus;

  @ApiProperty({ example: '2026-04-10' })
  @IsDateString({}, { message: 'Incurred date must be a valid date string' })
  incurredAt: string;
}
