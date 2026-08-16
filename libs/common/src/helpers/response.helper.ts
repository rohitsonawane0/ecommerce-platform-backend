import { ApiResponse } from '../interface/api-response.interface';

export class ResponseHelper {
  static success<T>(
    data: T,
    message = 'Success',
    meta?: Record<string, any>,
  ): ApiResponse<T> {
    return { success: true, message, data, meta };
  }

  static error(message = 'Something went wrong'): ApiResponse<null> {
    return { success: false, message, data: null };
  }
}
