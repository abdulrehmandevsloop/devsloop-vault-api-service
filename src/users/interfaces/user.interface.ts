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
  hasAccess: true,
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
} as const;
