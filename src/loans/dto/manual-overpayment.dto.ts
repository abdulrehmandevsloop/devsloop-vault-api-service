import {
  IsString,
  MaxLength,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanPaymentMethod } from '@prisma/client';

/**
 * How to recalibrate the remaining repayment schedule after an overpayment.
 * - REDUCE_INSTALLMENT: keep the same number of future installments, lower each amount.
 * - MAINTAIN_INSTALLMENT_SHORTEN_TENURE: keep the monthly amount, drop trailing months.
 */
export enum OverpaymentTenureMode {
  REDUCE_INSTALLMENT = 'REDUCE_INSTALLMENT',
  MAINTAIN_INSTALLMENT_SHORTEN_TENURE = 'MAINTAIN_INSTALLMENT_SHORTEN_TENURE',
}

export class ManualOverpaymentDto {
  @ApiProperty({ description: 'Overpayment amount in PKR (positive)', example: 200000, minimum: 1 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ description: 'Date the payment was received (ISO date)', example: '2026-07-10' })
  @IsDateString()
  paymentDate: string;

  @ApiProperty({ enum: LoanPaymentMethod, example: LoanPaymentMethod.BANK_TRANSFER })
  @IsEnum(LoanPaymentMethod)
  paymentMethod: LoanPaymentMethod;

  @ApiPropertyOptional({ description: 'Internal notes / remarks (e.g. bank ref)', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    enum: OverpaymentTenureMode,
    default: OverpaymentTenureMode.REDUCE_INSTALLMENT,
    description: 'Recalibration strategy for the remaining schedule',
  })
  @IsOptional()
  @IsEnum(OverpaymentTenureMode)
  tenureMode?: OverpaymentTenureMode = OverpaymentTenureMode.REDUCE_INSTALLMENT;
}
