import { ApiProperty } from '@nestjs/swagger';

class ReimbursementEmployeeDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ required: false }) employeeId?: string | null;
  @ApiProperty({ required: false }) designation?: string | null;
  @ApiProperty({ required: false, type: [String] }) departments?: string[];
}

class ReimbursementReviewerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
}

class ReimbursementRequestDto {
  @ApiProperty() id: string;
  @ApiProperty() employeeId: string;
  @ApiProperty({ enum: ['MEDICAL', 'FOOD', 'FUEL_TRAVELLING', 'IT_GADGETS', 'OTHER'] })
  reimbursementType: string;
  @ApiProperty({ type: Number }) amount: number;
  @ApiProperty() description: string;
  @ApiProperty({ required: false }) receiptUrl: string | null;
  @ApiProperty({ required: false }) merchantName: string | null;
  @ApiProperty() transactionDate: string;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'PROCESSED'] })
  status: string;
  @ApiProperty({ enum: ['SALARY_ADJUSTMENT', 'SEPARATE_PAYMENT'] })
  processingType: string;
  @ApiProperty({ required: false }) otherComments: string | null;
  // Medical-specific fields
  @ApiProperty({ required: false }) patientName: string | null;
  @ApiProperty({ required: false, enum: ['SELF', 'PARENT', 'SPOUSE', 'CHILD'] })
  patientRelationship: string | null;
  @ApiProperty({
    required: false,
    enum: ['HOSPITALIZATION', 'MEDICINE', 'CONSULTATION', 'LAB_TESTS'],
  })
  treatmentType: string | null;
  @ApiProperty({ required: false }) hospitalName: string | null;
  @ApiProperty({ required: false }) hrId: string | null;
  @ApiProperty({ required: false }) hrComment: string | null;
  @ApiProperty({ required: false }) hrReviewedAt: string | null;
  @ApiProperty({ required: false, type: Number }) approvedAmount: number | null;
  @ApiProperty({ required: false }) processedAt: string | null;
  @ApiProperty({ required: false }) processedById: string | null;
  @ApiProperty({ required: false }) processingNotes: string | null;
  @ApiProperty({ required: false }) salaryMonth: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
  @ApiProperty() employee: ReimbursementEmployeeDto;
  @ApiProperty({ required: false }) hrReviewer: ReimbursementReviewerDto | null;
  @ApiProperty({ required: false }) processedBy: ReimbursementReviewerDto | null;
}

export class PaginatedReimbursementsResponseDto {
  @ApiProperty({ type: [ReimbursementRequestDto] })
  data: ReimbursementRequestDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
  @ApiProperty() hasNextPage: boolean;
  @ApiProperty() hasPreviousPage: boolean;

  // Status counts for the scoped view (ignores status filter but respects other filters)
  @ApiProperty({ description: 'Count of PENDING requests' }) pending: number;
  @ApiProperty({ description: 'Count of APPROVED requests' }) approved: number;
  @ApiProperty({ description: 'Count of REJECTED requests' }) rejected: number;
  @ApiProperty({ description: 'Count of PROCESSED requests' }) processed: number;
  @ApiProperty({ description: 'Total amount of all requests in scope' }) totalAmount: number;
}
