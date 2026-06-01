import { IsIn, IsOptional, IsString } from 'class-validator';

export class SetLeaveCategoryDto {
  // 'AUTO' clears any HR override and lets the system auto-compute PAID/UNPAID
  // on approval based on the remaining balance.
  @IsIn(['PAID', 'UNPAID', 'AUTO'])
  category: 'PAID' | 'UNPAID' | 'AUTO';
}

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
