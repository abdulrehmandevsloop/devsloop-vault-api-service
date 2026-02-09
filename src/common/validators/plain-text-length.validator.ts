import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

/**
 * Strips HTML tags and entities from a string to get the plain text length.
 * Mirrors the frontend `getPlainTextLength()` helper exactly.
 */
export function getPlainTextLength(html: string): number {
  if (!html) return 0;
  const text = html
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
    .replace(/&[a-z]+;/gi, '') // Remove other HTML entities
    .trim();
  return text.length;
}

// ─── PlainTextMinLength ──────────────────────────────────────────────

/**
 * Validates that the plain-text content (HTML tags stripped) meets the
 * minimum length. Use on rich-text/HTML fields where raw string length
 * includes tags the user didn't type.
 *
 * @example
 * ```ts
 * @PlainTextMinLength(50, { message: 'Solution must be at least 50 characters' })
 * solution: string;
 * ```
 */
export function PlainTextMinLength(min: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'plainTextMinLength',
      target: object.constructor,
      propertyName,
      constraints: [min],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return true; // let @IsString handle type
          const [minLen] = args.constraints as [number];
          return getPlainTextLength(value) >= minLen;
        },
        defaultMessage(args: ValidationArguments) {
          const [minLen] = args.constraints as [number];
          return `${args.property} must be at least ${minLen} characters (plain text)`;
        },
      },
    });
  };
}

// ─── PlainTextMaxLength ──────────────────────────────────────────────

/**
 * Validates that the plain-text content (HTML tags stripped) does not
 * exceed the maximum length. Use on rich-text/HTML fields.
 *
 * @example
 * ```ts
 * @PlainTextMaxLength(5000, { message: 'Outcome must be less than 5,000 characters' })
 * outcome: string;
 * ```
 */
export function PlainTextMaxLength(max: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'plainTextMaxLength',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return true; // let @IsString handle type
          const [maxLen] = args.constraints as [number];
          return getPlainTextLength(value) <= maxLen;
        },
        defaultMessage(args: ValidationArguments) {
          const [maxLen] = args.constraints as [number];
          return `${args.property} must be less than ${maxLen.toLocaleString()} characters (plain text)`;
        },
      },
    });
  };
}
