export interface TokenFamilyRecord {
  familyId: string;
  userId: string;
  currentVersion: number;
  isRevoked: boolean;
  expiresAt: Date;
}

export interface RefreshTokenRepository {
  saveFamily(record: TokenFamilyRecord): Promise<void>;
  findFamily(familyId: string): Promise<TokenFamilyRecord | null>;
  updateVersion(familyId: string, newVersion: number): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
}
