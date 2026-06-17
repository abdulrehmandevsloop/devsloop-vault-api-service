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

  // 'PAID'/'UNPAID' set a sticky HR override; 'AUTO' clears any existing
  // override so the PAID/PARTIAL/UNPAID split is recomputed from the balance.
  @IsOptional()
  @IsIn(['PAID', 'UNPAID', 'AUTO'])
  category?: 'PAID' | 'UNPAID' | 'AUTO';

  // HR may force a terminal status on the request, bypassing the workflow
  // engine. Only APPROVED/REJECTED are allowed; other transitions go through
  // the normal workflow approve/reject path.
  @IsOptional()
  @IsIn(['APPROVED', 'REJECTED'])
  status?: 'APPROVED' | 'REJECTED';
}
