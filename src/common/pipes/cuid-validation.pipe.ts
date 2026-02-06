import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

/**
 * CUID validation pipe
 * Validates that the input is a valid CUID format
 * CUID format: starts with 'c', followed by 24 alphanumeric characters (lowercase)
 * Example: clx1234567890abcdefghijkl
 */
@Injectable()
export class CuidValidationPipe implements PipeTransform<string, string> {
  // CUID regex: starts with 'c', followed by 24 lowercase alphanumeric characters
  private readonly CUID_REGEX = /^c[a-z0-9]{24}$/;

  transform(value: string): string {
    if (!value) {
      throw new BadRequestException('ID parameter is required');
    }

    if (!this.CUID_REGEX.test(value)) {
      throw new BadRequestException(
        `Invalid ID format. Expected CUID format (e.g., clx1234567890abcdefghijkl)`,
      );
    }

    return value;
  }
}
