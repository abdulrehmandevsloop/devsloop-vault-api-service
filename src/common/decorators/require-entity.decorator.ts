import { SetMetadata } from '@nestjs/common';

export const ENTITY_KEY = 'entity';
export const RequireEntity = (entityName: string) => SetMetadata(ENTITY_KEY, entityName);
