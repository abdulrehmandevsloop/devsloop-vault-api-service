import { ApprovalStatus } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  departments: string[];
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
