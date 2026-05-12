import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBossService } from '../queue/pg-boss.service';
import { FormType, SubmitFormDto } from './dto/submit-form.dto';
import { contactTemplate } from './templates/contact.template';
import { bookingTemplate } from './templates/booking.template';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly pgBossService: PgBossService,
    private readonly configService: ConfigService,
  ) {}

  async submit(dto: SubmitFormDto): Promise<{ success: boolean }> {
    const recipient = this.configService.getOrThrow<string>('CONTACT_RECIPIENT_EMAIL');

    const { subject, html } =
      dto.type === FormType.BOOKING ? this.buildBookingEmail(dto) : this.buildContactEmail(dto);

    await this.pgBossService.sendToQueue('email-notification', {
      to: recipient,
      subject,
      html,
    });

    this.logger.log(`Contact form (${dto.type}) submitted by ${dto.email}`);
    return { success: true };
  }

  private buildContactEmail(dto: SubmitFormDto): { subject: string; html: string } {
    return {
      subject: 'New Contact Form Submission',
      html: contactTemplate({
        name: this.escape(dto.name),
        email: this.escape(dto.email),
        message: this.escape(dto.message).replace(/\n/g, '<br>'),
      }),
    };
  }

  private buildBookingEmail(dto: SubmitFormDto): { subject: string; html: string } {
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Name', value: dto.name },
      { label: 'Email', value: dto.email },
      ...(dto.organization ? [{ label: 'Organization', value: dto.organization }] : []),
      ...(dto.eventName ? [{ label: 'Event', value: dto.eventName }] : []),
      ...(dto.eventDate ? [{ label: 'Date', value: dto.eventDate }] : []),
      ...(dto.audienceSize ? [{ label: 'Audience Size', value: dto.audienceSize }] : []),
      ...(dto.topic ? [{ label: 'Topic', value: dto.topic }] : []),
      ...(dto.budget ? [{ label: 'Budget', value: dto.budget }] : []),
    ].map((r) => ({ label: r.label, value: this.escape(r.value) }));

    return {
      subject: `New Booking Inquiry – ${this.escape(dto.eventName ?? dto.name)}`,
      html: bookingTemplate({
        rows,
        message: this.escape(dto.message).replace(/\n/g, '<br>'),
      }),
    };
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
