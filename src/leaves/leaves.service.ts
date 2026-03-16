import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LeaveStatus, LeaveType } from '@prisma/client';
import { PrismaService } from '../prisma';
import {
  CreateLeaveRequestDto,
  HrLeavesQueryDto,
  HrReviewLeaveRequestDto,
  HrStatsResponseDto,
  LeaveBalanceResponseDto,
  LeaveRequestResponseDto,
  MyLeavesQueryDto,
  PaginatedLeavesResponseDto,
  ReportingManagerResponseDto,
  ReviewLeaveRequestDto,
  TeamLeadLeavesQueryDto,
} from './dto';
import { LEAVE_REQUEST_SELECT_FIELDS, LeaveRequestWithRelations } from './interfaces';
import { calculateLeaveDays, computeProRataCasualQuota, computeProRataSickQuota } from './utils';
import {
  LeaveApprovedEvent,
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
};

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
      select: { id: true, name: true, email: true, joiningDate: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
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
    if (!leaveInfo.isWfh && !leaveInfo.isMaternity) {
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

    return this.toDto(leaveRequest as LeaveRequestWithRelations);
  }

  // -------------------------------------------------------------------------
  // Employee — Cancel leave request
  // -------------------------------------------------------------------------

  async cancelLeaveRequest(leaveRequestId: string, employeeId: string): Promise<void> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      select: { id: true, employeeId: true, status: true },
    });

    if (!request) {
      throw new NotFoundException(`Leave request ${leaveRequestId} not found`);
    }
    if (request.employeeId !== employeeId) {
      throw new ForbiddenException('You can only cancel your own leave requests');
    }

    this.validateStatusTransition(request.status, LeaveStatus.CANCELLED);

    await this.prisma.leaveRequest.update({
      where: { id: leaveRequestId },
      data: { status: LeaveStatus.CANCELLED },
    });

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

    return this.paginateLeaves(baseWhere, status, page, limit, skip);
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

    return leaves.map((l) => this.toDto(l as LeaveRequestWithRelations));
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

    return this.toDto(request as LeaveRequestWithRelations);
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
      },
      select: LEAVE_REQUEST_SELECT_FIELDS,
    });

    this.logger.log(`Leave ${leaveRequestId} rejected by team lead ${teamLeadId}`);

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
    } = query;
    const skip = (page - 1) * limit;

    const whereClauses: Record<string, unknown>[] = [];
    if (leaveType) {
      whereClauses.push({ leaveType });
    }
    if (employeeId) {
      whereClauses.push({ employeeId });
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

    // Atomic: update request + deduct balance
    const [updated] = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.leaveRequest.update({
        where: { id: leaveRequestId },
        data: {
          status: LeaveStatus.APPROVED,
          hrId,
          hrComment: dto.comment.trim(),
          hrReviewedAt: new Date(),
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
        await this.upsertAndDeductBalance(tx, request.employeeId, currentYear, 'wfhUsed', 1);
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

    const [statusGroups, typeGroups] = await this.prisma.$transaction([
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
    ]);

    const countByStatus = (status: LeaveStatus) =>
      Number(statusGroups.find((g) => g.status === status)?._count ?? 0);

    const total = statusGroups.reduce((sum, g) => sum + Number(g._count ?? 0), 0);

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

    return {
      year: targetYear,
      department: department ?? null,
      total,
      totalPending: countByStatus(LeaveStatus.PENDING),
      totalPendingHr:
        countByStatus(LeaveStatus.TEAM_LEAD_APPROVED) +
        countByStatus(LeaveStatus.TEAM_LEAD_REJECTED),
      totalApproved: countByStatus(LeaveStatus.APPROVED),
      totalRejected: countByStatus(LeaveStatus.REJECTED),
      byLeaveType: [...typeMap.entries()].map(([leaveType, stats]) => ({
        leaveType,
        ...stats,
      })),
    };
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

    // WFH: per-employee monthly allowance cap (soft policy)
    if (dto.leaveType === LeaveType.WFH) {
      const employeeRecord = await this.prisma.user.findUnique({
        where: { id: employeeId },
        select: { wfhAllowancePerMonth: true },
      });
      const wfhAllowance =
        typeof employeeRecord?.wfhAllowancePerMonth === 'number'
          ? employeeRecord.wfhAllowancePerMonth
          : WFH_PER_MONTH;

      const monthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const monthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0, 23, 59, 59);
      const existingWfh = await this.prisma.leaveRequest.count({
        where: {
          employeeId,
          leaveType: LeaveType.WFH,
          status: {
            notIn: [LeaveStatus.CANCELLED, LeaveStatus.TEAM_LEAD_REJECTED, LeaveStatus.REJECTED],
          },
          startDate: { gte: monthStart, lte: monthEnd },
        },
      });

      if (existingWfh >= wfhAllowance) {
        this.logger.warn(
          `Policy warning: WFH monthly allowance exceeded. Existing WFH this month: ${existingWfh}, allowance: ${wfhAllowance}.`,
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
        wfhUsed: 0,
      },
      update: {},
    });
  }

  private async upsertAndDeductBalance(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    userId: string,
    year: number,
    field: 'casualUsed' | 'sickUsed' | 'wfhUsed',
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
        wfhUsed: field === 'wfhUsed' ? amount : 0,
      },
      update: {
        [field]: { increment: amount },
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

    // WFH remaining this month — count approved/pending WFH in current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);

    const [wfhThisMonth, halfDayCount] = await this.prisma.$transaction([
      this.prisma.leaveRequest.count({
        where: {
          employeeId: userId,
          leaveType: LeaveType.WFH,
          status: {
            notIn: [LeaveStatus.CANCELLED, LeaveStatus.TEAM_LEAD_REJECTED, LeaveStatus.REJECTED],
          },
          startDate: { gte: monthStart, lte: monthEnd },
        },
      }),
      this.prisma.leaveRequest.count({
        where: {
          employeeId: userId,
          leaveType: LeaveType.HALF_DAY,
          status: LeaveStatus.APPROVED,
          startDate: { gte: yearStart, lte: yearEnd },
        },
      }),
    ]);

    const casualBalance = balance.casualBalance.toNumber();
    const casualUsed = balance.casualUsed.toNumber();
    const sickBalance = balance.sickBalance.toNumber();
    const sickUsed = balance.sickUsed.toNumber();

    const casualRemaining = Math.max(0, casualBalance - casualUsed);
    const sickRemaining = Math.max(0, sickBalance - sickUsed);
    const casualOverdrawn = Math.max(0, casualUsed - casualBalance);
    const sickOverdrawn = Math.max(0, sickUsed - sickBalance);

    const wfhRemainingThisMonth = Math.max(0, wfhAllowancePerMonth - wfhThisMonth);
    const wfhOverdrawnThisMonth = Math.max(0, wfhThisMonth - wfhAllowancePerMonth);

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
      wfhUsedThisMonth: wfhThisMonth,
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
        status: LeaveStatus.APPROVED,
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
          status: LeaveStatus.APPROVED,
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
      data: leaves.map((l) => this.toDto(l as LeaveRequestWithRelations)),
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
      approved: countByStatus(LeaveStatus.APPROVED),
      approvedLeaveDays,
      rejected: countByStatus(LeaveStatus.REJECTED),
      cancelled: countByStatus(LeaveStatus.CANCELLED),
    };
  }

  private toDto(r: LeaveRequestWithRelations): LeaveRequestResponseDto {
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
      teamLeadComment: r.teamLeadComment,
      teamLeadReviewedAt: r.teamLeadReviewedAt?.toISOString() ?? null,
      hrComment: r.hrComment,
      hrReviewedAt: r.hrReviewedAt?.toISOString() ?? null,
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
    };
  }
}
