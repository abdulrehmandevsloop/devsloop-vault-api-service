export const DEPARTMENTS = [
  'Software Engineering',
  'Marketing/Sales',
  'HR Department',
  'Finance',
] as const;

export type Department = (typeof DEPARTMENTS)[number];
