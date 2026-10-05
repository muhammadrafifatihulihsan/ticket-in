export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

export interface Event {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  venue: string;
  saleStartsAt: Date;
  saleEndsAt: Date;
  status: EventStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  venue: string;
  saleStartsAt: string;
  saleEndsAt: string;
  status: EventStatus;
}

export interface EventDetail extends EventSummary {
  description: string | null;
  categories: {
    id: string;
    name: string;
    price: number;
    totalSeats: number;
  }[];
  createdAt: string;
}

export function validateEventSchedule(saleStartsAt: Date, saleEndsAt: Date): boolean {
  return saleStartsAt.getTime() < saleEndsAt.getTime();
}
