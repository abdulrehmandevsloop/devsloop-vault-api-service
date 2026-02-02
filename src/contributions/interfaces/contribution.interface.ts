import { ContributionStatus, VisibilityLevel } from '@prisma/client';

export interface ContributionSelectFields {
  id: boolean;
  roleInProject: boolean;
  task: boolean;
  action: boolean;
  toolsTechnologies: boolean;
  outcome: boolean;
  keyLearnings: boolean;
  attachments: boolean;
  visibilityLevel: boolean;
  status: boolean;
  submittedAt: boolean;
  reviewedAt: boolean;
  reviewComments: boolean;
  createdAt: boolean;
  updatedAt: boolean;
  user: {
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
  tags: {
    select: {
      tag: {
        select: {
          id: boolean;
          name: boolean;
          category: boolean;
        };
      };
    };
  };
}

export const CONTRIBUTION_SELECT_FIELDS: ContributionSelectFields = {
  id: true,
  roleInProject: true,
  task: true,
  action: true,
  toolsTechnologies: true,
  outcome: true,
  keyLearnings: true,
  attachments: true,
  visibilityLevel: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewComments: true,
  createdAt: true,
  updatedAt: true,
  user: {
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
  tags: {
    select: {
      tag: {
        select: {
          id: true,
          name: true,
          category: true,
        },
      },
    },
  },
};

export interface ContributionWithRelations {
  id: string;
  roleInProject: string;
  task: string;
  action: string;
  toolsTechnologies: string[];
  outcome: string;
  keyLearnings: string;
  attachments: string[];
  visibilityLevel: VisibilityLevel;
  status: ContributionStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewComments: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
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
  tags: Array<{
    tag: {
      id: string;
      name: string;
      category: string | null;
    };
  }>;
}
