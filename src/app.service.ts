import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  getStatus() {
    return {
      status: 'running',
      service: 'DevsLoop Vault API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
