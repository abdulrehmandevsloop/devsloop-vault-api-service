import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarningDto, PaginatedWarningsResponseDto, WarningResponseDto } from './dto';

const WARN_SELECT = {
  id: true,
  userId: true,
  message: true,
  warningType: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

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

  constructor(private readonly prisma: PrismaService) {}

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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
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
    return toDto(warning);
  }

  async delete(userId: string, warningId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const warning = await this.prisma.userWarning.findFirst({
      where: { id: warningId, userId },
    });
    if (!warning) {
      throw new NotFoundException(`Warning with ID ${warningId} not found for this user`);
    }

    await this.prisma.userWarning.delete({ where: { id: warningId } });
    this.logger.log(`Warning ${warningId} deleted for user ${userId}`);
  }
}
