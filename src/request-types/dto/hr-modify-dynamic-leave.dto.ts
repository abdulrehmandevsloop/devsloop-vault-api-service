import { IsIn, IsOptional, IsString } from 'class-validator';

export class HrModifyDynamicLeaveDto {
  @IsOptional()
  @IsString()
  leaveType?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  halfDayPeriod?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsString()
  comment: string;

  @IsOptional()
  @IsIn(['PAID', 'UNPAID'])
  category?: 'PAID' | 'UNPAID';
}
