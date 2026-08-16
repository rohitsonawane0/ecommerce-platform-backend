import {
  ArgumentsHost,
  Catch,
  Logger,
  RpcExceptionFilter,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

interface RpcErrorShape {
  statusCode?: number;
  message?: string | string[];
  error?: string;
}

function isRpcErrorShape(value: unknown): value is RpcErrorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('statusCode' in value || 'message' in value)
  );
}

@Catch()
export class AllRpcExceptionsFilter implements RpcExceptionFilter {
  private readonly logger = new Logger(AllRpcExceptionsFilter.name);

  catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    console.log({ exception });
    if (exception instanceof RpcException) {
      const payload = exception.getError();
      this.logger.warn(
        `RpcException: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
      );
      return throwError(() => payload);
    }

    if (isRpcErrorShape(exception)) {
      this.logger.warn(`Upstream RPC error: ${JSON.stringify(exception)}`);
      return throwError(() => exception);
    }

    if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      return throwError(() => ({
        statusCode: 500,
        message: exception.message || 'Internal microservice error',
        error: exception.name || 'InternalServerError',
      }));
    }

    this.logger.error(`Unknown exception: ${JSON.stringify(exception)}`);
    return throwError(() => ({
      statusCode: 500,
      message: 'Internal microservice error',
      error: 'InternalServerError',
    }));
  }
}
