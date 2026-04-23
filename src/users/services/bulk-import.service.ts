import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import {
  ApprovalStatus,
  EmployeeStatus,
  EmployeeType,
  Gender,
  Prisma,
  WorkingMode,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { DEPARTMENTS } from '../../common/constants';
import { BulkImportResultDto, BulkImportRowResultDto } from '../dto/bulk-import-result.dto';
import { randomBytes } from 'crypto';
import { EmployeeIdService } from './employee-id.service';

interface RawRow {
  full_name?: string;
  company_email?: string;
  personal_email?: string;
  designation?: string;
  department?: string;
  role?: string;
  date_of_joining?: string;
  date_of_leaving?: string;
  probation_period?: string;
  employee_id?: string;
  unique_id?: string;
  employee_type?: string;
  employee_status?: string;
  working_mode?: string;
  working_shift?: string;
  base_salary?: string;
  fixed_income_tax?: string;
  rental_allowance?: string;
  commute_allowance?: string;
  lunch_deduction_enabled?: string;
  // Personal info
  date_of_birth?: string;
  cnic?: string;
  gender?: string;
  religion?: string;
  sect?: string;
  father_name?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relation?: string;
  marital_status?: string;
  mobile_number?: string;
  bank_name?: string;
  iban?: string;
  account_holder_name?: string;
  bank_code?: string;
  swift_bic?: string;
  province?: string;
  current_address?: string;
  permanent_address?: string;
  education_level?: string;
  highest_qualification?: string;
  institution_name?: string;
  field_of_study?: string;
  employee_reference?: string;
  area_of_expertise?: string;
  working_days?: string;
  city_of_residence?: string;
}

@Injectable()
export class BulkImportService {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeIdService: EmployeeIdService,
  ) {}

  async importFromBuffer(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    adminId: string,
    skipExisting = false,
  ): Promise<BulkImportResultDto> {
    const rows = this.parseFile(buffer, mimeType, originalName);

    if (rows.length === 0) {
      throw new BadRequestException('The file contains no data rows');
    }

    if (rows.length > 500) {
      throw new BadRequestException('Maximum 500 rows allowed per import');
    }

    const results: BulkImportRowResultDto[] = [];
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    const seenEmails = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const raw = rows[i];
      const email = raw.company_email?.trim().toLowerCase() ?? '';

      if (email && seenEmails.has(email)) {
        const name = raw.full_name?.trim() ?? '';
        results.push({
          row: rowNum,
          name,
          email,
          success: false,
          errors: ['Duplicate email within this import file'],
        });
        failed++;
        continue;
      }

      if (email) seenEmails.add(email);

      const rowResult = await this.processRow(raw, rowNum, adminId, skipExisting);
      results.push(rowResult);
      if (rowResult.skipped) skipped++;
      else if (rowResult.success) succeeded++;
      else failed++;
    }

    return { total: rows.length, succeeded, skipped, failed, results };
  }

  private parseFile(buffer: Buffer, mimeType: string, originalName: string): RawRow[] {
    const ext = originalName.split('.').pop()?.toLowerCase();
    const isExcel =
      ext === 'xlsx' ||
      ext === 'xls' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel';

    if (isExcel) {
      return this.parseExcel(buffer);
    }

    // CSV
    try {
      const records = parseCsv<RawRow>(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
      return records;
    } catch (err) {
      throw new BadRequestException(`Failed to parse CSV file: ${(err as Error).message}`);
    }
  }

  private parseExcel(buffer: Buffer): RawRow[] {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('No sheets found');
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      // Normalize keys to snake_case lower
      return rows.map((r) => {
        const normalized: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          const key = k.trim().toLowerCase().replace(/\s+/g, '_');
          if (v === null || v === undefined || v === '') {
            normalized[key] = '';
          } else if (typeof v === 'string') {
            normalized[key] = v.trim();
          } else if (typeof v === 'number' || typeof v === 'boolean') {
            normalized[key] = String(v);
          } else if (v instanceof Date) {
            normalized[key] = v.toISOString();
          } else {
            normalized[key] = '';
          }
        }
        return normalized as RawRow;
      });
    } catch (err) {
      throw new BadRequestException(`Failed to parse Excel file: ${(err as Error).message}`);
    }
  }

  private async processRow(
    raw: RawRow,
    rowNum: number,
    adminId: string,
    skipExisting = false,
  ): Promise<BulkImportRowResultDto> {
    const name = raw.full_name?.trim() ?? '';
    const email = raw.company_email?.trim().toLowerCase() ?? '';

    const errors: string[] = [];

    // Required field validation
    if (!name) errors.push('full_name is required');
    if (!email) errors.push('company_email is required');
    if (!raw.designation?.trim()) errors.push('designation is required');
    if (!raw.department?.trim()) errors.push('department is required');
    if (!raw.date_of_joining?.trim()) errors.push('date_of_joining is required');

    if (errors.length > 0) {
      return { row: rowNum, name, email, success: false, errors };
    }

    // Email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('company_email is not a valid email address');
    }

    // Personal email format (optional)
    const personalEmail = raw.personal_email?.trim().toLowerCase() || null;
    if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) {
      errors.push('personal_email is not a valid email address');
    }

    // Department
    const department = raw.department!.trim();
    if (!(DEPARTMENTS as readonly string[]).includes(department)) {
      errors.push(`department must be one of: ${DEPARTMENTS.join(', ')}`);
    }

    // Joining date
    let joiningDate: Date | null = null;
    if (raw.date_of_joining?.trim()) {
      joiningDate = new Date(raw.date_of_joining.trim());
      if (isNaN(joiningDate.getTime())) {
        errors.push('date_of_joining must be a valid date (e.g., 2026-01-15)');
        joiningDate = null;
      }
    }

    // Leave date (optional)
    let leaveDate: Date | null = null;
    if (raw.date_of_leaving?.trim()) {
      leaveDate = new Date(raw.date_of_leaving.trim());
      if (isNaN(leaveDate.getTime())) {
        errors.push('date_of_leaving must be a valid date (e.g., 2026-01-15)');
        leaveDate = null;
      }
    }

    // Date of birth
    let dateOfBirth: Date | null = null;
    if (raw.date_of_birth?.trim()) {
      dateOfBirth = new Date(raw.date_of_birth.trim());
      if (isNaN(dateOfBirth.getTime())) {
        errors.push('date_of_birth must be a valid date');
        dateOfBirth = null;
      }
    }

    // Numeric fields
    const baseSalary = this.parsePositiveFloat(raw.base_salary, 'base_salary', errors);
    const fixedIncomeTax = this.parseOptionalPositiveFloat(
      raw.fixed_income_tax,
      'fixed_income_tax',
      errors,
    );
    const rentalAllowance = this.parseOptionalPositiveFloat(
      raw.rental_allowance,
      'rental_allowance',
      errors,
    );
    const commuteAllowance = this.parseOptionalPositiveFloat(
      raw.commute_allowance,
      'commute_allowance',
      errors,
    );
    const lunchDeductionEnabled = this.parseBoolean(raw.lunch_deduction_enabled, true);
    const probationPeriod = this.parseOptionalPositiveInt(
      raw.probation_period,
      'probation_period',
      errors,
    );
    const casualLeave = 10;
    const sickLeave = 8;
    const annualLeave = 14;
    const wfhPerMonth = null;

    // Enums
    const employeeType = this.parseEnum(raw.employee_type, EmployeeType, 'employee_type', errors);
    const employeeStatus =
      this.parseEnum(raw.employee_status, EmployeeStatus, 'employee_status', errors) ??
      EmployeeStatus.ACTIVE;
    const workingMode = this.parseEnum(raw.working_mode, WorkingMode, 'working_mode', errors);
    const gender = this.parseEnum(raw.gender, Gender, 'gender', errors);

    // CNIC format
    const cnic = raw.cnic?.trim() || null;
    if (cnic && !/^\d{5}-\d{7}-\d$/.test(cnic)) {
      errors.push('cnic must be in format xxxxx-xxxxxxx-x');
    }

    if (errors.length > 0) {
      return { row: rowNum, name, email, success: false, errors };
    }

    // DB-level checks: email duplicate & role lookup
    try {
      const [existingUser, role] = await Promise.all([
        this.prisma.user.findUnique({ where: { email }, select: { id: true } }),
        this.prisma.role.findFirst({
          where: { name: { equals: 'EMPLOYEE', mode: 'insensitive' }, isActive: true },
          select: { id: true },
        }),
      ]);

      if (existingUser) {
        if (skipExisting) {
          return { row: rowNum, name, email, success: true, skipped: true };
        }
        return { row: rowNum, name, email, success: false, errors: ['Email already exists'] };
      }

      if (!role) {
        return {
          row: rowNum,
          name,
          email,
          success: false,
          errors: ['EMPLOYEE role not found or inactive — contact your system administrator'],
        };
      }

      const tempPassword = randomBytes(8).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      const year = joiningDate!.getFullYear();

      await this.prisma.$transaction(async (tx) => {
        const requestedEmployeeId = raw.employee_id?.trim() || raw.unique_id?.trim() || null;
        const effectiveEmployeeId = await this.employeeIdService.resolveEmployeeId(
          requestedEmployeeId,
          tx,
        );
        await this.employeeIdService.assertEmployeeIdUnique(effectiveEmployeeId, tx);

        const user = await tx.user.create({
          data: {
            email,
            name,
            personalEmail,
            departments: [department],
            designation: raw.designation!.trim(),
            joiningDate: joiningDate!,
            leaveDate,
            baseSalaryMonthly: new Prisma.Decimal(Math.round((baseSalary ?? 0) * 100) / 100),
            incomeTaxAmount:
              fixedIncomeTax !== null
                ? new Prisma.Decimal(Math.round(fixedIncomeTax * 100) / 100)
                : null,
            lunchEnabled: lunchDeductionEnabled,
            probationPeriod,
            casualLeaveBalance: casualLeave,
            sickLeaveBalance: sickLeave,
            annualLeaveBalance: annualLeave,
            wfhAllowancePerMonth: wfhPerMonth,
            // Personal
            dateOfBirth,
            cnic,
            gender,
            religion: raw.religion?.trim() || null,
            sect: raw.sect?.trim() || null,
            fatherName: raw.father_name?.trim() || null,
            emergencyContactName: raw.emergency_contact_name?.trim() || null,
            emergencyContactPhone: raw.emergency_contact_phone?.trim() || null,
            emergencyContactRelation: raw.emergency_contact_relation?.trim() || null,
            maritalStatus: raw.marital_status?.trim() || null,
            mobileNumber: raw.mobile_number?.trim() || null,
            bankName: raw.bank_name?.trim() || null,
            iban: raw.iban?.trim() || null,
            accountHolderName: raw.account_holder_name?.trim() || null,
            bankCode: raw.bank_code?.trim() || null,
            swiftCode: raw.swift_bic?.trim() || null,
            province: raw.province?.trim() || null,
            currentAddress: raw.current_address?.trim() || null,
            permanentAddress: raw.permanent_address?.trim() || null,
            educationLevel: raw.education_level?.trim() || null,
            highestQualification: raw.highest_qualification?.trim() || null,
            institutionName: raw.institution_name?.trim() || null,
            fieldOfStudy: raw.field_of_study?.trim() || null,
            employeeReference: raw.employee_reference?.trim() || null,
            areaOfExpertise: raw.area_of_expertise?.trim() || null,
            workingDays: raw.working_days?.trim() || null,
            cityOfResidence: raw.city_of_residence?.trim() || null,
            // Employment
            employeeId: effectiveEmployeeId,
            employeeType,
            employeeStatus,
            workingMode,
            workingShift: raw.working_shift?.trim() || null,
            password: hashedPassword,
            mustChangePassword: true,
            emailVerified: true,
            approvalStatus: ApprovalStatus.APPROVED,
            reviewedById: adminId,
            reviewedAt: new Date(),
            rejectionReason: null,
          },
          select: { id: true },
        });

        await tx.userRoleAssignment.create({
          data: { userId: user.id, roleId: role.id, isPrimary: true, assignedBy: adminId },
        });

        if (rentalAllowance !== null || commuteAllowance !== null) {
          await tx.payrollProfile.upsert({
            where: { userId: user.id },
            create: {
              userId: user.id,
              rentalAllowanceMonthly:
                rentalAllowance !== null
                  ? new Prisma.Decimal(Math.round(rentalAllowance * 100) / 100)
                  : undefined,
              commuteAllowanceMonthly:
                commuteAllowance !== null
                  ? new Prisma.Decimal(Math.round(commuteAllowance * 100) / 100)
                  : undefined,
            },
            update: {
              rentalAllowanceMonthly:
                rentalAllowance !== null
                  ? new Prisma.Decimal(Math.round(rentalAllowance * 100) / 100)
                  : undefined,
              commuteAllowanceMonthly:
                commuteAllowance !== null
                  ? new Prisma.Decimal(Math.round(commuteAllowance * 100) / 100)
                  : undefined,
            },
          });
        }

        await tx.leaveBalance.create({
          data: {
            userId: user.id,
            year,
            casualBalance: casualLeave,
            sickBalance: sickLeave,
            casualUsed: 0,
            sickUsed: 0,
          },
        });
      });

      return { row: rowNum, name, email, success: true };
    } catch (err) {
      this.logger.warn(`Row ${rowNum} failed: ${(err as Error).message}`);
      return {
        row: rowNum,
        name,
        email,
        success: false,
        errors: [(err as Error).message],
      };
    }
  }

  private parsePositiveFloat(
    val: string | undefined,
    field: string,
    errors: string[],
    defaultVal = 0,
  ): number {
    if (!val?.trim()) return defaultVal;
    const cleaned = val.trim().replace(/[^\d.-]/g, '');
    const n = parseFloat(cleaned);
    if (isNaN(n) || n < 0) {
      errors.push(`${field} must be a non-negative number`);
      return defaultVal;
    }
    return n;
  }

  private parseOptionalPositiveFloat(
    val: string | undefined,
    field: string,
    errors: string[],
  ): number | null {
    if (!val?.trim()) return null;
    const cleaned = val.trim().replace(/[^\d.-]/g, '');
    const n = parseFloat(cleaned);
    if (isNaN(n) || n < 0) {
      errors.push(`${field} must be a non-negative number`);
      return null;
    }
    return n;
  }

  private parseOptionalPositiveInt(
    val: string | undefined,
    field: string,
    errors: string[],
  ): number | null {
    if (!val?.trim()) return null;
    const n = parseInt(val.trim(), 10);
    if (isNaN(n) || n < 0) {
      errors.push(`${field} must be a non-negative integer`);
      return null;
    }
    return n;
  }

  private parsePositiveInt(
    val: string | undefined,
    field: string,
    errors: string[],
    defaultVal = 0,
  ): number {
    if (!val?.trim()) return defaultVal;
    const n = parseInt(val.trim(), 10);
    if (isNaN(n) || n < 0) {
      errors.push(`${field} must be a non-negative integer`);
      return defaultVal;
    }
    return n;
  }

  private parseBoolean(val: string | undefined, defaultVal = true): boolean {
    if (!val?.trim()) return defaultVal;
    const lower = val.trim().toLowerCase();
    if (['yes', '1', 'true'].includes(lower)) return true;
    if (['no', '0', 'false'].includes(lower)) return false;
    return defaultVal;
  }

  private parseEnum<T extends Record<string, string>>(
    val: string | undefined,
    enumObj: T,
    field: string,
    errors: string[],
  ): T[keyof T] | null {
    if (!val?.trim()) return null;
    const upper = val.trim().toUpperCase();
    if (Object.values(enumObj).includes(upper as T[keyof T])) {
      return upper as T[keyof T];
    }
    errors.push(`${field} must be one of: ${Object.values(enumObj).join(', ')}`);
    return null;
  }

  private static csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  static buildTemplateCsvContent(): string {
    const headers = [
      'full_name',
      'company_email',
      'personal_email',
      'designation',
      'department',
      'date_of_joining',
      'date_of_leaving',
      'probation_period',
      'employee_id',
      'employee_type',
      'employee_status',
      'working_mode',
      'working_shift',
      'working_days',
      'base_salary',
      'fixed_income_tax',
      'rental_allowance',
      'commute_allowance',
      'lunch_deduction_enabled',
      'date_of_birth',
      'cnic',
      'gender',
      'religion',
      'sect',
      'father_name',
      'marital_status',
      'mobile_number',
      'emergency_contact_name',
      'emergency_contact_phone',
      'emergency_contact_relation',
      'bank_name',
      'iban',
      'account_holder_name',
      'bank_code',
      'swift_bic',
      'province',
      'current_address',
      'permanent_address',
      'city_of_residence',
      'education_level',
      'highest_qualification',
      'institution_name',
      'field_of_study',
      'employee_reference',
      'area_of_expertise',
    ];
    const example = [
      'John Doe',
      'john.doe@company.com',
      'john.doe@gmail.com',
      'Software Engineer',
      'Software Engineering',
      '2026-01-15',
      '',
      '3',
      'DL_0001',
      'FULL_TIME',
      'ACTIVE',
      'ONSITE',
      '9:00 AM - 6:00 PM',
      'Mon-Fri',
      '50000',
      '5000',
      '3000',
      '2000',
      'Yes',
      '1995-06-15',
      '35202-1234567-1',
      'MALE',
      'Islam',
      'Sunni',
      'Muhammad Ali',
      'Married',
      '+923001234568',
      'Jane Doe',
      '+923001234567',
      'Spouse',
      'Meezan Bank',
      'PK00MEZN0000000000000000',
      'John Doe',
      'MEZN',
      'MEZNPKKA',
      'Punjab',
      '123 Current St, Lahore',
      '456 Permanent St, Lahore',
      'Lahore',
      'Masters',
      'MS Computer Science',
      'LUMS',
      'Computer Science',
      'Referred by Ali',
      'Backend Development',
    ];
    return [headers.join(','), example.map((v) => BulkImportService.csvEscape(v)).join(',')].join(
      '\n',
    );
  }
}
