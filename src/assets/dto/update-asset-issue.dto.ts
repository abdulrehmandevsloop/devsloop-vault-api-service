import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AssetIssueStatus } from '@prisma/client';

export class UpdateAssetIssueDto {
  @ApiProperty({
    description: 'New status for the issue',
    enum: AssetIssueStatus,
  })
  @IsEnum(AssetIssueStatus, { message: 'Invalid status. Use OPEN, IN_PROGRESS, or RESOLVED.' })
  status: AssetIssueStatus;
}
