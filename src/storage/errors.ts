export class EntityNotFoundError extends Error {
  constructor(readonly entityId: string) {
    super(`Entity not found: ${entityId}`);
    this.name = 'EntityNotFoundError';
  }
}

export class EntityAlreadyExistsError extends Error {
  constructor(readonly entityId: string) {
    super(`Entity already exists: ${entityId}`);
    this.name = 'EntityAlreadyExistsError';
  }
}
