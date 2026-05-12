import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { ContactService } from './contact.service';
import { SubmitFormDto } from './dto/submit-form.dto';

@ApiTags('Public – Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a contact or booking inquiry from a landing page' })
  @ApiResponse({ status: 200, description: 'Message queued for delivery' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async submit(@Body() dto: SubmitFormDto): Promise<{ success: boolean; message: string }> {
    await this.contactService.submit(dto);
    return {
      success: true,
      message: "Message received. We'll be in touch within 48 hours.",
    };
  }
}
