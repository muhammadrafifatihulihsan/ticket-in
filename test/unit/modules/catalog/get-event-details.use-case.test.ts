import { beforeEach, describe, expect, it } from 'vitest';
import { GetEventDetailsUseCase } from '../../../../src/modules/catalog/application/get-event-details.use-case.js';
import { InMemoryCatalogCache } from '../../../../src/modules/catalog/infrastructure/in-memory-catalog-cache.js';
import { InMemoryCatalogRepository } from '../../../../src/modules/catalog/infrastructure/in-memory-catalog.repository.js';
import { NotFoundError } from '../../../../src/platform/errors/problem-details.js';

describe('GetEventDetailsUseCase', () => {
  let repo: InMemoryCatalogRepository;
  let cache: InMemoryCatalogCache;
  let useCase: GetEventDetailsUseCase;

  beforeEach(() => {
    repo = new InMemoryCatalogRepository();
    cache = new InMemoryCatalogCache();
    useCase = new GetEventDetailsUseCase(repo, cache);
  });

  it('retrieves event details by slug with seat categories', async () => {
    const created = await repo.createEvent(
      {
        slug: 'rock-fest-2026',
        title: 'Rock Fest 2026',
        description: 'Annual rock festival',
        venue: 'GBK Senayan',
        saleStartsAt: new Date(),
        saleEndsAt: new Date(Date.now() + 86400000),
      },
      [
        { name: 'VIP', price: 1500000, totalSeats: 100 },
        { name: 'CAT1', price: 800000, totalSeats: 400 },
      ],
    );

    const details = await useCase.execute('rock-fest-2026');
    expect(details.id).toBe(created.id);
    expect(details.title).toBe('Rock Fest 2026');
    expect(details.categories).toHaveLength(2);
    expect(details.categories[0]?.name).toBe('VIP');
    expect(details.categories[0]?.price).toBe(1500000);
  });

  it('retrieves event details by id', async () => {
    const created = await repo.createEvent(
      {
        slug: 'jazz-fest-2026',
        title: 'Jazz Fest 2026',
        venue: 'JIExpo Kemayoran',
        saleStartsAt: new Date(),
        saleEndsAt: new Date(Date.now() + 86400000),
      },
      [{ name: 'General', price: 500000, totalSeats: 300 }],
    );

    const details = await useCase.execute(created.id);
    expect(details.slug).toBe('jazz-fest-2026');
  });

  it('throws NotFoundError when event does not exist', async () => {
    await expect(useCase.execute('non-existent-slug')).rejects.toThrow(NotFoundError);
  });
});
