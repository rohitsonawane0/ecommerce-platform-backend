import { IsOptional } from 'class-validator';

export class FindProductsQueryDto {
  @IsOptional()
  search?: string; // ILIKE match on name and description
  @IsOptional()
  page?: number; // default 1
  @IsOptional()
  limit?: number; // default 10

  @IsOptional()
  categories?: string;
}
