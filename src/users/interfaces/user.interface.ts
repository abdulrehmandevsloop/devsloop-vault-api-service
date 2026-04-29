export const USER_SELECT_FIELDS = {
  id: true,
  email: true,
  name: true,
  isSystem: true,
  personalEmail: true,
  userRoleAssignments: {
    where: {
      role: {
        isActive: true,
      },
    },
    select: {
      isPrimary: true,
      role: {
        select: {
          id: true,
          name: true,
          displayName: true,
          description: true,
        },
      },
    },
  },
  departments: true, // User model has "departments" (array), not "department"
  designation: true,
  joiningDate: true,
  leaveDate: true,
  baseSalaryMonthly: true,
  casualLeaveBalance: true,
  sickLeaveBalance: true,
  annualLeaveBalance: true,
  wfhAllowancePerMonth: true,
  avatarUrl: true,
  emailVerified: true,
  approvalStatus: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  reviewedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  welcomeEmailSentAt: true,

  // Personal Information
  dateOfBirth: true,
  cnic: true,
  gender: true,
  religion: true,
  sect: true,
  fatherName: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,

  // Employment Information
  employeeId: true,
  employeeType: true,
  employeeStatus: true,
  probationPeriod: true,
  workingModel: true,
  workingMode: true,
  workingShift: true,

  // Payroll profile defaults (consultant pay mode, rates)
  payrollProfile: {
    select: {
      defaultConsultantPayMode: true,
      defaultDailyRate: true,
      defaultHourlyRate: true,
      rentalAllowanceMonthly: true,
      commuteAllowanceMonthly: true,
      paymentMode: true,
    },
  },

  // Personal extended fields
  maritalStatus: true,
  mobileNumber: true,
  currentAddress: true,
  permanentAddress: true,
  cityOfResidence: true,
  bankName: true,
  iban: true,
  educationLevel: true,
  highestQualification: true,
  institutionName: true,
  fieldOfStudy: true,
  employeeReference: true,
  areaOfExpertise: true,

  // Employment extended fields
  workingDays: true,
  teamLead: true,

  // Special leave type access (HR-controlled per employee)
  allowMaternityLeave: true,
  allowWeddingLeave: true,
  allowUmrahHajjLeave: true,
  allowOtherLeave: true,
  allowExtraWfh: true,
} as const;

/**
 * Slim select for the user-management list table.
 * Keep this minimal to reduce payload and query cost.
 *
 * Note: We still include a few non-displayed fields used for UI logic/actions.
 */
export const USER_LIST_SELECT_FIELDS = {
  id: true,
  email: true,
  name: true,
  isSystem: true,
  userRoleAssignments: USER_SELECT_FIELDS.userRoleAssignments,
  designation: true,
  joiningDate: true,
  employeeId: true,
  approvalStatus: true,
  employeeStatus: true,
  // Keep createdAt for stable sorting / UI needs (even if not shown)
  createdAt: true,
  welcomeEmailSentAt: true,
} as const;
