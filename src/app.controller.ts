import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getStatus() {
    return this.appService.getStatus();
  }
}
