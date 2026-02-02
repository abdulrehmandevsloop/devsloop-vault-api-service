export * from './rbac.module';
export * from './rbac.controller';
export * from './rbac.service';
export * from './dto';

// Re-export for backward compatibility
export { AclModule as RbacModule } from './rbac.module';
export { AclController as RbacController } from './rbac.controller';
export { AclService as RbacService } from './rbac.service';
