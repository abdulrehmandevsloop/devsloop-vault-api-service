import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApprovalStatus } from '@prisma/client';

@Injectable()
export class UserValidationService {
  private readonly logger = new Logger(UserValidationService.name);

  /**
   * Validate user can be approved/rejected
   * Note: Approve action allows role reassignment for already approved users
   */
  validateUserAction(
    userId: string,
    adminId: string,
    currentStatus: ApprovalStatus,
    action: 'approve' | 'reject',
  ): void {
    // Cannot approve/reject yourself
    if (userId === adminId) {
      throw new ForbiddenException(`You cannot ${action} yourself`);
    }

    // For approve action: Allow if PENDING or APPROVED (to allow role reassignment)
    if (action === 'approve') {
      if (currentStatus === ApprovalStatus.REJECTED) {
        throw new BadRequestException('Cannot approve a rejected user.');
      }
      // Allow PENDING and APPROVED (for role reassignment)
      return;
    }

    // For reject action: Only allow if PENDING (cannot reject approved users)
    if (action === 'reject') {
      if (currentStatus === ApprovalStatus.APPROVED) {
        throw new BadRequestException(
          'Cannot reject an approved user. Use status toggle to revoke access instead.',
        );
      }
      if (currentStatus === ApprovalStatus.REJECTED) {
        throw new BadRequestException('User has already been rejected');
      }
      // At this point, currentStatus must be PENDING, so allow the action
    }
  }
}
