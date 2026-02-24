import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWarningDto, WarningResponseDto } from './dto';

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
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    return warnings.map((w) => ({
      id: w.id,
      userId: w.userId,
      message: w.message,
      createdAt: w.createdAt.toISOString(),
      createdById: w.createdBy.id,
      createdByName: w.createdBy.name ?? undefined,
    }));
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
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Warning created for user ${userId} by ${createdById}`);
    return {
      id: warning.id,
      userId: warning.userId,
      message: warning.message,
      createdAt: warning.createdAt.toISOString(),
      createdById: warning.createdBy.id,
      createdByName: warning.createdBy.name ?? undefined,
    };
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

    await this.prisma.userWarning.delete({
      where: { id: warningId },
    });
    this.logger.log(`Warning ${warningId} deleted for user ${userId}`);
  }
}
