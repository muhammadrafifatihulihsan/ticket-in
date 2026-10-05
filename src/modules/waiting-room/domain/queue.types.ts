export type QueueStatus = 'QUEUED' | 'ADMITTED' | 'EXPIRED' | 'NOT_IN_QUEUE';

export interface QueuePosition {
  status: QueueStatus;
  rank?: number | undefined;
  totalInQueue?: number | undefined;
  estimatedWaitSeconds?: number | undefined;
  admissionToken?: string | undefined;
  expiresIn?: number | undefined;
}
