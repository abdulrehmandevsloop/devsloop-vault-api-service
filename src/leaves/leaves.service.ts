import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HalfDayPeriod, LeaveCategory, LeaveStatus, LeaveType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import {
  AllowedLeaveTypesResponseDto,
  CreateLeaveRequestDto,
  HrApplySpecialLeaveDto,
  HrLeavesQueryDto,
  HrModifyLeaveRequestDto,
  HrReviewLeaveRequestDto,
  HrSplitLeaveRequestDto,
  HrStatsResponseDto,
  LeaveBalanceResponseDto,
  LeaveRequestResponseDto,
  MyLeavesQueryDto,
  PaginatedLeavesResponseDto,
  ReportingManagerResponseDto,
  ReviewLeaveRequestDto,
  SplitPartDto,
  TeamLeadLeavesQueryDto,
  UpdateLeaveTypeAccessDto,
} from './dto';
import { LEAVE_REQUEST_SELECT_FIELDS, LeaveRequestWithRelations } from './interfaces';
import { calculateLeaveDays, computeProRataCasualQuota, computeProRataSickQuota } from './utils';
import {
  LeaveApprovedEvent,
  LeaveDeletedEvent,
  LeaveModifiedEvent,
  LeaveRejectedEvent,
  LeaveSubmittedEvent,
  LeaveTeamLeadReviewedEvent,
} from './events';

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Approval routing policy:
//   PENDING → TL reviews first (TEAM_LEAD_APPROVED or TEAM_LEAD_REJECTED)
//             Employee can not cancel if team lead has approved or rejected.
//   TEAM_LEAD_APPROVED / TEAM_LEAD_REJECTED → HR makes the final call.
//   HR can act on PENDING requests — TL review is not mandatory.
// ---------------------------------------------------------------------------
const ALLOWED_TRANSITIONS: Record<LeaveStatus, LeaveStatus[]> = {
  [LeaveStatus.PENDING]: [
    LeaveStatus.TEAM_LEAD_APPROVED,
    LeaveStatus.TEAM_LEAD_REJECTED,
    LeaveStatus.APPROVED,
    LeaveStatus.REJECTED,
    LeaveStatus.CANCELLED,
  ],
  [LeaveStatus.TEAM_LEAD_APPROVED]: [LeaveStatus.APPROVED, LeaveStatus.REJECTED],
  [LeaveStatus.TEAM_LEAD_REJECTED]: [LeaveStatus.APPROVED, LeaveStatus.REJECTED],
  [LeaveStatus.APPROVED]: [],
  [LeaveStatus.REJECTED]: [],
  [LeaveStatus.CANCELLED]: [],
  [LeaveStatus.MODIFIED]: [],
};

// Statuses that HR can force-transition from (used in hrModifyLeave)
const HR_FORCE_ALLOWED_FROM: LeaveStatus[] = [
  LeaveStatus.PENDING,
  LeaveStatus.TEAM_LEAD_APPROVED,
  LeaveStatus.TEAM_LEAD_REJECTED,
  LeaveStatus.APPROVED,
  LeaveStatus.MODIFIED,
  LeaveStatus.REJECTED,
];

// "Balance-effective" statuses — balance has been deducted for these
const BALANCE_EFFECTIVE_STATUSES: LeaveStatus[] = [LeaveStatus.APPROVED, LeaveStatus.MODIFIED];

// Statuses where WFH pending slot is reserved
const WFH_PENDING_STATUSES: LeaveStatus[] = [LeaveStatus.PENDING, LeaveStatus.TEAM_LEAD_APPROVED];

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------
const MATERNITY_MAX_DAYS = 22;
const WFH_PER_MONTH = 1;
const WEDDING_MAX_DAYS = 5;
const UMRAH_HAJJ_MAX_DAYS = 10;
const UMRAH_HAJJ_MIN_SERVICE_MONTHS = 12;
const CASUAL_ADVANCE_NOTICE_DAYS = 3;
const WFH_ADVANCE_NOTICE_DAYS = 1;
const MULTI_DAY_ADVANCE_NOTICE_DAYS = 7;

@Injectable()
export class LeavesService {
  private readonly logger = new Logger(LeavesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // -------------------------------------------------------------------------
  // Employee — Get reporting managers
  // -------------------------------------------------------------------------

  async getReportingManagers(): Promise<ReportingManagerResponseDto[]> {
    // Find users who have the 'leave-review' entity via their role assignments
    const users = await this.prisma.user.findMany({
      where: {
        isSystem: false,
        approvalStatus: 'APPROVED',
        employeeStatus: 'ACTIVE',
        userRoleAssignments: {
          some: {
            role: {
              isActive: true,
              roleEntities: {
                some: {
                  entity: { name: 'leave-review', isActive: true },
                },
              },
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        departments: true,
        designation: true,
      },
      orderBy: { name: 'asc' },
    });

    return users;
  }

  // -------------------------------------------------------------------------
  // Employee — Submit leave request
  // -------------------------------------------------------------------------

  async submitLeaveRequest(
    employeeId: string,
    dto: CreateLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    // Basic date validation
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be greater than or equal to startDate');
    }

    // HALF_DAY and WFH must be single-day
    if (dto.leaveType === LeaveType.HALF_DAY || dto.leaveType === LeaveType.WFH) {
      if (dto.startDate !== dto.endDate) {
        throw new BadRequestException(
          `${dto.leaveType} requests must have the same startDate and endDate`,
        );
      }
    }

    // Fetch employee to validate rules
    const employee = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        email: true,
        joiningDate: true,
        allowMaternityLeave: true,
        allowWeddingLeave: true,
        allowUmrahHajjLeave: true,
        allowOtherLeave: true,
      },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Special leave types can only be applied by HR on behalf of the employee
    const SPECIAL_LEAVE_TYPES: LeaveType[] = [
      LeaveType.MATERNITY,
      LeaveType.WEDDING,
      LeaveType.UMRAH_HAJJ,
      LeaveType.OTHER,
    ];
    if (SPECIAL_LEAVE_TYPES.includes(dto.leaveType)) {
      throw new ForbiddenException(
        `${dto.leaveType} leave can only be applied by HR on your behalf. Please contact HR to apply this leave.`,
      );
    }

    // Validate reporting manager exists and has leave-review entity
    const manager = await this.prisma.user.findFirst({
      where: {
        id: dto.reportingManagerId,
        approvalStatus: 'APPROVED',
        userRoleAssignments: {
          some: {
            role: {
              isActive: true,
              roleEntities: {
                some: { entity: { name: 'leave-review', isActive: true } },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!manager) {
      throw new BadRequestException('Invalid reporting manager selection');
    }

    // Calculate days consumed
    const leaveInfo = calculateLeaveDays(dto.leaveType, startDate, endDate, dto.halfDayPeriod);

    // Policy validations
    await this.validatePolicyRules(
      employeeId,
      dto,
      employee,
      startDate,
      endDate,
      leaveInfo.daysConsumed,
    );

    // Balance info — logged for awareness; submissions are allowed even when balance
    // is insufficient so emergencies are not blocked. TL and HR see the balance
    // on the detail page and can make an informed decision. Leave beyond entitlement
    // is treated as unpaid per company policy.
    if (!leaveInfo.isWfh) {
      const currentYear = startDate.getFullYear();
      const balance = await this.getOrCreateLeaveBalance(employeeId, currentYear);

      if (leaveInfo.deductedFromCasual) {
        const remaining = balance.casualBalance.toNumber() - balance.casualUsed.toNumber();
        if (leaveInfo.daysConsumed > remaining) {
          this.logger.warn(
            `Employee ${employeeId} submitted casual leave of ${leaveInfo.daysConsumed} day(s) with only ${remaining} day(s) remaining — will be unpaid if approved`,
          );
        }
      }

      if (leaveInfo.deductedFromSick) {
        const remaining = balance.sickBalance.toNumber() - balance.sickUsed.toNumber();
        if (leaveInfo.daysConsumed > remaining) {
          this.logger.warn(
            `Employee ${employeeId} submitted sick leave of ${leaveInfo.daysConsumed} day(s) with only ${remaining} day(s) remaining — will be unpaid if approved`,
          );
        }
      }
    }

    // Maternity: validate 22-day ceiling
    if (leaveInfo.isMaternity) {
      const currentYear = startDate.getFullYear();
      const usedMaternityDays = await this.getTotalApprovedMaternityDays(employeeId, currentYear);
      if (usedMaternityDays + leaveInfo.daysConsumed > MATERNITY_MAX_DAYS) {
        this.logger.warn(
          `Policy warning: Maternity leave limit exceeded. Annual quota: ${MATERNITY_MAX_DAYS} days. Already approved: ${usedMaternityDays} day(s). Requested: ${leaveInfo.daysConsumed} day(s). Extra days may be treated as unpaid per policy.`,
        );
      }
    }

    // Create the request
    const leaveRequest = await this.prisma.leaveRequest.create({
      data: {
        employeeId,
        reportingManagerId: dto.reportingManagerId,
        leaveType: dto.leaveType,
        status: LeaveStatus.PENDING,
        startDate,
        endDate,
        halfDayPeriod: dto.halfDayPeriod ?? null,
        daysConsumed: leaveInfo.daysConsumed,
        reason: dto.reason.trim(),
        medicalCertificateUrl: dto.medicalCertificateUrl ?? null,
      },
      select: LEAVE_REQUEST_SELECT_FIELDS,
    });

    this.logger.log(`Leave request ${leaveRequest.id} submitted by employee ${employeeId}`);

    // Track WFH pending slot so the monthly cap includes in-flight requests
    if (leaveInfo.isWfh) {
      await this.adjustWfhMonthlyUsage(this.prisma, employeeId, startDate, {
        pending: leaveInfo.daysConsumed,
      });
    }

    this.eventEmitter.emit(
      'leave.submitted',
      new LeaveSubmittedEvent(
        leaveRequest.id,
        employeeId,
        employee.email,
        employee.name,
        leaveRequest.reportingManager.id,
        leaveRequest.reportingManager.email,
        leaveRequest.reportingManager.name,
        dto.leaveType,
        startDate,
        endDate,
        leaveInfo.daysConsumed,
      ),
    );

    return this.toDto(leaveRequest as LeaveRequestWithRelations, true);
  }

  // -------------------------------------------------------------------------
  // Employee — Cancel leave request
  // -------------------------------------------------------------------------

  async cancelLeaveRequest(leaveRequestId: string, employeeId: string): Promise<void> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      select: {
        id: true,
        employeeId: true,
        status: true,
        leaveType: true,
        daysConsumed: true,
        startDate: true,
        appliedByHrId: true,
      },
    });

    if (!request) {
      throw new NotFoundException(`Leave request ${leaveRequestId} not found`);
    }
    if (request.employeeId !== employeeId) {
      throw new ForbiddenException('You can only cancel your own leave requests');
    }
    if (request.appliedByHrId) {
      throw new ForbiddenException(
        'This leave was applied by HR and cannot be cancelled by the employee. Please contact HR.',
      );
    }

    this.validateStatusTransition(request.status, LeaveStatus.CANCELLED);

    await this.prisma.leaveRequest.update({
      where: { id: leaveRequestId },
      data: { status: LeaveStatus.CANCELLED },
    });

    // Cancel can only come from PENDING (status machine), so decrement the pending WFH slot
    if (request.leaveType === LeaveType.WFH) {
      await this.adjustWfhMonthlyUsage(this.prisma, employeeId, request.startDate, {
        pending: -request.daysConsumed.toNumber(),
      });
    }

    this.logger.log(`Leave request ${leaveRequestId} cancelled by employee ${employeeId}`);
  }

  // -------------------------------------------------------------------------
  // Employee — List own requests
  // -------------------------------------------------------------------------

  async findMyLeaves(
    employeeId: string,
    query: MyLeavesQueryDto,
  ): Promise<PaginatedLeavesResponseDto> {
    const { page = 1, limit = 20, status, leaveType, dateFrom, dateTo } = query;
    const skip = (page - 1) * limit;

    const baseWhere: Record<string, unknown> = { employeeId };
    if (leaveType) baseWhere.leaveType = leaveType;
    if (dateFrom || dateTo) {
      const startDateFilter: Record<string, unknown> = {};
      if (dateFrom) startDateFilter.gte = new Date(dateFrom);
      if (dateTo) startDateFilter.lte = new Date(dateTo);
      baseWhere.startDate = startDateFilter;
    }

    return this.paginateLeaves(baseWhere, status, page, limit, skip, true);
  }

  // -------------------------------------------------------------------------
  // Employee — List all approved requests (unpaginated)
  // -------------------------------------------------------------------------

  async findMyApprovedLeaves(
    employeeId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<LeaveRequestResponseDto[]> {
    const now = new Date();
    const year = now.getFullYear();

    const from = dateFrom ? new Date(dateFrom) : new Date(year, 0, 1);
    const to = dateTo ? new Date(dateTo) : new Date(year, 11, 31, 23, 59, 59);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    if (to < from) {
      throw new BadRequestException('dateTo must be greater than or equal to dateFrom');
    }

    const leaves = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId,
        status: LeaveStatus.APPROVED,
        startDate: { gte: from, lte: to },
      },
      select: LEAVE_REQUEST_SELECT_FIELDS,
      orderBy: { startDate: 'desc' },
      take: 2000,
    });

    return leaves.map((l) => this.toDto(l as LeaveRequestWithRelations, true));
  }

  // -------------------------------------------------------------------------
  // Employee — Get single own request
  // -------------------------------------------------------------------------

  async getMyLeave(leaveRequestId: string, employeeId: string): Promise<LeaveRequestResponseDto> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      select: LEAVE_REQUEST_SELECT_FIELDS,
    });

    if (!request) {
      throw new NotFoundException(`Leave request ${leaveRequestId} not found`);
    }
    if (request.employeeId !== employeeId) {
      throw new ForbiddenException('You can only view your own leave requests');
    }

    return this.toDto(request as LeaveRequestWithRelations, true);
  }

  // -------------------------------------------------------------------------
  // Employee — Get leave balance
  // -------------------------------------------------------------------------

  async getMyBalance(employeeId: string, year?: number): Promise<LeaveBalanceResponseDto> {
    const targetYear = year ?? new Date().getFullYear();
    return this.computeBalance(employeeId, targetYear);
  }

  // -------------------------------------------------------------------------
  // Team Lead — List leave requests
  // -------------------------------------------------------------------------

  async findTeamLeadLeaves(
    teamLeadId: string,
    query: TeamLeadLeavesQueryDto,
  ): Promise<PaginatedLeavesResponseDto> {
    const { page = 1, limit = 20, status, leaveType, department, dateFrom, dateTo, search } = query;
    const skip = (page - 1) * limit;

    // Base scope: only employees who report to this team lead
    const whereClauses: Record<string, unknown>[] = [
      {
        reportingManagerId: teamLeadId,
      },
    ];

    if (leaveType) {
      whereClauses.push({ leaveType });
    }

    if (department) {
      whereClauses.push({
        employee: { departments: { has: department } },
      });
    }

    if (dateFrom || dateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (dateFrom) {
        dateFilter.gte = new Date(dateFrom);
      }
      if (dateTo) {
        dateFilter.lte = new Date(dateTo);
      }
      whereClauses.push({ startDate: dateFilter });
    }

    const normalizedSearch = search?.trim();
    if (normalizedSearch) {
      whereClauses.push({
        OR: [
          { reason: { contains: normalizedSearch, mode: 'insensitive' } },
          { employee: { name: { contains: normalizedSearch, mode: 'insensitive' } } },
          { employee: { email: { contains: normalizedSearch, mode: 'insensitive' } } },
        ],
      });
    }

    const baseWhere: Record<string, unknown> =
      whereClauses.length === 1 ? whereClauses[0] : { AND: whereClauses };

    // Default list status for TL view is PENDING when no explicit status filter is provided
    const effectiveStatus = status ?? LeaveStatus.PENDING;

    return this.paginateLeaves(baseWhere, effectiveStatus, page, limit, skip);
  }

  // -------------------------------------------------------------------------
  // Team Lead — Get single request
  // -------------------------------------------------------------------------

  async getLeaveForReview(
    leaveRequestId: string,
    teamLeadId: string,
  ): Promise<LeaveRequestResponseDto> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      select: LEAVE_REQUEST_SELECT_FIELDS,
    });

    if (!request) {
      throw new NotFoundException(`Leave request ${leaveRequestId} not found`);
    }
    if (request.reportingManagerId !== teamLeadId) {
      throw new ForbiddenException('You can only access leave requests assigned to you');
    }

    return this.toDto(request as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // Team Lead — Get employee balance (scoped)
  // -------------------------------------------------------------------------

  async getEmployeeBalanceForTeamLead(
    userId: string,
    teamLeadId: string,
    year?: number,
  ): Promise<LeaveBalanceResponseDto> {
    // Verify the TL has at least one leave request from this employee
    const count = await this.prisma.leaveRequest.count({
      where: { employeeId: userId, reportingManagerId: teamLeadId },
    });
    if (count === 0) {
      throw new ForbiddenException(
        'You can only view balance for employees who have submitted requests to you',
      );
    }
    const targetYear = year ?? new Date().getFullYear();
    return this.computeBalance(userId, targetYear);
  }

  // -------------------------------------------------------------------------
  // Team Lead — Approve
  // -------------------------------------------------------------------------

  async teamLeadApprove(
    leaveRequestId: string,
    teamLeadId: string,
    dto: ReviewLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto> {
    const request = await this.findRequestOrThrow(leaveRequestId);
    if (request.reportingManagerId !== teamLeadId) {
      throw new ForbiddenException('You can only review leave requests assigned to you');
    }

    this.validateStatusTransition(request.status, LeaveStatus.TEAM_LEAD_APPROVED);

    const updated = await this.prisma.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        status: LeaveStatus.TEAM_LEAD_APPROVED,
        teamLeadId,
        teamLeadComment: dto.comment.trim(),
        teamLeadReviewedAt: new Date(),
        requiresClientApproval: dto.requiresClientApproval ?? false,
      },
      select: LEAVE_REQUEST_SELECT_FIELDS,
    });

    this.logger.log(`Leave ${leaveRequestId} approved by team lead ${teamLeadId}`);

    this.eventEmitter.emit(
      'leave.teamLeadReviewed',
      new LeaveTeamLeadReviewedEvent(
        leaveRequestId,
        request.employee.id,
        request.employee.email,
        request.employee.name,
        teamLeadId,
        updated.teamLead?.name ?? '',
        LeaveStatus.TEAM_LEAD_APPROVED,
        dto.comment,
        request.leaveType as string,
        request.startDate,
        request.endDate,
        dto.requiresClientApproval ?? false,
      ),
    );

    return this.toDto(updated as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // Team Lead — Reject
  // -------------------------------------------------------------------------

  async teamLeadReject(
    leaveRequestId: string,
    teamLeadId: string,
    dto: ReviewLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto> {
    const request = await this.findRequestOrThrow(leaveRequestId);
    if (request.reportingManagerId !== teamLeadId) {
      throw new ForbiddenException('You can only review leave requests assigned to you');
    }

    this.validateStatusTransition(request.status, LeaveStatus.TEAM_LEAD_REJECTED);

    const updated = await this.prisma.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        status: LeaveStatus.TEAM_LEAD_REJECTED,
        teamLeadId,
        teamLeadComment: dto.comment.trim(),
        teamLeadReviewedAt: new Date(),
        requiresClientApproval: dto.requiresClientApproval ?? false,
      },
      select: LEAVE_REQUEST_SELECT_FIELDS,
    });

    this.logger.log(`Leave ${leaveRequestId} rejected by team lead ${teamLeadId}`);

    // TL rejection frees the pending WFH slot
    if (request.leaveType === LeaveType.WFH) {
      const leaveInfo = calculateLeaveDays(
        request.leaveType,
        request.startDate,
        request.endDate,
        request.halfDayPeriod as import('@prisma/client').HalfDayPeriod | undefined,
      );
      await this.adjustWfhMonthlyUsage(this.prisma, request.employee.id, request.startDate, {
        pending: -leaveInfo.daysConsumed,
      });
    }

    this.eventEmitter.emit(
      'leave.teamLeadReviewed',
      new LeaveTeamLeadReviewedEvent(
        leaveRequestId,
        request.employee.id,
        request.employee.email,
        request.employee.name,
        teamLeadId,
        updated.teamLead?.name ?? '',
        LeaveStatus.TEAM_LEAD_REJECTED,
        dto.comment,
        request.leaveType as string,
        request.startDate,
        request.endDate,
        dto.requiresClientApproval ?? false,
      ),
    );

    return this.toDto(updated as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // HR — List all requests
  // -------------------------------------------------------------------------

  async findHrLeaves(query: HrLeavesQueryDto): Promise<PaginatedLeavesResponseDto> {
    const {
      page = 1,
      limit = 20,
      status,
      leaveType,
      department,
      dateFrom,
      dateTo,
      employeeId,
      search,
      appliedByHr,
    } = query;
    const skip = (page - 1) * limit;

    const whereClauses: Record<string, unknown>[] = [];
    if (leaveType) {
      whereClauses.push({ leaveType });
    }
    if (employeeId) {
      whereClauses.push({ employeeId });
    }
    if (appliedByHr === true) {
      whereClauses.push({ appliedByHrId: { not: null } });
    }
    if (department) {
      whereClauses.push({
        employee: { departments: { has: department } },
      });
    }
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (dateFrom) {
        dateFilter.gte = new Date(dateFrom);
      }
      if (dateTo) {
        dateFilter.lte = new Date(dateTo);
      }
      whereClauses.push({ startDate: dateFilter });
    }

    const normalizedSearch = search?.trim();
    if (normalizedSearch) {
      whereClauses.push({
        OR: [
          { reason: { contains: normalizedSearch, mode: 'insensitive' } },
          { employee: { name: { contains: normalizedSearch, mode: 'insensitive' } } },
          { employee: { email: { contains: normalizedSearch, mode: 'insensitive' } } },
        ],
      });
    }

    const baseWhere: Record<string, unknown> =
      whereClauses.length === 0
        ? {}
        : whereClauses.length === 1
          ? whereClauses[0]
          : { AND: whereClauses };

    return this.paginateLeaves(baseWhere, status, page, limit, skip);
  }

  // -------------------------------------------------------------------------
  // HR — Get single request
  // -------------------------------------------------------------------------

  async getLeaveForManagement(leaveRequestId: string): Promise<LeaveRequestResponseDto> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      select: LEAVE_REQUEST_SELECT_FIELDS,
    });

    if (!request) {
      throw new NotFoundException(`Leave request ${leaveRequestId} not found`);
    }

    return this.toDto(request as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // HR — Final approve + deduct balance
  // -------------------------------------------------------------------------

  async hrApprove(
    leaveRequestId: string,
    hrId: string,
    dto: HrReviewLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto> {
    const request = await this.findRequestOrThrow(leaveRequestId);

    this.validateStatusTransition(request.status, LeaveStatus.APPROVED);

    const leaveInfo = calculateLeaveDays(
      request.leaveType,
      request.startDate,
      request.endDate,
      request.halfDayPeriod as import('@prisma/client').HalfDayPeriod | undefined,
    );

    const currentYear = request.startDate.getFullYear();

    // Determine Paid / Unpaid + unpaid days — HR override takes precedence
    let category: LeaveCategory;
    let unpaidDays: number;
    if (dto.category) {
      category = dto.category;
      unpaidDays = dto.category === LeaveCategory.UNPAID ? leaveInfo.daysConsumed : 0;
    } else {
      const computed = await this.computeLeaveCategory(request.employeeId, currentYear, leaveInfo);
      category = computed.category;
      unpaidDays = computed.unpaidDays;
    }

    // Atomic: update request + deduct balance
    const [updated] = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.leaveRequest.update({
        where: { id: leaveRequestId },
        data: {
          status: LeaveStatus.APPROVED,
          hrId,
          hrComment: dto.comment.trim(),
          hrReviewedAt: new Date(),
          category,
          unpaidDays,
        },
        select: LEAVE_REQUEST_SELECT_FIELDS,
      });

      // Deduct from appropriate balance
      if (leaveInfo.deductedFromCasual) {
        await this.upsertAndDeductBalance(
          tx,
          request.employeeId,
          currentYear,
          'casualUsed',
          leaveInfo.daysConsumed,
        );
      } else if (leaveInfo.deductedFromSick) {
        await this.upsertAndDeductBalance(
          tx,
          request.employeeId,
          currentYear,
          'sickUsed',
          leaveInfo.daysConsumed,
        );
      } else if (leaveInfo.isWfh) {
        // Move from pending → used. If came from TL_REJECTED, pending was already decremented.
        const pendingDelta =
          request.status === LeaveStatus.TEAM_LEAD_REJECTED ? 0 : -leaveInfo.daysConsumed;
        await this.adjustWfhMonthlyUsage(tx, request.employeeId, request.startDate, {
          used: leaveInfo.daysConsumed,
          pending: pendingDelta,
        });
      }

      return [updatedRequest];
    });

    this.logger.log(`Leave ${leaveRequestId} finally approved by HR ${hrId}`);

    this.eventEmitter.emit(
      'leave.approved',
      new LeaveApprovedEvent(
        leaveRequestId,
        request.employee.id,
        request.employee.email,
        request.employee.name,
        hrId,
        updated.hr?.name ?? '',
        dto.comment,
        request.leaveType as string,
        request.startDate,
        request.endDate,
        leaveInfo.daysConsumed,
        false,
        null,
        category,
      ),
    );

    return this.toDto(updated as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // HR — Final reject (no balance change)
  // -------------------------------------------------------------------------

  async hrReject(
    leaveRequestId: string,
    hrId: string,
    dto: HrReviewLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto> {
    const request = await this.findRequestOrThrow(leaveRequestId);

    this.validateStatusTransition(request.status, LeaveStatus.REJECTED);

    const updated = await this.prisma.leaveRequest.update({
      where: { id: leaveRequestId },
      data: {
        status: LeaveStatus.REJECTED,
        hrId,
        hrComment: dto.comment.trim(),
        hrReviewedAt: new Date(),
      },
      select: LEAVE_REQUEST_SELECT_FIELDS,
    });

    this.logger.log(`Leave ${leaveRequestId} rejected by HR ${hrId}`);

    // Free the pending WFH slot if it was still in-flight (not already freed by TL rejection)
    if (request.leaveType === LeaveType.WFH && request.status !== LeaveStatus.TEAM_LEAD_REJECTED) {
      const leaveInfo = calculateLeaveDays(
        request.leaveType,
        request.startDate,
        request.endDate,
        request.halfDayPeriod as import('@prisma/client').HalfDayPeriod | undefined,
      );
      await this.adjustWfhMonthlyUsage(this.prisma, request.employee.id, request.startDate, {
        pending: -leaveInfo.daysConsumed,
      });
    }

    this.eventEmitter.emit(
      'leave.rejected',
      new LeaveRejectedEvent(
        leaveRequestId,
        request.employee.id,
        request.employee.email,
        request.employee.name,
        hrId,
        updated.hr?.name ?? '',
        dto.comment,
        request.leaveType as string,
        request.startDate,
        request.endDate,
      ),
    );

    return this.toDto(updated as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // HR — Permanently delete a leave request
  // -------------------------------------------------------------------------

  async permanentlyDeleteLeave(leaveRequestId: string, hrId: string): Promise<void> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      select: {
        id: true,
        employeeId: true,
        status: true,
        leaveType: true,
        daysConsumed: true,
        startDate: true,
        endDate: true,
        halfDayPeriod: true,
        employee: { select: { name: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(`Leave request ${leaveRequestId} not found`);
    }

    await this.prisma.$transaction(async (tx) => {
      // Reverse balance if the leave was already approved
      if (request.status === LeaveStatus.APPROVED) {
        const leaveInfo = calculateLeaveDays(
          request.leaveType,
          request.startDate,
          request.endDate,
          request.halfDayPeriod as import('@prisma/client').HalfDayPeriod | undefined,
        );
        const year = request.startDate.getFullYear();
        const days = request.daysConsumed.toNumber();

        if (leaveInfo.deductedFromCasual) {
          await tx.leaveBalance.updateMany({
            where: { userId: request.employeeId, year },
            data: { casualUsed: { decrement: days } },
          });
        } else if (leaveInfo.deductedFromSick) {
          await tx.leaveBalance.updateMany({
            where: { userId: request.employeeId, year },
            data: { sickUsed: { decrement: days } },
          });
        } else if (leaveInfo.isWfh) {
          await this.adjustWfhMonthlyUsage(tx, request.employeeId, request.startDate, {
            used: -days,
          });
        }
      }

      // Free pending WFH slot if not yet approved/rejected
      if (
        request.leaveType === LeaveType.WFH &&
        (request.status === LeaveStatus.PENDING ||
          request.status === LeaveStatus.TEAM_LEAD_APPROVED)
      ) {
        const leaveInfo = calculateLeaveDays(request.leaveType, request.startDate, request.endDate);
        await this.adjustWfhMonthlyUsage(tx, request.employeeId, request.startDate, {
          pending: -leaveInfo.daysConsumed,
        });
      }

      await tx.leaveRequest.delete({ where: { id: leaveRequestId } });
    });

    this.logger.log(`Leave ${leaveRequestId} permanently deleted by HR ${hrId}`);

    this.eventEmitter.emit(
      'leave.deleted',
      new LeaveDeletedEvent(
        leaveRequestId,
        request.employeeId,
        request.employee.name,
        hrId,
        String(request.leaveType),
        String(request.status),
        request.startDate,
        request.endDate,
        request.daysConsumed.toNumber(),
        request.status === LeaveStatus.APPROVED,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // HR — Approve as WFH (converts leave type to WFH and approves)
  // -------------------------------------------------------------------------

  async hrApproveAsWfh(
    leaveRequestId: string,
    hrId: string,
    dto: HrReviewLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto> {
    const request = await this.findRequestOrThrow(leaveRequestId);

    this.validateStatusTransition(request.status, LeaveStatus.APPROVED);

    const [updated] = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.leaveRequest.update({
        where: { id: leaveRequestId },
        data: {
          status: LeaveStatus.APPROVED,
          originalLeaveType: request.leaveType,
          leaveType: LeaveType.WFH,
          hrId,
          hrComment: dto.comment.trim(),
          hrReviewedAt: new Date(),
          category: dto.category ?? LeaveCategory.PAID,
          unpaidDays: 0, // WFH never deducts from leave balance
        },
        select: LEAVE_REQUEST_SELECT_FIELDS,
      });

      // Increment WFH used counter. The original leave was non-WFH so there
      // is no pending WFH slot to decrement — just record the approved days.
      await this.adjustWfhMonthlyUsage(tx, request.employeeId, request.startDate, {
        used: request.daysConsumed.toNumber(),
      });
      // Casual/sick balance stays unchanged — WFH conversion doesn't touch leave quota

      return [updatedRequest];
    });

    this.logger.log(`Leave ${leaveRequestId} converted to WFH and approved by HR ${hrId}`);

    this.eventEmitter.emit(
      'leave.approved',
      new LeaveApprovedEvent(
        leaveRequestId,
        request.employee.id,
        request.employee.email,
        request.employee.name,
        hrId,
        updated.hr?.name ?? '',
        dto.comment,
        LeaveType.WFH,
        request.startDate,
        request.endDate,
        request.daysConsumed.toNumber(),
        true,
        request.leaveType as string,
        dto.category ?? LeaveCategory.PAID,
      ),
    );

    return this.toDto(updated as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // HR — Apply special leave on behalf of employee
  // -------------------------------------------------------------------------

  async hrApplySpecialLeave(
    hrId: string,
    dto: HrApplySpecialLeaveDto,
  ): Promise<LeaveRequestResponseDto> {
    const SPECIAL_LEAVE_TYPES: LeaveType[] = [
      LeaveType.MATERNITY,
      LeaveType.WEDDING,
      LeaveType.UMRAH_HAJJ,
      LeaveType.OTHER,
      LeaveType.WFH,
    ];

    if (!SPECIAL_LEAVE_TYPES.includes(dto.leaveType)) {
      throw new BadRequestException(
        `Only special leave types can be applied by HR: ${SPECIAL_LEAVE_TYPES.join(', ')}`,
      );
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be greater than or equal to startDate');
    }

    // Validate employee exists
    const employee = await this.prisma.user.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, name: true, email: true, joiningDate: true },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${dto.employeeId} not found`);
    }

    // Calculate days consumed
    const leaveInfo = calculateLeaveDays(dto.leaveType, startDate, endDate);

    // Maternity: validate 22-day ceiling
    if (dto.leaveType === LeaveType.MATERNITY) {
      const currentYear = startDate.getFullYear();
      const usedMaternityDays = await this.getTotalApprovedMaternityDays(
        dto.employeeId,
        currentYear,
      );
      if (usedMaternityDays + leaveInfo.daysConsumed > MATERNITY_MAX_DAYS) {
        this.logger.warn(
          `Policy warning: HR applying maternity leave that exceeds annual ceiling. ` +
            `Quota: ${MATERNITY_MAX_DAYS}d. Already approved: ${usedMaternityDays}d. Requested: ${leaveInfo.daysConsumed}d.`,
        );
      }
    }

    const currentYear = startDate.getFullYear();

    // Determine Paid / Unpaid — HR override takes precedence
    let category: LeaveCategory;
    let unpaidDays: number;
    if (dto.category) {
      category = dto.category;
      unpaidDays = dto.category === LeaveCategory.UNPAID ? leaveInfo.daysConsumed : 0;
    } else {
      const computed = await this.computeLeaveCategory(dto.employeeId, currentYear, leaveInfo);
      category = computed.category;
      unpaidDays = computed.unpaidDays;
    }

    // Atomic: create request as APPROVED + deduct balance
    const [leaveRequest] = await this.prisma.$transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: {
          employeeId: dto.employeeId,
          reportingManagerId: hrId, // HR acts as both applicant and reviewer
          leaveType: dto.leaveType,
          status: LeaveStatus.APPROVED,
          startDate,
          endDate,
          daysConsumed: leaveInfo.daysConsumed,
          reason: dto.reason.trim(),
          medicalCertificateUrl: dto.medicalCertificateUrl ?? null,
          hrId,
          hrComment: dto.comment?.trim() ?? 'Applied by HR on behalf of employee',
          hrReviewedAt: new Date(),
          appliedByHrId: hrId,
          category,
          unpaidDays,
        },
        select: LEAVE_REQUEST_SELECT_FIELDS,
      });

      // Deduct from appropriate balance
      if (leaveInfo.deductedFromCasual) {
        await this.upsertAndDeductBalance(
          tx,
          dto.employeeId,
          currentYear,
          'casualUsed',
          leaveInfo.daysConsumed,
        );
      } else if (leaveInfo.deductedFromSick) {
        await this.upsertAndDeductBalance(
          tx,
          dto.employeeId,
          currentYear,
          'sickUsed',
          leaveInfo.daysConsumed,
        );
      } else if (leaveInfo.isWfh) {
        // HR-applied WFH: directly mark as used (no pending stage since request is created as APPROVED)
        await this.adjustWfhMonthlyUsage(tx, dto.employeeId, startDate, {
          used: leaveInfo.daysConsumed,
        });
      }

      return [created];
    });

    this.logger.log(
      `Special leave ${leaveRequest.id} (${dto.leaveType}) applied by HR ${hrId} for employee ${dto.employeeId}`,
    );

    this.eventEmitter.emit(
      'leave.approved',
      new LeaveApprovedEvent(
        leaveRequest.id,
        dto.employeeId,
        employee.email,
        employee.name,
        hrId,
        leaveRequest.hr?.name ?? '',
        dto.comment ?? 'Applied by HR on behalf of employee',
        dto.leaveType,
        startDate,
        endDate,
        leaveInfo.daysConsumed,
        false,
        null,
        category,
      ),
    );

    return this.toDto(leaveRequest as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // HR — Modify any leave request (dates, type, status, reason)
  // -------------------------------------------------------------------------

  async hrModifyLeave(
    leaveRequestId: string,
    hrId: string,
    dto: HrModifyLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto> {
    const request = await this.findRequestOrThrow(leaveRequestId);

    const currentStatus = request.status;

    // Cannot modify cancelled leaves (terminal and immutable)
    if (currentStatus === LeaveStatus.CANCELLED) {
      throw new BadRequestException(`Cannot modify a leave request that is already CANCELLED.`);
    }

    // Validate force-status if provided
    if (dto.status && !HR_FORCE_ALLOWED_FROM.includes(currentStatus)) {
      throw new BadRequestException(
        `Cannot change status from '${currentStatus}' via HR modification.`,
      );
    }

    // Resolve new values (fall back to current if not supplied)
    const newStartDate = dto.startDate ? new Date(dto.startDate) : request.startDate;
    const newEndDate = dto.endDate ? new Date(dto.endDate) : request.endDate;
    const newLeaveType = dto.leaveType ?? request.leaveType;
    const newHalfDayPeriod = dto.halfDayPeriod ?? request.halfDayPeriod;

    if (newEndDate < newStartDate) {
      throw new BadRequestException('endDate must be greater than or equal to startDate');
    }

    const detailsChanged =
      dto.startDate !== undefined ||
      dto.endDate !== undefined ||
      dto.leaveType !== undefined ||
      dto.halfDayPeriod !== undefined;

    const wasBalanceEffective = BALANCE_EFFECTIVE_STATUSES.includes(currentStatus);
    const wasWfhPending =
      request.leaveType === LeaveType.WFH && WFH_PENDING_STATUSES.includes(currentStatus);

    // Calculate old and new leave info
    const oldLeaveInfo = calculateLeaveDays(
      request.leaveType,
      request.startDate,
      request.endDate,
      request.halfDayPeriod as HalfDayPeriod | undefined,
    );
    const newLeaveInfo = calculateLeaveDays(
      newLeaveType,
      newStartDate,
      newEndDate,
      newHalfDayPeriod ?? undefined,
    );

    // Determine new status
    let newStatus: LeaveStatus;
    if (dto.status) {
      newStatus = dto.status;
    } else if (wasBalanceEffective && detailsChanged) {
      newStatus = LeaveStatus.MODIFIED;
    } else {
      newStatus = currentStatus;
    }

    const willBeBalanceEffective = BALANCE_EFFECTIVE_STATUSES.includes(newStatus);
    const willBeWfhPending =
      newLeaveType === LeaveType.WFH && WFH_PENDING_STATUSES.includes(newStatus);

    const currentYear = newStartDate.getFullYear();

    const [updated] = await this.prisma.$transaction(async (tx) => {
      // --- Reverse old balance effects ---
      if (wasBalanceEffective) {
        if (oldLeaveInfo.deductedFromCasual) {
          await this.reverseBalanceDeduction(
            tx,
            request.employeeId,
            request.startDate.getFullYear(),
            'casualUsed',
            oldLeaveInfo.daysConsumed,
          );
        } else if (oldLeaveInfo.deductedFromSick) {
          await this.reverseBalanceDeduction(
            tx,
            request.employeeId,
            request.startDate.getFullYear(),
            'sickUsed',
            oldLeaveInfo.daysConsumed,
          );
        } else if (oldLeaveInfo.isWfh) {
          await this.adjustWfhMonthlyUsage(tx, request.employeeId, request.startDate, {
            used: -oldLeaveInfo.daysConsumed,
          });
        }
      }

      // --- Reverse WFH pending slot if previously in-flight ---
      if (wasWfhPending) {
        await this.adjustWfhMonthlyUsage(tx, request.employeeId, request.startDate, {
          pending: -oldLeaveInfo.daysConsumed,
        });
      }

      // --- Compute category using transactional state (after reversal) ---
      let category = request.category;
      let unpaidDays = request.unpaidDays.toNumber();

      if (willBeBalanceEffective) {
        if (dto.category) {
          category = dto.category;
          unpaidDays = dto.category === LeaveCategory.UNPAID ? newLeaveInfo.daysConsumed : 0;
        } else if (detailsChanged || !wasBalanceEffective) {
          if (newLeaveInfo.isWfh) {
            category = LeaveCategory.PAID;
            unpaidDays = 0;
          } else {
            const balance = await tx.leaveBalance.findUnique({
              where: { userId_year: { userId: request.employeeId, year: currentYear } },
            });
            const remaining = newLeaveInfo.deductedFromCasual
              ? balance
                ? Number(balance.casualBalance) - Number(balance.casualUsed)
                : 0
              : newLeaveInfo.deductedFromSick
                ? balance
                  ? Number(balance.sickBalance) - Number(balance.sickUsed)
                  : 0
                : Infinity;

            if (newLeaveInfo.daysConsumed <= remaining) {
              category = LeaveCategory.PAID;
              unpaidDays = 0;
            } else {
              category = LeaveCategory.UNPAID;
              unpaidDays = Math.max(0, newLeaveInfo.daysConsumed - Math.max(0, remaining));
            }
          }
        }
      }

      // --- Apply new balance effects ---
      if (willBeBalanceEffective) {
        if (newLeaveInfo.deductedFromCasual) {
          await this.upsertAndDeductBalance(
            tx,
            request.employeeId,
            currentYear,
            'casualUsed',
            newLeaveInfo.daysConsumed,
          );
        } else if (newLeaveInfo.deductedFromSick) {
          await this.upsertAndDeductBalance(
            tx,
            request.employeeId,
            currentYear,
            'sickUsed',
            newLeaveInfo.daysConsumed,
          );
        } else if (newLeaveInfo.isWfh) {
          await this.adjustWfhMonthlyUsage(tx, request.employeeId, newStartDate, {
            used: newLeaveInfo.daysConsumed,
          });
        }
      } else if (willBeWfhPending) {
        await this.adjustWfhMonthlyUsage(tx, request.employeeId, newStartDate, {
          pending: newLeaveInfo.daysConsumed,
        });
      }

      // --- Update the leave request ---
      // Preserve the very first originalLeaveType (only set if not already stored)
      const typeChanging = newLeaveType !== request.leaveType;
      const preservedOriginalType =
        request.originalLeaveType ?? (typeChanging ? request.leaveType : null);

      const updatedRequest = await tx.leaveRequest.update({
        where: { id: leaveRequestId },
        data: {
          status: newStatus,
          leaveType: newLeaveType,
          startDate: newStartDate,
          endDate: newEndDate,
          halfDayPeriod: newHalfDayPeriod ?? null,
          daysConsumed: newLeaveInfo.daysConsumed,
          ...(dto.reason !== undefined ? { reason: dto.reason.trim() } : {}),
          ...(preservedOriginalType ? { originalLeaveType: preservedOriginalType } : {}),
          modifiedAt: new Date(),
          modifiedByHrId: hrId,
          modificationReason: dto.comment.trim(),
          ...(willBeBalanceEffective ? { category, unpaidDays } : {}),
        },
        select: LEAVE_REQUEST_SELECT_FIELDS,
      });

      return [updatedRequest];
    });

    this.logger.log(
      `Leave ${leaveRequestId} modified by HR ${hrId}: ${currentStatus}→${newStatus}, ` +
        `type: ${request.leaveType}→${newLeaveType}, days: ${oldLeaveInfo.daysConsumed}→${newLeaveInfo.daysConsumed}`,
    );

    this.eventEmitter.emit(
      'leave.modified',
      new LeaveModifiedEvent(
        leaveRequestId,
        request.employee.id,
        request.employee.email,
        request.employee.name,
        hrId,
        updated.modifiedByHr?.name ?? '',
        dto.comment,
        request.leaveType as string,
        newLeaveType,
        request.startDate,
        newStartDate,
        request.endDate,
        newEndDate,
        oldLeaveInfo.daysConsumed,
        newLeaveInfo.daysConsumed,
        currentStatus,
        newStatus,
      ),
    );

    return this.toDto(updated as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // HR — Split a leave request into multiple parts
  // -------------------------------------------------------------------------

  async hrSplitLeave(
    leaveRequestId: string,
    hrId: string,
    dto: HrSplitLeaveRequestDto,
  ): Promise<LeaveRequestResponseDto[]> {
    const request = await this.findRequestOrThrow(leaveRequestId);

    const currentStatus = request.status;

    if (currentStatus === LeaveStatus.CANCELLED || currentStatus === LeaveStatus.REJECTED) {
      throw new BadRequestException(
        `Cannot split a leave request that is already ${currentStatus}.`,
      );
    }

    if (!dto.splits || dto.splits.length === 0) {
      throw new BadRequestException('At least one split portion is required');
    }

    const wasBalanceEffective = BALANCE_EFFECTIVE_STATUSES.includes(currentStatus);
    const wasWfhPending =
      request.leaveType === LeaveType.WFH && WFH_PENDING_STATUSES.includes(currentStatus);

    const oldLeaveInfo = calculateLeaveDays(
      request.leaveType,
      request.startDate,
      request.endDate,
      request.halfDayPeriod as HalfDayPeriod | undefined,
    );

    // Validate and pre-process each split portion
    const splitDatas = dto.splits.map((split: SplitPartDto) => {
      const startDate = new Date(split.startDate);
      const endDate = new Date(split.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid date format in one of the split portions');
      }
      if (endDate < startDate) {
        throw new BadRequestException(
          `endDate must be >= startDate in split portion (${split.startDate} → ${split.endDate})`,
        );
      }
      const leaveInfo = calculateLeaveDays(
        split.leaveType,
        startDate,
        endDate,
        split.halfDayPeriod,
      );
      return { ...split, startDate, endDate, leaveInfo };
    });

    const createdLeaves = await this.prisma.$transaction(async (tx) => {
      // Step 1: Cancel the original leave
      await tx.leaveRequest.update({
        where: { id: leaveRequestId },
        data: {
          status: LeaveStatus.CANCELLED,
          modifiedAt: new Date(),
          modifiedByHrId: hrId,
          modificationReason: `Split by HR: ${dto.comment.trim()}`,
        },
      });

      // Step 2: Reverse old balance effects
      if (wasBalanceEffective) {
        if (oldLeaveInfo.deductedFromCasual) {
          await this.reverseBalanceDeduction(
            tx,
            request.employeeId,
            request.startDate.getFullYear(),
            'casualUsed',
            oldLeaveInfo.daysConsumed,
          );
        } else if (oldLeaveInfo.deductedFromSick) {
          await this.reverseBalanceDeduction(
            tx,
            request.employeeId,
            request.startDate.getFullYear(),
            'sickUsed',
            oldLeaveInfo.daysConsumed,
          );
        } else if (oldLeaveInfo.isWfh) {
          await this.adjustWfhMonthlyUsage(tx, request.employeeId, request.startDate, {
            used: -oldLeaveInfo.daysConsumed,
          });
        }
      }

      // Step 3: Reverse WFH pending slot
      if (wasWfhPending) {
        await this.adjustWfhMonthlyUsage(tx, request.employeeId, request.startDate, {
          pending: -oldLeaveInfo.daysConsumed,
        });
      }

      // Step 4: Create new APPROVED split leaves and apply their balance effects.
      // Categories are computed inside the transaction (using tx) so they see the
      // correct balance after the original leave's deduction has been reversed and
      // after previous splits have been applied.
      const results: LeaveRequestWithRelations[] = [];
      for (let i = 0; i < splitDatas.length; i++) {
        const split = splitDatas[i];
        const currentYear = split.startDate.getFullYear();

        // Compute category using transactional state (reflects reversal + prior splits)
        let category: LeaveCategory;
        let unpaidDays: number;
        if (split.category) {
          category = split.category;
          unpaidDays = split.category === LeaveCategory.UNPAID ? split.leaveInfo.daysConsumed : 0;
        } else if (split.leaveInfo.isWfh) {
          category = LeaveCategory.PAID;
          unpaidDays = 0;
        } else {
          const balance = await tx.leaveBalance.findUnique({
            where: { userId_year: { userId: request.employeeId, year: currentYear } },
          });
          const remaining = split.leaveInfo.deductedFromCasual
            ? balance
              ? Number(balance.casualBalance) - Number(balance.casualUsed)
              : 0
            : split.leaveInfo.deductedFromSick
              ? balance
                ? Number(balance.sickBalance) - Number(balance.sickUsed)
                : 0
              : Infinity;

          if (split.leaveInfo.daysConsumed <= remaining) {
            category = LeaveCategory.PAID;
            unpaidDays = 0;
          } else {
            category = LeaveCategory.UNPAID;
            unpaidDays = Math.max(0, split.leaveInfo.daysConsumed - Math.max(0, remaining));
          }
        }

        // Apply balance deduction BEFORE creating the next split so subsequent
        // splits see the updated balance.
        if (split.leaveInfo.deductedFromCasual) {
          await this.upsertAndDeductBalance(
            tx,
            request.employeeId,
            currentYear,
            'casualUsed',
            split.leaveInfo.daysConsumed,
          );
        } else if (split.leaveInfo.deductedFromSick) {
          await this.upsertAndDeductBalance(
            tx,
            request.employeeId,
            currentYear,
            'sickUsed',
            split.leaveInfo.daysConsumed,
          );
        } else if (split.leaveInfo.isWfh) {
          await this.adjustWfhMonthlyUsage(tx, request.employeeId, split.startDate, {
            used: split.leaveInfo.daysConsumed,
          });
        }

        const created = await tx.leaveRequest.create({
          data: {
            employeeId: request.employeeId,
            reportingManagerId: request.reportingManagerId,
            leaveType: split.leaveType,
            status: LeaveStatus.APPROVED,
            startDate: split.startDate,
            endDate: split.endDate,
            halfDayPeriod: split.halfDayPeriod ?? null,
            daysConsumed: split.leaveInfo.daysConsumed,
            reason: request.reason,
            medicalCertificateUrl: request.medicalCertificateUrl,
            hrId,
            hrComment: dto.comment.trim(),
            hrReviewedAt: new Date(),
            appliedByHrId: hrId,
            modifiedByHrId: hrId,
            modifiedAt: new Date(),
            modificationReason: `Split by HR: ${dto.comment.trim()}`,
            category,
            unpaidDays,
          },
          select: LEAVE_REQUEST_SELECT_FIELDS,
        });

        results.push(created);
      }

      return results;
    });

    this.logger.log(
      `Leave ${leaveRequestId} split into ${createdLeaves.length} parts by HR ${hrId}`,
    );

    // Emit approved event for each new split leave
    for (const created of createdLeaves) {
      const typed = created;
      this.eventEmitter.emit(
        'leave.approved',
        new LeaveApprovedEvent(
          typed.id,
          request.employee.id,
          request.employee.email,
          request.employee.name,
          hrId,
          typed.hr?.name ?? '',
          dto.comment,
          typed.leaveType,
          typed.startDate,
          typed.endDate,
          typed.daysConsumed.toNumber(),
          false,
          null,
          typed.category as LeaveCategory | null,
        ),
      );
    }

    return createdLeaves.map((r) => this.toDto(r));
  }

  // -------------------------------------------------------------------------
  // HR — Update leave type access flags for an employee
  // -------------------------------------------------------------------------

  async updateEmployeeLeaveTypeAccess(
    userId: string,
    dto: UpdateLeaveTypeAccessDto,
  ): Promise<AllowedLeaveTypesResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.allowMaternityLeave !== undefined && {
          allowMaternityLeave: dto.allowMaternityLeave,
        }),
        ...(dto.allowWeddingLeave !== undefined && {
          allowWeddingLeave: dto.allowWeddingLeave,
        }),
        ...(dto.allowUmrahHajjLeave !== undefined && {
          allowUmrahHajjLeave: dto.allowUmrahHajjLeave,
        }),
        ...(dto.allowOtherLeave !== undefined && {
          allowOtherLeave: dto.allowOtherLeave,
        }),
        ...(dto.allowExtraWfh !== undefined && {
          allowExtraWfh: dto.allowExtraWfh,
        }),
      },
      select: {
        allowMaternityLeave: true,
        allowWeddingLeave: true,
        allowUmrahHajjLeave: true,
        allowOtherLeave: true,
        allowExtraWfh: true,
      },
    });

    // Bust the user cache so the next getUserById call reflects the new flags
    await this.cacheManager.del(`user:${userId}`);

    return this.buildAllowedLeaveTypesResponse(updated);
  }

  // -------------------------------------------------------------------------
  // Employee — Get allowed leave types for own account
  // -------------------------------------------------------------------------

  async getMyAllowedLeaveTypes(employeeId: string): Promise<AllowedLeaveTypesResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: employeeId },
      select: {
        allowMaternityLeave: true,
        allowWeddingLeave: true,
        allowUmrahHajjLeave: true,
        allowOtherLeave: true,
        allowExtraWfh: true,
      },
    });
    if (!user) {
      throw new NotFoundException('Employee not found');
    }

    return this.buildAllowedLeaveTypesResponse(user);
  }

  // -------------------------------------------------------------------------
  // HR — Get any employee's leave balance
  // -------------------------------------------------------------------------

  async getEmployeeBalance(userId: string, year?: number): Promise<LeaveBalanceResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    const targetYear = year ?? new Date().getFullYear();
    return this.computeBalance(userId, targetYear);
  }

  // -------------------------------------------------------------------------
  // HR — Stats summary
  // -------------------------------------------------------------------------

  async getHrStats(year?: number, department?: string): Promise<HrStatsResponseDto> {
    const targetYear = year ?? new Date().getFullYear();

    const yearStart = new Date(targetYear, 0, 1);
    const yearEnd = new Date(targetYear, 11, 31, 23, 59, 59);

    const baseWhere: Record<string, unknown> = {
      startDate: { gte: yearStart, lte: yearEnd },
    };
    if (department) {
      baseWhere.employee = { departments: { has: department } };
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const todayAbsentWhere: Record<string, unknown> = {
      status: { in: [LeaveStatus.APPROVED, LeaveStatus.MODIFIED] },
      startDate: { lte: todayEnd },
      endDate: { gte: todayStart },
    };
    if (department) {
      todayAbsentWhere.employee = { departments: { has: department } };
    }

    const [statusGroups, typeGroups, todayAbsentIds, totalActiveEmployees] =
      await this.prisma.$transaction([
        this.prisma.leaveRequest.groupBy({
          by: ['status'],
          where: baseWhere as never,
          orderBy: { status: 'asc' },
          _count: true,
        }),
        this.prisma.leaveRequest.groupBy({
          by: ['leaveType', 'status'],
          where: baseWhere as never,
          orderBy: { leaveType: 'asc' },
          _count: true,
        }),
        this.prisma.leaveRequest.findMany({
          where: todayAbsentWhere as never,
          select: { employeeId: true },
          distinct: ['employeeId'],
        }),
        this.prisma.user.count({
          where: {
            isSystem: false,
            approvalStatus: 'APPROVED',
            employeeStatus: 'ACTIVE',
            ...(department ? { departments: { has: department } } : {}),
          },
        }),
      ]);

    const countByStatus = (status: LeaveStatus) =>
      Number(statusGroups.find((g) => g.status === status)?._count ?? 0);

    const total = statusGroups.reduce((sum, g) => sum + Number(g._count ?? 0), 0);
    const countByStatusInclModified = (status: LeaveStatus) =>
      status === LeaveStatus.APPROVED
        ? countByStatus(LeaveStatus.APPROVED) + countByStatus(LeaveStatus.MODIFIED)
        : countByStatus(status);

    // Build per-type stats
    const typeMap = new Map<
      string,
      { total: number; approved: number; rejected: number; pending: number }
    >();
    for (const row of typeGroups) {
      const type = row.leaveType as string;
      const cnt = Number(row._count ?? 0);
      if (!typeMap.has(type)) {
        typeMap.set(type, { total: 0, approved: 0, rejected: 0, pending: 0 });
      }
      const entry = typeMap.get(type)!;
      entry.total += cnt;
      if (row.status === LeaveStatus.APPROVED) entry.approved += cnt;
      else if (row.status === LeaveStatus.REJECTED) entry.rejected += cnt;
      else if (
        row.status === LeaveStatus.PENDING ||
        row.status === LeaveStatus.TEAM_LEAD_APPROVED ||
        row.status === LeaveStatus.TEAM_LEAD_REJECTED
      ) {
        entry.pending += cnt;
      }
    }

    const todayAbsent = todayAbsentIds.length;
    const todayPresent = Math.max(0, totalActiveEmployees - todayAbsent);

    return {
      year: targetYear,
      department: department ?? null,
      total,
      totalPending: countByStatus(LeaveStatus.PENDING),
      totalPendingHr:
        countByStatus(LeaveStatus.TEAM_LEAD_APPROVED) +
        countByStatus(LeaveStatus.TEAM_LEAD_REJECTED),
      totalApproved: countByStatusInclModified(LeaveStatus.APPROVED),
      totalRejected: countByStatus(LeaveStatus.REJECTED),
      todayAbsent,
      todayPresent,
      byLeaveType: [...typeMap.entries()].map(([leaveType, stats]) => ({
        leaveType,
        ...stats,
      })),
    };
  }

  async getAbsentEmployees(
    date?: string,
    department?: string,
  ): Promise<LeaveRequestWithRelations[]> {
    const target = date ? new Date(date) : new Date();
    const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 0, 0, 0);
    const dayEnd = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59, 59);
    const where: Record<string, unknown> = {
      status: { in: [LeaveStatus.APPROVED, LeaveStatus.MODIFIED] },
      startDate: { lte: dayEnd },
      endDate: { gte: dayStart },
    };
    if (department) where.employee = { departments: { has: department } };
    return this.prisma.leaveRequest.findMany({
      where: where as never,
      select: LEAVE_REQUEST_SELECT_FIELDS,
      orderBy: { employee: { name: 'asc' } },
    }) as unknown as LeaveRequestWithRelations[];
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private validateStatusTransition(from: LeaveStatus, to: LeaveStatus): void {
    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed?.includes(to)) {
      throw new BadRequestException(`Cannot change leave status from '${from}' to '${to}'`);
    }
  }

  private async findRequestOrThrow(leaveRequestId: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      select: {
        ...LEAVE_REQUEST_SELECT_FIELDS,
        status: true,
        leaveType: true,
        startDate: true,
        endDate: true,
        halfDayPeriod: true,
        daysConsumed: true,
      },
    });

    if (!request) {
      throw new NotFoundException(`Leave request ${leaveRequestId} not found`);
    }

    return request;
  }

  private async validatePolicyRules(
    employeeId: string,
    dto: CreateLeaveRequestDto,
    employee: { joiningDate: Date | null },
    startDate: Date,
    endDate: Date,
    daysConsumed: number,
  ): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDateAtMidnight = new Date(startDate);
    startDateAtMidnight.setHours(0, 0, 0, 0);

    const diffDays = Math.floor(
      (startDateAtMidnight.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    );

    // Hard rule: cannot apply for leave in the past
    if (startDateAtMidnight < today) {
      throw new BadRequestException('You cannot apply for leave on past dates');
    }

    // Sick/Emergency can be submitted same-day (no advance notice required).
    // For other types we now treat advance notice rules as "soft" policy warnings
    // instead of hard blockers: the UI surfaces warnings to the employee,
    // team lead, and HR, but the backend allows submission.
    if (dto.leaveType !== LeaveType.SICK) {
      if (dto.leaveType === LeaveType.WFH) {
        if (diffDays < WFH_ADVANCE_NOTICE_DAYS) {
          this.logger.warn(
            `Policy warning: WFH requested with only ${diffDays} day(s) notice (minimum ${WFH_ADVANCE_NOTICE_DAYS}).`,
          );
        }
      } else if (daysConsumed >= 2) {
        if (diffDays < MULTI_DAY_ADVANCE_NOTICE_DAYS) {
          this.logger.warn(
            `Policy warning: multi-day (${daysConsumed} day[s]) leave requested with only ${diffDays} day(s) notice (minimum ${MULTI_DAY_ADVANCE_NOTICE_DAYS}).`,
          );
        }
      } else {
        if (diffDays < CASUAL_ADVANCE_NOTICE_DAYS) {
          this.logger.warn(
            `Policy warning: ${dto.leaveType} leave requested with only ${diffDays} day(s) notice (minimum ${CASUAL_ADVANCE_NOTICE_DAYS}).`,
          );
        }
      }
    }

    // UMRAH_HAJJ: requires 1 year of service
    if (dto.leaveType === LeaveType.UMRAH_HAJJ) {
      if (!employee.joiningDate) {
        this.logger.warn(
          'Policy warning: Umrah/Hajj requested without a recorded joining date; eligibility cannot be verified.',
        );
      } else {
        const monthsOfService =
          (startDate.getFullYear() - employee.joiningDate.getFullYear()) * 12 +
          (startDate.getMonth() - employee.joiningDate.getMonth());
        if (monthsOfService < UMRAH_HAJJ_MIN_SERVICE_MONTHS) {
          this.logger.warn(
            `Policy warning: Umrah/Hajj leave requested with ${monthsOfService} month(s) of service (minimum ${UMRAH_HAJJ_MIN_SERVICE_MONTHS}).`,
          );
        }
      }
      if (daysConsumed > UMRAH_HAJJ_MAX_DAYS) {
        this.logger.warn(
          `Policy warning: Umrah/Hajj leave requested for ${daysConsumed} day(s) (maximum ${UMRAH_HAJJ_MAX_DAYS}). Extra days may be unpaid per policy.`,
        );
      }
    }

    // WEDDING: maximum 5 days (soft policy warning — allow submission)
    if (dto.leaveType === LeaveType.WEDDING && daysConsumed > WEDDING_MAX_DAYS) {
      this.logger.warn(
        `Policy warning: Wedding leave requested for ${daysConsumed} day(s) (maximum ${WEDDING_MAX_DAYS}). Extra days may be unpaid per policy.`,
      );
    }

    // WFH: per-employee monthly allowance cap — HARD policy (bypassed if allowExtraWfh is set)
    if (dto.leaveType === LeaveType.WFH) {
      const employeeRecord = await this.prisma.user.findUnique({
        where: { id: employeeId },
        select: { wfhAllowancePerMonth: true, allowExtraWfh: true },
      });

      // HR has granted an extra-WFH override for this employee — skip the cap
      if (employeeRecord?.allowExtraWfh) {
        return;
      }

      const wfhAllowance =
        typeof employeeRecord?.wfhAllowancePerMonth === 'number'
          ? employeeRecord.wfhAllowancePerMonth
          : WFH_PER_MONTH;

      const year = startDate.getFullYear();
      const month = startDate.getMonth() + 1;
      const wfhUsage = await this.prisma.wfhMonthlyUsage.findUnique({
        where: { userId_year_month: { userId: employeeId, year, month } },
      });
      const existingWfhDays = wfhUsage ? Number(wfhUsage.used) + Number(wfhUsage.pending) : 0;

      if (existingWfhDays + daysConsumed > wfhAllowance) {
        throw new BadRequestException(
          `WFH allowance for this month is exhausted. You have already used ${existingWfhDays} of ${wfhAllowance} WFH day(s) allowed this month.`,
        );
      }
    }
  }

  private async getOrCreateLeaveBalance(userId: string, year: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        joiningDate: true,
        casualLeaveBalance: true,
        sickLeaveBalance: true,
      },
    });

    const joiningDate = user?.joiningDate ?? new Date(year, 0, 1);

    // If HR has configured explicit balances on the user, treat them as
    // authoritative. Fall back to pro-rata only when no explicit values exist.
    const casualQuota =
      typeof user?.casualLeaveBalance === 'number'
        ? user.casualLeaveBalance
        : computeProRataCasualQuota(joiningDate, year);

    const sickQuota =
      typeof user?.sickLeaveBalance === 'number'
        ? user.sickLeaveBalance
        : computeProRataSickQuota(joiningDate, year);

    return this.prisma.leaveBalance.upsert({
      where: { userId_year: { userId, year } },
      create: {
        userId,
        year,
        casualBalance: casualQuota,
        sickBalance: sickQuota,
        casualUsed: 0,
        sickUsed: 0,
      },
      update: {},
    });
  }

  private async reverseBalanceDeduction(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0] | PrismaService,
    userId: string,
    year: number,
    field: 'casualUsed' | 'sickUsed',
    amount: number,
  ): Promise<void> {
    await (tx as PrismaService).leaveBalance.updateMany({
      where: { userId, year },
      data: { [field]: { decrement: amount } },
    });
  }

  private async upsertAndDeductBalance(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    userId: string,
    year: number,
    field: 'casualUsed' | 'sickUsed',
    amount: number,
  ): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        joiningDate: true,
        casualLeaveBalance: true,
        sickLeaveBalance: true,
      },
    });

    const joiningDate = user?.joiningDate ?? new Date(year, 0, 1);

    const casualQuota =
      typeof user?.casualLeaveBalance === 'number'
        ? user.casualLeaveBalance
        : computeProRataCasualQuota(joiningDate, year);

    const sickQuota =
      typeof user?.sickLeaveBalance === 'number'
        ? user.sickLeaveBalance
        : computeProRataSickQuota(joiningDate, year);

    await tx.leaveBalance.upsert({
      where: { userId_year: { userId, year } },
      create: {
        userId,
        year,
        casualBalance: casualQuota,
        sickBalance: sickQuota,
        casualUsed: field === 'casualUsed' ? amount : 0,
        sickUsed: field === 'sickUsed' ? amount : 0,
      },
      update: {
        [field]: { increment: amount },
      },
    });
  }

  /**
   * Upserts the WfhMonthlyUsage row and increments/decrements the specified counters.
   * Pass negative values to decrement. Counters are clamped to 0 on decrement via
   * Postgres GREATEST — the row is always created with 0 minimums on first insert.
   */
  private async adjustWfhMonthlyUsage(
    client: Prisma.TransactionClient | PrismaService,
    userId: string,
    date: Date,
    delta: { used?: number; pending?: number },
  ): Promise<void> {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    await (client as PrismaService).wfhMonthlyUsage.upsert({
      where: { userId_year_month: { userId, year, month } },
      create: {
        userId,
        year,
        month,
        used: Math.max(0, delta.used ?? 0),
        pending: Math.max(0, delta.pending ?? 0),
      },
      update: {
        ...(delta.used !== undefined && { used: { increment: delta.used } }),
        ...(delta.pending !== undefined && { pending: { increment: delta.pending } }),
      },
    });
  }

  private async computeBalance(userId: string, year: number): Promise<LeaveBalanceResponseDto> {
    const balance = await this.getOrCreateLeaveBalance(userId, year);

    // Per-employee WFH allowance (falls back to global constant if not set)
    const employee = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { wfhAllowancePerMonth: true },
    });
    const wfhAllowancePerMonth =
      typeof employee?.wfhAllowancePerMonth === 'number'
        ? employee.wfhAllowancePerMonth
        : WFH_PER_MONTH;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);

    const [wfhUsage, halfDayCount] = await this.prisma.$transaction([
      // Read stored WFH monthly counters — no aggregation needed
      this.prisma.wfhMonthlyUsage.findUnique({
        where: { userId_year_month: { userId, year: currentYear, month: currentMonth } },
      }),
      // Half-day count (approved + modified)
      this.prisma.leaveRequest.count({
        where: {
          employeeId: userId,
          leaveType: LeaveType.HALF_DAY,
          status: { in: [LeaveStatus.APPROVED, LeaveStatus.MODIFIED] },
          startDate: { gte: yearStart, lte: yearEnd },
        },
      }),
    ]);

    const wfhApprovedThisMonth = wfhUsage ? Number(wfhUsage.used) : 0;
    const wfhPendingThisMonth = wfhUsage ? Number(wfhUsage.pending) : 0;

    // Combined for cap purposes (approved + pending = slots reserved this month)
    const wfhThisMonth = wfhApprovedThisMonth + wfhPendingThisMonth;

    const casualBalance = balance.casualBalance.toNumber();
    const casualUsed = balance.casualUsed.toNumber();
    const sickBalance = balance.sickBalance.toNumber();
    const sickUsed = balance.sickUsed.toNumber();

    const casualRemaining = Math.max(0, casualBalance - casualUsed);
    const sickRemaining = Math.max(0, sickBalance - sickUsed);
    const casualOverdrawn = Math.max(0, casualUsed - casualBalance);
    const sickOverdrawn = Math.max(0, sickUsed - sickBalance);

    // Remaining = cap minus all reserved slots (approved + pending)
    const wfhRemainingThisMonth = Math.max(0, wfhAllowancePerMonth - wfhThisMonth);
    // Overdrawn = only truly approved WFH exceeding the cap (pending doesn't count as overused)
    const wfhOverdrawnThisMonth = Math.max(0, wfhApprovedThisMonth - wfhAllowancePerMonth);

    return {
      id: balance.id,
      userId,
      year,
      casualBalance,
      casualUsed,
      casualRemaining,
      casualOverdrawn: casualOverdrawn > 0 ? casualOverdrawn : undefined,
      sickBalance,
      sickUsed,
      sickRemaining,
      sickOverdrawn: sickOverdrawn > 0 ? sickOverdrawn : undefined,
      halfDayUsed: halfDayCount,
      wfhUsedThisMonth: wfhApprovedThisMonth,
      wfhPendingThisMonth,
      wfhRemainingThisMonth,
      wfhAllowancePerMonth,
      wfhOverdrawnThisMonth: wfhOverdrawnThisMonth > 0 ? wfhOverdrawnThisMonth : undefined,
    };
  }

  private async getTotalApprovedMaternityDays(userId: string, year: number): Promise<number> {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);

    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        employeeId: userId,
        leaveType: LeaveType.MATERNITY,
        status: { in: [LeaveStatus.APPROVED, LeaveStatus.MODIFIED] },
        startDate: { gte: yearStart, lte: yearEnd },
      },
      select: { daysConsumed: true },
    });

    return requests.reduce((sum, r) => sum + r.daysConsumed.toNumber(), 0);
  }

  private async paginateLeaves(
    baseWhere: Record<string, unknown>,
    statusFilter: LeaveStatus | undefined,
    page: number,
    limit: number,
    skip: number,
    isEmployeeView = false,
  ): Promise<PaginatedLeavesResponseDto> {
    const statusWhere: Record<string, unknown> =
      statusFilter === undefined
        ? {}
        : statusFilter === LeaveStatus.TEAM_LEAD_APPROVED
          ? {
              status: {
                in: [LeaveStatus.TEAM_LEAD_APPROVED, LeaveStatus.TEAM_LEAD_REJECTED],
              },
            }
          : { status: statusFilter };

    const listWhere: Record<string, unknown> = {
      ...baseWhere,
      ...statusWhere,
    };

    const [leaves, total, statusCounts, approvedLeaveDaysAgg] = await this.prisma.$transaction([
      this.prisma.leaveRequest.findMany({
        where: listWhere as never,
        select: LEAVE_REQUEST_SELECT_FIELDS,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.leaveRequest.count({ where: listWhere as never }),
      this.prisma.leaveRequest.groupBy({
        by: ['status'],
        // Global counts for this scoped view (ignore statusFilter, but respect other filters)
        where: baseWhere as never,
        orderBy: { status: 'asc' },
        _count: true,
      }),
      this.prisma.leaveRequest.aggregate({
        where: {
          ...baseWhere,
          status: { in: [LeaveStatus.APPROVED, LeaveStatus.MODIFIED] },
          // WFH is not counted as "leave days taken"
          leaveType: { not: LeaveType.WFH },
        },
        _sum: { daysConsumed: true },
      }),
    ]);

    const countByStatus = (s: LeaveStatus) =>
      Number(statusCounts.find((g) => g.status === s)?._count ?? 0);

    const totalPages = Math.ceil(total / limit) || 1;
    const approvedLeaveDays = approvedLeaveDaysAgg._sum.daysConsumed
      ? approvedLeaveDaysAgg._sum.daysConsumed.toNumber()
      : 0;

    return {
      data: leaves.map((l) => this.toDto(l as LeaveRequestWithRelations, isEmployeeView)),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      pending: countByStatus(LeaveStatus.PENDING),
      teamLeadApproved:
        countByStatus(LeaveStatus.TEAM_LEAD_APPROVED) +
        countByStatus(LeaveStatus.TEAM_LEAD_REJECTED),
      approved: countByStatus(LeaveStatus.APPROVED) + countByStatus(LeaveStatus.MODIFIED),
      approvedLeaveDays,
      rejected: countByStatus(LeaveStatus.REJECTED),
      cancelled: countByStatus(LeaveStatus.CANCELLED),
    };
  }

  /**
   * Maps a leave request to its response DTO.
   * @param r - The leave request with relations.
   * @param isEmployeeView - When true, hides Team Lead comment (per VAULT-217 policy).
   */
  private toDto(r: LeaveRequestWithRelations, isEmployeeView = false): LeaveRequestResponseDto {
    return {
      id: r.id,
      employeeId: r.employeeId,
      reportingManagerId: r.reportingManagerId,
      leaveType: r.leaveType as never,
      status: r.status as never,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      halfDayPeriod: r.halfDayPeriod as never,
      daysConsumed: r.daysConsumed.toNumber(),
      reason: r.reason,
      medicalCertificateUrl: r.medicalCertificateUrl,
      // Per VAULT-217: Team Lead comment is internal and must not be exposed to the employee
      teamLeadComment: isEmployeeView ? null : r.teamLeadComment,
      teamLeadReviewedAt: r.teamLeadReviewedAt?.toISOString() ?? null,
      requiresClientApproval: r.requiresClientApproval,
      hrComment: r.hrComment,
      hrReviewedAt: r.hrReviewedAt?.toISOString() ?? null,
      category: r.category as never,
      unpaidDays: r.unpaidDays.toNumber(),
      originalLeaveType: (r.originalLeaveType as never) ?? null,
      modifiedAt: r.modifiedAt?.toISOString() ?? null,
      modificationReason: r.modificationReason ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      employee: {
        id: r.employee.id,
        name: r.employee.name,
        email: r.employee.email,
        avatarUrl: r.employee.avatarUrl,
        departments: r.employee.departments,
        designation: r.employee.designation,
      },
      reportingManager: {
        id: r.reportingManager.id,
        name: r.reportingManager.name,
        email: r.reportingManager.email,
      },
      teamLead: r.teamLead
        ? { id: r.teamLead.id, name: r.teamLead.name, email: r.teamLead.email }
        : null,
      hr: r.hr ? { id: r.hr.id, name: r.hr.name, email: r.hr.email } : null,
      appliedByHr: r.appliedByHr
        ? { id: r.appliedByHr.id, name: r.appliedByHr.name, email: r.appliedByHr.email }
        : null,
      modifiedByHr: r.modifiedByHr
        ? { id: r.modifiedByHr.id, name: r.modifiedByHr.name, email: r.modifiedByHr.email }
        : null,
    };
  }

  /**
   * Determines whether an approved leave should be PAID or UNPAID based on
   * remaining balance at the time of approval.
   * WFH and Maternity are always PAID (no balance deduction model).
   */
  private async computeLeaveCategory(
    employeeId: string,
    year: number,
    leaveInfo: ReturnType<typeof calculateLeaveDays>,
  ): Promise<{ category: LeaveCategory; unpaidDays: number }> {
    if (leaveInfo.isWfh) {
      return { category: LeaveCategory.PAID, unpaidDays: 0 };
    }

    const balance = await this.getOrCreateLeaveBalance(employeeId, year);

    if (leaveInfo.deductedFromCasual) {
      const remaining = balance.casualBalance.toNumber() - balance.casualUsed.toNumber();
      if (leaveInfo.daysConsumed <= remaining) {
        return { category: LeaveCategory.PAID, unpaidDays: 0 };
      }
      return {
        category: LeaveCategory.UNPAID,
        unpaidDays: Math.max(0, leaveInfo.daysConsumed - Math.max(0, remaining)),
      };
    }

    if (leaveInfo.deductedFromSick) {
      const remaining = balance.sickBalance.toNumber() - balance.sickUsed.toNumber();
      if (leaveInfo.daysConsumed <= remaining) {
        return { category: LeaveCategory.PAID, unpaidDays: 0 };
      }
      return {
        category: LeaveCategory.UNPAID,
        unpaidDays: Math.max(0, leaveInfo.daysConsumed - Math.max(0, remaining)),
      };
    }

    return { category: LeaveCategory.PAID, unpaidDays: 0 };
  }

  private buildAllowedLeaveTypesResponse(user: {
    allowMaternityLeave: boolean;
    allowWeddingLeave: boolean;
    allowUmrahHajjLeave: boolean;
    allowOtherLeave: boolean;
    allowExtraWfh: boolean;
  }): AllowedLeaveTypesResponseDto {
    // Special leave types (MATERNITY, WEDDING, UMRAH_HAJJ, OTHER) are now
    // applied exclusively by HR on behalf of the employee. Employees can only
    // request standard leave types. The flags are still returned so the
    // frontend can display read-only status.
    const allowedTypes: LeaveType[] = [
      LeaveType.CASUAL,
      LeaveType.SICK,
      LeaveType.HALF_DAY,
      LeaveType.WFH,
    ];

    return {
      allowedTypes,
      allowMaternityLeave: user.allowMaternityLeave,
      allowWeddingLeave: user.allowWeddingLeave,
      allowUmrahHajjLeave: user.allowUmrahHajjLeave,
      allowOtherLeave: user.allowOtherLeave,
      allowExtraWfh: user.allowExtraWfh,
    };
  }
}
