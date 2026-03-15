export const DEPARTMENTS = [
  'Accounts',
  'Admin',
  'AI / Data Science',
  'Human Resource',
  'Project Management',
  'Quality Assurance',
  'Sales & Marketing',
  'Software Engineering',
] as const;

export type Department = (typeof DEPARTMENTS)[number];
