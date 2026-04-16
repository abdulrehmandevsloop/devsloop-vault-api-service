import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus, PayrollPeriodStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from 'src/prisma';
import { RequestContextService } from 'src/common/services/request-context.service';

const SHORT_MONTHS: Record<string, string> = {
  '01': 'Jan',
  '02': 'Feb',
  '03': 'Mar',
  '04': 'Apr',
  '05': 'May',
  '06': 'Jun',
  '07': 'Jul',
  '08': 'Aug',
  '09': 'Sep',
  '10': 'Oct',
  '11': 'Nov',
  '12': 'Dec',
};

function buildPurpose(yearMonth: string): string {
  const [y, m] = yearMonth.split('-');
  const short = SHORT_MONTHS[m ?? ''] ?? m ?? '';
  return `${short}${y} Salary`;
}

function sanitizeAddress(address: string | null | undefined): string {
  if (!address) return '';
  return address
    .replace(/[,\-\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface RemittanceValidationError {
  employeeId: string;
  name: string;
  missingFields: string[];
}

interface RemittanceUser {
  id: string;
  name: string;
  employeeId: string | null;
  employeeStatus: string;
  iban: string | null;
  bankCode: string | null;
  accountHolderName: string | null;
  swiftCode: string | null;
  currentAddress: string | null;
  cityOfResidence: string | null;
  province: string | null;
}

@Injectable()
export class PayrollRemittanceExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async exportRemittanceXlsx(
    periodId: string,
    actorId: string,
  ): Promise<{
    buffer: Buffer;
    filename: string;
    checksum: number;
    rowCount: number;
    validationErrors: RemittanceValidationError[];
  }> {
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException(`Payroll period ${periodId} not found`);

    if (
      period.status !== PayrollPeriodStatus.AUTHORIZED &&
      period.status !== PayrollPeriodStatus.LOCKED
    ) {
      throw new ForbiddenException(
        'Exports are only available after the payroll period has been authorized',
      );
    }

    const purpose = buildPurpose(period.yearMonth);

    const allLines = await this.prisma.payrollLine.findMany({
      where: { periodId },
      orderBy: { displayName: 'asc' },
    });

    // Include consultants and employees explicitly marked for remittance payment
    const lines = allLines.filter(
      (l) =>
        l.employeeType === 'CONSULTANT' ||
        (l as Record<string, unknown>)['payViaRemittance'] === true,
    );

    if (lines.length === 0) {
      return {
        buffer: Buffer.alloc(0),
        filename: '',
        checksum: 0,
        rowCount: 0,
        validationErrors: [
          {
            employeeId: '',
            name: 'No remittance employees',
            missingFields: [
              'No consultants or "Pay via Remittance" employees found in this period',
            ],
          },
        ],
      };
    }

    const userIds = lines.map((l) => l.userId);

    // Raw query to access new fields that may not be in generated client yet
    const users = await this.prisma.$queryRaw<RemittanceUser[]>`
      SELECT id, name, "employeeId", "employeeStatus",
             iban, "bankCode", "accountHolderName", "swiftCode",
             "currentAddress", "cityOfResidence", province
      FROM users
      WHERE id = ANY(${userIds})
    `;
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Pre-validation
    const validationErrors: RemittanceValidationError[] = [];
    for (const line of lines) {
      const st = line.employeeStatus;
      if (st === EmployeeStatus.HOLD || st === EmployeeStatus.DEACTIVATED) continue;
      if (Number(line.netSalary) < 0) continue;
      const u = userMap.get(line.userId);
      if (!u) continue;
      const missing: string[] = [];
      if (!u.iban?.trim()) missing.push('IBAN');
      if (!u.bankCode?.trim()) missing.push('Bank Code');
      if (!u.accountHolderName?.trim()) missing.push('Account Holder Name');
      if (!u.swiftCode?.trim()) missing.push('SWIFT Code');
      if (!u.cityOfResidence?.trim()) missing.push('City of Residence');
      if (!u.province?.trim()) missing.push('Province / State');
      if (missing.length > 0) {
        validationErrors.push({
          employeeId: u.employeeId ?? '',
          name: u.name,
          missingFields: missing,
        });
      }
    }

    if (validationErrors.length > 0) {
      return {
        buffer: Buffer.alloc(0),
        filename: '',
        checksum: 0,
        rowCount: 0,
        validationErrors,
      };
    }

    // Build XLSX
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DevsLoop Vault';
    wb.created = new Date();

    const sheet = wb.addWorksheet('Remittance');
    sheet.properties.defaultRowHeight = 18;

    sheet.columns = [
      { header: 'Payment Mode', key: 'paymentMode', width: 16 },
      { header: 'Beneficiary Name', key: 'benefName', width: 28 },
      { header: 'Account Number', key: 'accountNo', width: 32 },
      { header: 'Bank Code', key: 'bankCode', width: 16 },
      { header: 'Beneficiary Addr. Line 1', key: 'addrLine1', width: 36 },
      { header: 'Town Name', key: 'town', width: 20 },
      { header: 'State/Emirate', key: 'state', width: 20 },
      { header: 'Country', key: 'country', width: 12 },
      { header: 'Transaction Currency', key: 'currency', width: 20 },
      { header: 'Payment Amount', key: 'amount', width: 18 },
      { header: 'Purpose of Payment', key: 'purpose', width: 24 },
      { header: 'Charge Type', key: 'chargeType', width: 14 },
      { header: 'Payment Type', key: 'paymentType', width: 14 },
      { header: 'Debit Account Indicator', key: 'debitIndicator', width: 24 },
      { header: 'Routing Code', key: 'routingCode', width: 16 },
      { header: 'Beneficiary Purpose Code', key: 'benePurposeCode', width: 26 },
      { header: 'Intermediary Bank Swift Code', key: 'interSwift', width: 28 },
      { header: 'Ultimate Debtor', key: 'ultimateDebtor', width: 20 },
      { header: 'Ultimate Creditor', key: 'ultimateCreditor', width: 20 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 22;

    let checksum = 0;
    let rowCount = 0;

    for (const line of lines) {
      const st = line.employeeStatus;
      if (st === EmployeeStatus.HOLD || st === EmployeeStatus.DEACTIVATED) continue;
      const u = userMap.get(line.userId);
      if (!u?.iban?.trim()) continue;

      const net = Number(line.netSalary);
      if (net < 0) continue;
      checksum += net;
      rowCount++;

      const dataRow = sheet.addRow({
        paymentMode: 'TT',
        benefName: u.accountHolderName ?? u.name,
        accountNo: u.iban.trim(),
        bankCode: u.bankCode ?? '',
        addrLine1: sanitizeAddress(u.currentAddress),
        town: u.cityOfResidence ?? '',
        state: u.province ?? '',
        country: 'PK',
        currency: 'PKR',
        amount: net,
        purpose,
        chargeType: 'OUR',
        paymentType: 'SAL',
        debitIndicator: 'A',
        routingCode: '',
        benePurposeCode: '',
        interSwift: u.swiftCode?.trim() ?? '',
        ultimateDebtor: '',
        ultimateCreditor: '',
      });

      // Force Account Number as text (prevent scientific notation)
      const accountCell = dataRow.getCell('accountNo');
      accountCell.numFmt = '@';
      accountCell.value = u.iban.trim();
      dataRow.getCell('amount').numFmt = '#,##0.00';
    }

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    checksum = Math.round(checksum * 100) / 100;

    await this.prisma.$transaction([
      this.prisma.payrollPeriod.update({
        where: { id: periodId },
        data: { lastExportAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actorId,
          action: 'PAYROLL_REMITTANCE_EXPORT',
          entityType: 'PayrollPeriod',
          entityId: periodId,
          changes: { yearMonth: period.yearMonth, exportRowCount: rowCount, checksum },
          ipAddress: this.requestContext.getIpAddress(),
          userAgent: this.requestContext.getUserAgent(),
        },
      }),
    ]);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return {
      buffer,
      filename: `remittance-${period.yearMonth}.xlsx`,
      checksum,
      rowCount,
      validationErrors: [],
    };
  }
}
