import sql from '@/lib/db';
import type { SessionPayload } from '@/lib/auth-server';

export interface AuditInput {
  session?: SessionPayload | null;
  companyId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    const companyId = input.companyId ?? input.session?.companyId;
    if (!companyId) return;

    await sql`
      INSERT INTO public.audit_logs (
        company_id, user_id, action, entity_type, entity_id,
        old_value, new_value, ip_address, user_agent
      ) VALUES (
        ${companyId}, ${input.session?.userId ?? null}, ${input.action}, ${input.entityType}, ${input.entityId ?? null},
        ${input.oldValue == null ? null : JSON.stringify(input.oldValue)}::jsonb,
        ${input.newValue == null ? null : JSON.stringify(input.newValue)}::jsonb,
        ${input.ipAddress ?? null}, ${input.userAgent ?? null}
      )
    `;
  } catch (error) {
    // Audit logging must never break the main business operation.
    console.error('[audit]', error);
  }
}
