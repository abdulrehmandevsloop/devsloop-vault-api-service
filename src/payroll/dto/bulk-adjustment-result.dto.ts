export interface BulkAdjustmentRowResult {
  row: number;
  employeeId: string;
  name: string | null;
  bonus: number | null;
  deduction: number | null;
  extraWorkingDays: number | null;
  currentBonus: number;
  currentDeduction: number;
  currentExtraWorkingDays: number;
  errors: string[];
  valid: boolean;
}

export interface BulkAdjustmentResult {
  total: number;
  valid: number;
  invalid: number;
  applied: boolean;
  rows: BulkAdjustmentRowResult[];
}
