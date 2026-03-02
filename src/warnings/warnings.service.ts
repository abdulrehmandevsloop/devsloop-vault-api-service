import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../auth/services/audit-log.service';
import { CreateWarningDto, PaginatedWarningsResponseDto, WarningResponseDto } from './dto';

function toDto(w: {
  id: string;
  userId: string;
  message: string;
  warningType: import('@prisma/client').WarningType;
  createdAt: Date;
  createdBy: { id: string; name: string | null };
}): WarningResponseDto {
  return {
    id: w.id,
    userId: w.userId,
    message: w.message,
    warningType: w.warningType,
    createdAt: w.createdAt.toISOString(),
    createdById: w.createdBy.id,
    createdByName: w.createdBy.name ?? undefined,
  };
}

@Injectable()
export class WarningsService {
  private readonly logger = new Logger(WarningsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAllForUser(userId: string): Promise<WarningResponseDto[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const warnings = await this.prisma.userWarning.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    return warnings.map(toDto);
  }

  async findPaginatedForUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedWarningsResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const skip = (page - 1) * limit;
    const where = { userId };

    const [warnings, total] = await Promise.all([
      this.prisma.userWarning.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.userWarning.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: warnings.map(toDto),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  async create(
    userId: string,
    dto: CreateWarningDto,
    createdById: string,
  ): Promise<WarningResponseDto> {
    if (userId === createdById) {
      throw new BadRequestException('You cannot issue a warning to yourself');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!targetUser) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const warning = await this.prisma.userWarning.create({
      data: {
        userId,
        createdById,
        message: dto.message.trim(),
        warningType: dto.warningType ?? 'MINOR',
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    this.logger.log(`Warning created for user ${userId} by ${createdById}`);

    await this.auditLogService.log(createdById, 'WARNING_CREATED', 'UserWarning', warning.id, {
      issuedToName: targetUser.name,
      issuedToEmail: targetUser.email,
      warningType: warning.warningType,
      message: warning.message,
    });

    return toDto(warning);
  }

  async delete(userId: string, warningId: string, deletingUserId: string): Promise<void> {
    if (userId === deletingUserId) {
      throw new BadRequestException('You cannot delete a warning issued to yourself');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!targetUser) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const warning = await this.prisma.userWarning.findFirst({
      where: { id: warningId, userId },
      select: {
        id: true,
        message: true,
        warningType: true,
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!warning) {
      throw new NotFoundException(`Warning with ID ${warningId} not found for this user`);
    }

    await this.prisma.userWarning.delete({ where: { id: warningId } });
    this.logger.log(`Warning ${warningId} deleted for user ${userId} by ${deletingUserId}`);

    await this.auditLogService.log(deletingUserId, 'WARNING_DELETED', 'UserWarning', warningId, {
      employeeName: targetUser.name,
      employeeEmail: targetUser.email,
      warningType: warning.warningType,
      warningMessage: warning.message,
      originallyIssuedByName: warning.createdBy.name,
    });
  }
}
