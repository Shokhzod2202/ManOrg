import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/request-context';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  get(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
