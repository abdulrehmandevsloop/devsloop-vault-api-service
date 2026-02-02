import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_KEY = 'allowPending';
export const AllowPending = () => SetMetadata(ALLOW_PENDING_KEY, true);
