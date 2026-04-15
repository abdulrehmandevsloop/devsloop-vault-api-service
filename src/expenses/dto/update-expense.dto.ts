import { PartialType } from '@nestjs/swagger';
import { CreateExpenseDto } from 'src/expenses/dto/create-expense.dto';

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
