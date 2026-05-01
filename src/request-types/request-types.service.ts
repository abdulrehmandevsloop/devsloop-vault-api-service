import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma';
import { CreateRequestTypeDto, UpdateRequestTypeDto } from './dto';

@Injectable()
export class RequestTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(includeInactive = false) {
    return this.prisma.requestTypeDefinition.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ isBuiltIn: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findByKey(key: string) {
    const type = await this.prisma.requestTypeDefinition.findUnique({ where: { key } });
    if (!type) throw new NotFoundException(`Request type "${key}" not found`);
    return type;
  }

  async findById(id: string) {
    const type = await this.prisma.requestTypeDefinition.findUnique({ where: { id } });
    if (!type) throw new NotFoundException('Request type not found');
    return type;
  }

  async create(dto: CreateRequestTypeDto) {
    const existing = await this.prisma.requestTypeDefinition.findUnique({
      where: { key: dto.key },
    });
    if (existing) {
      throw new BadRequestException(`A request type with key "${dto.key}" already exists`);
    }

    return this.prisma.requestTypeDefinition.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        icon: dto.icon,
        color: dto.color,
        fieldSchema: dto.fieldSchema as object[],
        isBuiltIn: false,
        isActive: true,
      },
    });
  }

  async update(id: string, dto: UpdateRequestTypeDto) {
    const type = await this.findById(id);

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.icon !== undefined) updateData.icon = dto.icon;
    if (dto.color !== undefined) updateData.color = dto.color;

    if (!type.isBuiltIn && dto.fieldSchema !== undefined) {
      updateData.fieldSchema = dto.fieldSchema as object[];
    }

    return this.prisma.requestTypeDefinition.update({
      where: { id },
      data: updateData,
    });
  }

  async deactivate(id: string) {
    const type = await this.findById(id);

    if (type.isBuiltIn) {
      throw new BadRequestException('Cannot deactivate built-in request types');
    }

    const activeTemplates = await this.prisma.workflowTemplate.count({
      where: { requestType: type.key, isActive: true },
    });

    if (activeTemplates > 0) {
      throw new BadRequestException(
        `Cannot deactivate — ${activeTemplates} active workflow template(s) use this request type`,
      );
    }

    return this.prisma.requestTypeDefinition.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
