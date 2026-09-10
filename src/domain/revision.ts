export class RevisionConflictError extends Error {
  constructor(
    readonly entityId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`Revision conflict for ${entityId}: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = 'RevisionConflictError';
  }
}

export function assertExpectedRevision(entityId: string, actualRevision: number, expectedRevision: number): void {
  if (actualRevision !== expectedRevision) throw new RevisionConflictError(entityId, expectedRevision, actualRevision);
}

export function nextRevision(current: number): number {
  if (!Number.isInteger(current) || current < 1) throw new RangeError('Current revision must be a positive integer');
  return current + 1;
}
