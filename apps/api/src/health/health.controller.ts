import { Controller, Get } from '@nestjs/common';
import { Errors } from '../common/errors';
import { Public } from '../common/request-context';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /** Liveness: the process is up. It does not check the database. */
  @Public()
  @Get()
  get(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: the API can reach PostgreSQL. */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    if (!(await this.db.ping())) {
      throw Errors.unavailable('NOT_READY', 'Database is not reachable.');
    }
    return { status: 'ok' };
  }
}
