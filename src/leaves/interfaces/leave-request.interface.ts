export const LEAVE_REQUEST_SELECT_FIELDS = {
  id: true,
  employeeId: true,
  reportingManagerId: true,
  leaveType: true,
  status: true,
  startDate: true,
  endDate: true,
  halfDayPeriod: true,
  daysConsumed: true,
  reason: true,
  medicalCertificateUrl: true,
  teamLeadId: true,
  teamLeadComment: true,
  teamLeadReviewedAt: true,
  requiresClientApproval: true,
  hrId: true,
  hrComment: true,
  hrReviewedAt: true,
  category: true,
  unpaidDays: true,
  originalLeaveType: true,
  appliedByHrId: true,
  createdAt: true,
  updatedAt: true,
  employee: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      departments: true,
      designation: true,
    },
  },
  reportingManager: {
    select: { id: true, name: true, email: true },
  },
  teamLead: {
    select: { id: true, name: true, email: true },
  },
  hr: {
    select: { id: true, name: true, email: true },
  },
  appliedByHr: {
    select: { id: true, name: true, email: true },
  },
} as const;

export type LeaveRequestWithRelations = {
  id: string;
  employeeId: string;
  reportingManagerId: string;
  leaveType: string;
  status: string;
  startDate: Date;
  endDate: Date;
  halfDayPeriod: string | null;
  daysConsumed: { toNumber(): number };
  reason: string;
  medicalCertificateUrl: string | null;
  teamLeadId: string | null;
  teamLeadComment: string | null;
  teamLeadReviewedAt: Date | null;
  requiresClientApproval: boolean;
  hrId: string | null;
  hrComment: string | null;
  hrReviewedAt: Date | null;
  category: string | null;
  unpaidDays: { toNumber(): number };
  originalLeaveType: string | null;
  appliedByHrId: string | null;
  createdAt: Date;
  updatedAt: Date;
  employee: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    departments: string[];
    designation: string | null;
  };
  reportingManager: { id: string; name: string; email: string };
  teamLead: { id: string; name: string; email: string } | null;
  hr: { id: string; name: string; email: string } | null;
  appliedByHr: { id: string; name: string; email: string } | null;
};
