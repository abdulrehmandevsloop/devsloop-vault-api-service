import { Controller, Get } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { BirthdayEmployeeDto } from './dto/birthday-employee.dto';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // ===========================================================================
  // GET /employees/birthdays
  // Returns employees whose birthdays fall within today and the next 7 days,
  // sorted by daysUntilBirthday ascending (today first).
  // ===========================================================================
  @Get('birthdays')
  async getUpcomingBirthdays(): Promise<BirthdayEmployeeDto[]> {
    return this.employeesService.getUpcomingBirthdays();
  }
}