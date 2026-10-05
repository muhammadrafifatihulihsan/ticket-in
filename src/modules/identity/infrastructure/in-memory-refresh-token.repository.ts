import type {
  RefreshTokenRepository,
  TokenFamilyRecord,
} from '../application/ports/refresh-token.repository.port.js';

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly store = new Map<string, TokenFamilyRecord>();

  async saveFamily(record: TokenFamilyRecord): Promise<void> {
    this.store.set(record.familyId, { ...record });
  }

  async findFamily(familyId: string): Promise<TokenFamilyRecord | null> {
    const item = this.store.get(familyId);
    if (!item) return null;
    return { ...item };
  }

  async updateVersion(familyId: string, newVersion: number): Promise<void> {
    const item = this.store.get(familyId);
    if (item) {
      item.currentVersion = newVersion;
      this.store.set(familyId, item);
    }
  }

  async revokeFamily(familyId: string): Promise<void> {
    const item = this.store.get(familyId);
    if (item) {
      item.isRevoked = true;
      this.store.set(familyId, item);
    }
  }
}
