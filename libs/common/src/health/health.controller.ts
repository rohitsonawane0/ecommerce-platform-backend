import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import { Public } from '../decorators';

/**
 * Liveness + readiness endpoints, shared by every service.
 *
 * Nothing here throws: the TCP microservices run as hybrid apps with
 * AllRpcExceptionsFilter registered globally, and that filter is @Catch()-all
 * and returns an Observable — which an HTTP response cannot consume. So the
 * "not ready" case sets the status code on the response instead of throwing.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Optional()
    @Inject(getDataSourceToken())
    private readonly dataSource?: DataSource,
  ) {}

  /** Liveness: is the process up? A failure here means the pod gets restarted. */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  /**
   * Readiness: can the service actually serve? A failure here removes the pod
   * from Service endpoints but does NOT restart it — correct while a database
   * is briefly unreachable.
   */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    if (!this.dataSource) {
      return { status: 'ok', database: 'not-configured' };
    }

    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch (err) {
      res.status(503);
      return {
        status: 'error',
        database: 'down',
        message: err instanceof Error ? err.message : 'unknown error',
      };
    }
  }
}
