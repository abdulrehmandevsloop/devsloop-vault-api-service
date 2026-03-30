import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { CreatePublicHolidayDto, PublicHolidayResponseDto } from './dto';

@Injectable()
export class PublicHolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePublicHolidayDto): Promise<PublicHolidayResponseDto> {
    const date = new Date(dto.date);

    const existing = await this.prisma.publicHoliday.findUnique({ where: { date } });
    if (existing) {
      throw new ConflictException(`A public holiday already exists for ${dto.date}`);
    }

    const holiday = await this.prisma.publicHoliday.create({
      data: { date, name: dto.name },
      select: { id: true, date: true, name: true, createdAt: true },
    });

    return this.toDto(holiday);
  }

  async findAll(): Promise<PublicHolidayResponseDto[]> {
    const holidays = await this.prisma.publicHoliday.findMany({
      select: { id: true, date: true, name: true, createdAt: true },
      orderBy: { date: 'asc' },
    });
    return holidays.map((h) => this.toDto(h));
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.publicHoliday.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Public holiday ${id} not found`);
    await this.prisma.publicHoliday.delete({ where: { id } });
  }

  /** Returns a Set of YYYY-MM-DD strings for the given date range (used by reminder service). */
  async getHolidayKeys(from: Date, to: Date): Promise<Set<string>> {
    const holidays = await this.prisma.publicHoliday.findMany({
      where: { date: { gte: from, lte: to } },
      select: { date: true },
    });
    return new Set(holidays.map((h) => h.date.toISOString().split('T')[0]));
  }

  private toDto(h: {
    id: string;
    date: Date;
    name: string;
    createdAt: Date;
  }): PublicHolidayResponseDto {
    return {
      id: h.id,
      date: h.date.toISOString().split('T')[0],
      name: h.name,
      createdAt: h.createdAt,
    };
  }
}
