import { beforeEach, describe, expect, it } from 'vitest';
import { CreateEventUseCase } from '../../../../src/modules/catalog/application/create-event.use-case.js';
import { InMemoryCatalogCache } from '../../../../src/modules/catalog/infrastructure/in-memory-catalog-cache.js';
import { InMemoryCatalogRepository } from '../../../../src/modules/catalog/infrastructure/in-memory-catalog.repository.js';
import { ConflictError, ValidationError } from '../../../../src/platform/errors/problem-details.js';

describe('CreateEventUseCase', () => {
  let repo: InMemoryCatalogRepository;
  let cache: InMemoryCatalogCache;
  let useCase: CreateEventUseCase;

  beforeEach(() => {
    repo = new InMemoryCatalogRepository();
    cache = new InMemoryCatalogCache();
    useCase = new CreateEventUseCase(repo, cache);
  });

  it('creates an event with valid categories and invalidates cache', async () => {
    const event = await useCase.execute({
      slug: 'indie-vibes-2026',
      title: 'Indie Vibes 2026',
      description: 'Intimate indie concert',
      venue: 'Tennis Indoor Senayan',
      saleStartsAt: new Date(Date.now() + 3600000),
      saleEndsAt: new Date(Date.now() + 86400000),
      categories: [
        { name: 'Festival', price: 650000, totalSeats: 500 },
        { name: 'Tribune', price: 450000, totalSeats: 300 },
      ],
    });

    expect(event.id).toBeDefined();
    expect(event.slug).toBe('indie-vibes-2026');
    expect(event.categories).toHaveLength(2);

    const found = await repo.findEventBySlug('indie-vibes-2026');
    expect(found).not.toBeNull();
  });

  it('throws ValidationError when saleEndsAt is not strictly after saleStartsAt', async () => {
    const invalidDate = new Date();
    await expect(
      useCase.execute({
        slug: 'invalid-dates',
        title: 'Invalid Dates Event',
        venue: 'GBK',
        saleStartsAt: invalidDate,
        saleEndsAt: invalidDate,
        categories: [{ name: 'VIP', price: 1000000, totalSeats: 100 }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when categories array is empty', async () => {
    await expect(
      useCase.execute({
        slug: 'empty-categories',
        title: 'Empty Categories Event',
        venue: 'GBK',
        saleStartsAt: new Date(),
        saleEndsAt: new Date(Date.now() + 3600000),
        categories: [],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when category price is negative or zero', async () => {
    await expect(
      useCase.execute({
        slug: 'negative-price',
        title: 'Negative Price Event',
        venue: 'GBK',
        saleStartsAt: new Date(),
        saleEndsAt: new Date(Date.now() + 3600000),
        categories: [{ name: 'VIP', price: -500, totalSeats: 100 }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ConflictError when slug already exists', async () => {
    await useCase.execute({
      slug: 'duplicate-slug',
      title: 'Original Event',
      venue: 'GBK',
      saleStartsAt: new Date(),
      saleEndsAt: new Date(Date.now() + 3600000),
      categories: [{ name: 'VIP', price: 1000000, totalSeats: 100 }],
    });

    await expect(
      useCase.execute({
        slug: 'duplicate-slug',
        title: 'Second Event',
        venue: 'GBK',
        saleStartsAt: new Date(),
        saleEndsAt: new Date(Date.now() + 3600000),
        categories: [{ name: 'VIP', price: 1000000, totalSeats: 100 }],
      }),
    ).rejects.toThrow(ConflictError);
  });
});
