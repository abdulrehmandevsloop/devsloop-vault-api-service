import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EmployeesService } from '../services/employees.service';

@ApiTags('Employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get('/birthdays')
  getBirthdays(@Query() query): Promise<{ id: number; name: string; profilePicture: string; birthday: Date; daysUntilBirthday: number }[]> {
    const { today = new Date(), daysRange = 7 } = query;
    return this.employeesService.getEmployeesWithBirthdaysInRange(today, daysRange);
  }
}