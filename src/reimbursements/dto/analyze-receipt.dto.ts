import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeReceiptDto {
  @ApiProperty({ description: 'OCR-extracted text from receipt image' })
  @IsString()
  @IsNotEmpty()
  text!: string;
}
