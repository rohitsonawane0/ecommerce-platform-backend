export class FindProductsQueryDto {
  search?: string; // ILIKE match on name and description
  page?: number; // default 1
  limit?: number; // default 10
  categories?: string;
}
