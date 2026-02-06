import { SetMetadata } from '@nestjs/common';

export const ENTITY_KEY = 'entity';
/**
 * Require entity access for an endpoint
 * @param entities - Single entity name or array of entity names
 * @example @RequireEntity('project')
 * @example @RequireEntity('project', 'contribution') // User needs access to ANY of these entities (OR logic)
 */
export const RequireEntity = (...entities: string[]) => {
  // Normalize to always return an array
  const entityArray =
    entities.length === 1 && typeof entities[0] === 'string' ? [entities[0]] : entities;
  return SetMetadata(ENTITY_KEY, entityArray);
};
