import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiResponse } from '../interface/api-response.interface';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((payload: any): ApiResponse<T> => {
        if (this.isApiResponse(payload)) {
          return {
            success: payload.success,
            message: payload.message,
            meta: payload.meta ?? {},
            data: payload.data ?? null,
          };
        }

        if (this.hasDataProperty(payload)) {
          return {
            success: true,
            message: payload.message ?? 'Success',
            meta: payload.meta ?? {},
            data: payload.data ?? null,
          };
        }

        return {
          success: true,
          message: 'Success',
          data: payload ?? null,
          meta: {},
        };
      }),
    );
  }

  private isApiResponse(value: any): value is ApiResponse {
    return (
      value &&
      typeof value === 'object' &&
      typeof value.success === 'boolean' &&
      typeof value.message === 'string'
    );
  }

  private hasDataProperty(
    value: any,
  ): value is { message?: string; meta?: any; data: any } {
    return value && typeof value === 'object' && 'data' in value;
  }
}
