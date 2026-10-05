import { v7 as uuidv7 } from 'uuid';

/**
 * IdGenerator port interface for generating unique identifiers.
 */
export interface IdGenerator {
  generate(): string;
}

export class UuidV7Generator implements IdGenerator {
  generate(): string {
    return uuidv7();
  }
}

export class DeterministicIdGenerator implements IdGenerator {
  private sequence: string[];
  private currentIndex = 0;

  constructor(sequence: string[] = []) {
    this.sequence = [...sequence];
  }

  generate(): string {
    const id = this.sequence[this.currentIndex];
    if (!id) {
      this.currentIndex++;
      return `deterministic-id-${this.currentIndex}`;
    }
    this.currentIndex++;
    return id;
  }

  reset(): void {
    this.currentIndex = 0;
  }
}
