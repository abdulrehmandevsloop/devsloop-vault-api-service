import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateRequestTypeDto } from './create-request-type.dto';

export class UpdateRequestTypeDto extends PartialType(
  OmitType(CreateRequestTypeDto, ['key'] as const),
) {}
