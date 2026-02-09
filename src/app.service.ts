import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus() {
    return {
      status: 'running',
      service: 'DevsLoop Vault API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}
