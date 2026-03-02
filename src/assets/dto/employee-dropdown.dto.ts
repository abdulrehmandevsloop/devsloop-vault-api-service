import { ApiProperty } from '@nestjs/swagger';

export class EmployeeDropdownItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}
