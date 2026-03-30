import { PartialType } from '@nestjs/swagger';
import { CreateReimbursementDto } from './create-reimbursement.dto';

export class UpdateReimbursementDto extends PartialType(CreateReimbursementDto) {}
