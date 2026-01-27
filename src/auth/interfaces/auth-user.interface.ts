import { UserRole, ApprovalStatus } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole | null;
  department: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  approvalStatus?: ApprovalStatus;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TokenPayload {
  sub: string;
  email: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}
