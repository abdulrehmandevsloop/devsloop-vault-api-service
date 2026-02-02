import { ContributionStatus, VisibilityLevel } from '@prisma/client';

export interface ContributionSelectFields {
  id: boolean;
  problem: boolean;
  solution: boolean;
  outcome: boolean;
  learnings: boolean;
  toolsAndTechnologies: boolean;
  visibility: boolean;
  status: boolean;
  reviewerComment: boolean;
  reviewedAt: boolean;
  rejectionCount: boolean;
  createdAt: boolean;
  updatedAt: boolean;
  author: {
    select: {
      id: boolean;
      name: boolean;
      email: boolean;
    };
  };
  project: {
    select: {
      id: boolean;
      name: boolean;
      clientName: boolean;
    };
  };
  reviewer?: {
    select: {
      id: boolean;
      name: boolean;
      email: boolean;
    };
  };
}

export const CONTRIBUTION_SELECT_FIELDS: ContributionSelectFields = {
  id: true,
  problem: true,
  solution: true,
  outcome: true,
  learnings: true,
  toolsAndTechnologies: true,
  visibility: true,
  status: true,
  reviewerComment: true,
  reviewedAt: true,
  rejectionCount: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  project: {
    select: {
      id: true,
      name: true,
      clientName: true,
    },
  },
  reviewer: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
};

export interface ContributionWithRelations {
  id: string;
  problem: string;
  solution: string;
  outcome: string | null;
  learnings: string | null;
  toolsAndTechnologies: string[];
  visibility: VisibilityLevel;
  status: ContributionStatus;
  reviewerComment: string | null;
  reviewedAt: Date | null;
  rejectionCount: number;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string;
    email: string;
  };
  project: {
    id: string;
    name: string;
    clientName: string | null;
  };
  reviewer: {
    id: string;
    name: string;
    email: string;
  } | null;
}
