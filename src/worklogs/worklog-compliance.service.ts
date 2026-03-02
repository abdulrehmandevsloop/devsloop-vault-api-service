import { BadRequestException, Injectable } from '@nestjs/common';
import { ComplianceSummaryDto } from './dto';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class WorklogComplianceService {
  /**
   * Returns all Monday–Friday dates in the given month.
   * If capDate is provided, only dates strictly before capDate are included.
   * year: full year (e.g. 2025)
   * month: 1-indexed (1=Jan, 12=Dec)
   */
  getWeekdaysInMonth(year: number, month: number, capDate?: Date): Date[] {
    const days: Date[] = [];
    const lastDay = new Date(Date.UTC(year, month, 0)); // 0th of next month = last of this month
    const cap = capDate ?? new Date(8640000000000000); // max date sentinel

    for (let day = 1; day <= lastDay.getUTCDate(); day++) {
      const d = new Date(Date.UTC(year, month - 1, day));
      const dow = d.getUTCDay(); // 0=Sun, 6=Sat
      if (dow !== 0 && dow !== 6 && d < cap) {
        days.push(d);
      }
    }
    return days;
  }

  /**
   * Computes compliance stats given a list of submitted dates for a user/month.
   * Working days are Mon–Fri up to (but not including) today.
   */
  buildCompliance(submittedDates: Date[], year: number, month: number): ComplianceSummaryDto {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const workingDays = this.getWeekdaysInMonth(year, month, today);
    const totalWorkingDays = workingDays.length;

    // Build a set of submitted date keys for O(1) lookup
    const submittedKeys = new Set(submittedDates.map((d) => this.toDateKey(d)));

    const submittedDays = workingDays.filter((d) => submittedKeys.has(this.toDateKey(d))).length;

    const missedDays = Math.max(0, totalWorkingDays - submittedDays);
    const compliancePct =
      totalWorkingDays > 0 ? Math.round((submittedDays / totalWorkingDays) * 100) : 100;

    return { totalWorkingDays, submittedDays, missedDays, compliancePct };
  }

  /**
   * Formats a Date to a YYYY-MM-DD string key using UTC components.
   */
  toDateKey(d: Date): string {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Parses a YYYY-MM string into { year, month } numbers.
   * @throws BadRequestException if monthStr is missing or not YYYY-MM
   */
  parseMonth(monthStr: string): { year: number; month: number } {
    if (typeof monthStr !== 'string' || !monthStr.trim() || !MONTH_REGEX.test(monthStr.trim())) {
      throw new BadRequestException('month must be in YYYY-MM format (e.g. 2026-03)');
    }
    const [yearStr, monthStr2] = monthStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr2, 10);
    if (Number.isNaN(year) || Number.isNaN(month)) {
      throw new BadRequestException('month must be in YYYY-MM format (e.g. 2026-03)');
    }
    return { year, month };
  }

  /**
   * Returns the start and end Date for a given YYYY-MM string (UTC midnight).
   */
  getMonthRange(monthStr: string): { startDate: Date; endDate: Date } {
    const { year, month } = this.parseMonth(monthStr);
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1)); // exclusive upper bound
    return { startDate, endDate };
  }
}
