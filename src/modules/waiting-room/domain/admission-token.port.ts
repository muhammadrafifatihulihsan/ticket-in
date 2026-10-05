export interface AdmissionTokenPayload {
  sub: string;
  eventId: string;
  type: 'admission';
  iat?: number;
  exp?: number;
}

export interface AdmissionTokenServicePort {
  generateToken(userId: string, eventId: string, ttlSeconds?: number): string;
  verifyToken(token: string, expectedEventId: string, expectedUserId: string): AdmissionTokenPayload;
}
