import { PartialType } from '@nestjs/swagger';
import { CreateSalaryAdjustmentDto } from './create-salary-adjustment.dto';

export class UpdateSalaryAdjustmentDto extends PartialType(CreateSalaryAdjustmentDto) {}
