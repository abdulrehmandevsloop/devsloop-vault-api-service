import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class CuidValidationPipe implements PipeTransform<string, string> {
  private readonly CUID_REGEX = /^c[a-z0-9]{24}$/;
  private readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  transform(value: string): string {
    if (!value) {
      throw new BadRequestException('ID parameter is required');
    }

    if (!this.CUID_REGEX.test(value) && !this.UUID_REGEX.test(value)) {
      throw new BadRequestException('Invalid ID format');
    }

    return value;
  }
}
