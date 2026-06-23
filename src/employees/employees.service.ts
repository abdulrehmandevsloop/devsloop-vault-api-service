import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { BirthdayEmployeeDto } from './dto/birthday-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================================================================
  // Get employees whose birthdays fall within today and the next 7 days (UTC).
  // We compare month/day ignoring year to handle annual recurrence.
  // ===========================================================================
  async getUpcomingBirthdays(): Promise<BirthdayEmployeeDto[]> {
    const today = new Date();
    const todayUTC = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );

    // Fetch all users that have a dateOfBirth set and are active
    const users = await this.prisma.user.findMany({
      where: {
        dateOfBirth: { not: null },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
        dateOfBirth: true,
      },
    });

    const results: BirthdayEmployeeDto[] = [];

    for (const user of users) {
      if (!user.dateOfBirth) continue;

      const dob = new Date(user.dateOfBirth);

      // Compute the birthday for this calendar year in UTC
      let birthdayThisYear = new Date(
        Date.UTC(todayUTC.getUTCFullYear(), dob.getUTCMonth(), dob.getUTCDate()),
      );

      // If birthday already passed this year, consider next year's birthday
      if (birthdayThisYear < todayUTC) {
        birthdayThisYear = new Date(
          Date.UTC(
            todayUTC.getUTCFullYear() + 1,
            dob.getUTCMonth(),
            dob.getUTCDate(),
          ),
        );
      }

      const diffMs = birthdayThisYear.getTime() - todayUTC.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= 7) {
        const fullName =
          `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();

        results.push({
          id: user.id,
          name: fullName,
          profilePicture: user.profilePicture ?? null,
          birthday: user.dateOfBirth.toISOString(),
          daysUntilBirthday: diffDays,
        });
      }
    }

    // Sort ascending — today (0) first
    results.sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday);

    return results;
  }
}