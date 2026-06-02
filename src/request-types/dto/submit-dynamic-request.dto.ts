import { IsObject, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitDynamicRequestDto {
  @ApiProperty({ description: 'Request type key, e.g. TRAINING_REQUEST' })
  @IsString()
  @MaxLength(100)
  typeKey: string;

  @ApiProperty({ description: 'Form field values keyed by field id' })
  @IsObject()
  formData: Record<string, unknown>;
}
