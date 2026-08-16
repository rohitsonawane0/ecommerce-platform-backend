export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T | null;
  meta?: Record<string, any>;
}
