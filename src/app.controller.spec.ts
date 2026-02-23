import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return status payload', () => {
      const result = appController.getStatus();
      expect(result).toMatchObject({
        status: 'running',
        service: 'DevsLoop Vault API',
        version: '1.0.0',
      });
      expect(typeof result.timestamp).toBe('string');
    });
  });
});
