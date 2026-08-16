import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Request, Response } from 'express';

interface RpcErrorShape {
  statusCode?: number;
  message?: string | string[];
  error?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // console.log({ exception });
    if (exception instanceof RpcException) {
      const payload = exception.getError() as RpcErrorShape | string;
      if (typeof payload === 'object' && payload) {
        return {
          status: payload.statusCode ?? 500,
          message: payload.message ?? 'Microservice error',
          error: payload.error ?? 'RpcException',
        };
        
      }
      return { status: 500, message: String(payload), error: 'RpcException' };
    }
    const { status, message, error } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error
          ? exception.stack
          : JSON.stringify(exception),
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private resolve(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
  } {
    console.log(exception);
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const status = exception.getStatus();
      if (typeof res === 'string') {
        return { status, message: res, error: exception.name };
      }
      const obj = res as RpcErrorShape & { message?: string | string[] };
      return {
        status,
        message: obj.message ?? exception.message,
        error: obj.error ?? exception.name,
      };
    }

    if (this.isRpcError(exception)) {
      const status = exception.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
      return {
        status,
        message: exception.message ?? 'Microservice error',
        error: exception.error ?? 'RpcException',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        exception instanceof Error
          ? exception.message
          : 'Internal server error',
      error: 'InternalServerError',
    };
  }

  private isRpcError(value: unknown): value is RpcErrorShape {
    return (
      typeof value === 'object' &&
      value !== null &&
      ('statusCode' in value || 'message' in value)
    );
  }
}
