export interface SeatCategory {
  id: string;
  eventId: string;
  name: string;
  price: number;
  totalSeats: number;
  createdAt: Date;
}

export function validateSeatCategoryInput(input: {
  name: string;
  price: number;
  totalSeats: number;
}): { valid: boolean; reason?: string } {
  if (!input.name || input.name.trim().length === 0) {
    return { valid: false, reason: 'Category name must not be empty' };
  }
  if (!Number.isInteger(input.price) || input.price <= 0) {
    return { valid: false, reason: 'Price must be a positive integer in IDR' };
  }
  if (!Number.isInteger(input.totalSeats) || input.totalSeats <= 0) {
    return { valid: false, reason: 'Total seats must be a positive integer' };
  }
  return { valid: true };
}
