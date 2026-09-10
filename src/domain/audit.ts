export type AuditEntityType = 'event' | 'calendar_settings';
export type AuditAction = 'create' | 'update' | 'archive' | 'restore' | 'approve' | 'reopen';

export interface AuditEntry {
  auditId: string;
  timestamp: string;
  actor: string;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  baseRevision: number | null;
  resultingRevision: number;
  payloadSummary: string;
}

export interface AuditQuery {
  entityId?: string;
  from?: string;
  to?: string;
}

export interface CalendarAudit {
  append(entry: AuditEntry): Promise<void>;
  list(query?: AuditQuery): Promise<AuditEntry[]>;
}
