import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

type TxClient = PrismaClient | Prisma.TransactionClient;

@Injectable()
export class EmployeeIdService {
  /**
   * Normalize a provided employee ID to the canonical DL_0001 pattern.
   * If the input is empty/whitespace, returns null.
   */
  normalizeProvidedId(raw: string | null | undefined): string | null {
    const value = raw?.trim();
    if (!value) {
      return null;
    }

    // Try to extract numeric part and reformat as DL_0001
    const match = value.match(/\d+/);
    if (!match) {
      // If no digits, fall back to uppercased, underscore-separated string
      return value.replace(/-/g, '_').toUpperCase();
    }

    const num = parseInt(match[0], 10);
    if (Number.isNaN(num) || num <= 0) {
      return value.replace(/-/g, '_').toUpperCase();
    }

    const padded = String(num).padStart(4, '0');
    return `DL_${padded}`;
  }

  /**
   * Generate the next available DL_0001-style ID based on existing users.
   * Uses the provided Prisma transaction/client for consistency.
   */
  async generateNextId(tx: TxClient): Promise<string> {
    const latest = await tx.user.findFirst({
      where: {
        employeeId: {
          startsWith: 'DL_',
        },
      },
      select: { employeeId: true },
      orderBy: { employeeId: 'desc' },
    });

    let nextNumber = 1;

    if (latest?.employeeId) {
      const match = latest.employeeId.match(/DL_(\d{4})$/);
      if (match) {
        const current = parseInt(match[1], 10);
        if (!Number.isNaN(current) && current >= 1) {
          nextNumber = current + 1;
        }
      }
    }

    // Collision-safe: keep incrementing until we find an unused ID.
    // (We intentionally do not rely on a DB unique constraint.)
    const maxAttempts = 20_000;
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      const padded = String(nextNumber).padStart(4, '0');
      const candidate = `DL_${padded}`;
      const exists = await tx.user.findFirst({
        where: { employeeId: candidate },
        select: { id: true },
      });
      if (!exists) {
        return candidate;
      }
      nextNumber++;
    }

    throw new ConflictException(
      'Unable to generate a unique employee ID. Please provide one manually.',
    );
  }

  /**
   * Resolve an effective employee ID:
   * - If a value is provided, normalize it.
   * - If empty, generate the next DL_0001-style ID.
   */
  async resolveEmployeeId(requestedId: string | null | undefined, tx: TxClient): Promise<string> {
    const normalized = this.normalizeProvidedId(requestedId);
    if (normalized) {
      return normalized;
    }

    return this.generateNextId(tx);
  }

  /**
   * Ensure a normalized employee ID is not already used by another user.
   * Pass excludeUserId when validating an update.
   */
  async assertEmployeeIdUnique(
    employeeId: string,
    tx: TxClient,
    excludeUserId?: string,
  ): Promise<void> {
    const existing = await tx.user.findFirst({
      where: {
        employeeId,
        ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(`Employee ID "${employeeId}" is already in use.`);
    }
  }
}
