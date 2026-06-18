-- Add a salary-adjustment type for a negative net salary carried into the next
-- payroll month (created on bank-sheet export). DEDUCTION category.
ALTER TYPE "SalaryAdjustmentType" ADD VALUE IF NOT EXISTS 'CARRIED_FORWARD_BALANCE';
