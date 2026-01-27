import { ApprovalStatus } from '@prisma/client';

export interface UserSelectFields {
  id: boolean;
  email: boolean;
  name: boolean;
  roleId: boolean;
  role?: {
    select: {
      id: boolean;
      name: boolean;
      displayName: boolean;
      description: boolean;
      isSystem: boolean;
    };
  };
  department: boolean;
  avatarUrl: boolean;
  emailVerified: boolean;
  hasAccess: boolean;
  approvalStatus: boolean;
  reviewedAt: boolean;
  rejectionReason: boolean;
  createdAt: boolean;
  updatedAt: boolean;
  reviewedBy?: {
    select: {
      id: boolean;
      name: boolean;
      email: boolean;
    };
  };
}

export interface UserWithReviewer {
  id: string;
  email: string;
  name: string;
  roleId: string | null;
  role: {
    id: string;
    name: string;
    displayName: string;
    description?: string | null;
    isSystem: boolean;
  } | null;
  department: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  hasAccess: number;
  approvalStatus: ApprovalStatus;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviewedBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export const USER_SELECT_FIELDS: UserSelectFields = {
  id: true,
  email: true,
  name: true,
  roleId: true,
  role: {
    select: {
      id: true,
      name: true,
      displayName: true,
      description: true,
      isSystem: true,
    },
  },
  department: true,
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
};
