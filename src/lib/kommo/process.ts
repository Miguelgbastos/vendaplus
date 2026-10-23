import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { dashboardCacheTag } from "@/lib/dashboard-cache";
import { fetchKommoLead } from "@/lib/kommo/client";
import {
  completeQualificationMilestones,
  milestonesForQualification,
  normalizeKommoLead,
} from "@/lib/kommo/normalize";
import { resolveClosedAt } from "@/lib/kommo/closed-at";
import { enqueueMetaCapiEvent } from "@/lib/meta-capi/enqueue";
import type { FieldMapping, QualificationStage } from "@/types/database";

type JobRow = {
  id: string;
  tenant_id: string;
  raw_event_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export async function processKommoJob(
  job: JobRow,
  workerId?: string,
): Promise<void> {
  const admin = createAdminClient();
  const leadIds = Array.isArray(job.payload.lead_ids)
    ? job.payload.lead_ids.map(String)
    : [];

  if (!leadIds.length) {
    const finalized = await markJob(admin, job.id, "completed", undefined, workerId);
    if (finalized && job.raw_event_id) {
      await admin
        .from("raw_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", job.raw_event_id);
    }
    return;
  }

  const { data: mappings } = await admin
    .from("field_mappings")
    .select("*")
    .eq("tenant_id", job.tenant_id)
    .eq("is_active", true);

  for (const leadId of leadIds) {
    if (!/^\d+$/.test(leadId) || leadId === "0") {
      continue;
    }
    const rawLead = await fetchKommoLead(job.tenant_id, leadId);
    const normalized = normalizeKommoLead(
      rawLead,
      (mappings ?? []) as FieldMapping[],
    );
    await upsertNormalizedLead(admin, job.tenant_id, normalized, rawLead);
  }

  try {
    // Webhook/worker externo: precisa expirar imediatamente para que o próximo
    // acesso ao dashboard busque os dados novos, em vez do stale-while-revalidate
    // do profile "max" (que ainda serviria a agregação anterior à sync).
    revalidateTag(dashboardCacheTag(job.tenant_id), { expire: 0 });
  } catch {
    // noop
  }

  const finalized = await markJob(admin, job.id, "completed", undefined, workerId);
  // Só marca o raw_event como processado se este worker realmente finalizou o job
  // (lease ainda era dele). Caso contrário, quem reclamou o job é o responsável.
  if (finalized && job.raw_event_id) {
    await admin
      .from("raw_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", job.raw_event_id);
  }
}

async function markJob(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  status: "completed" | "failed" | "dead",
  lastError?: string,
  workerId?: string,
): Promise<boolean> {
  // Lease fencing: só finaliza o job se ainda for o dono do lease. Evita que um
  // worker com lease expirado sobrescreva o estado de outro que já o reclamou.
  let query = admin
    .from("jobs")
    .update({
      status,
      last_error: lastError ?? null,
      completed_at: status === "completed" ? new Date().toISOString() : null,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (workerId) query = query.eq("locked_by", workerId);
  // Retorna se alguma linha foi efetivamente atualizada (lease ainda válido).
  const { data } = await query.select("id");
  return Array.isArray(data) && data.length > 0;
}

export async function failJob(job: JobRow, error: unknown, workerId?: string) {
  const admin = createAdminClient();
  const message = error instanceof Error ? error.message : String(error);
  const dead = job.attempts >= job.max_attempts;
  // Backoff exponencial com jitter (±30%) para evitar retries sincronizados
  // martelando a Kommo após um outage.
  const backoffBase = Math.min(
    60_000 * 2 ** Math.max(job.attempts - 1, 0),
    3600_000,
  );
  const jitter = backoffBase * 0.3 * (Math.random() * 2 - 1);
  const availableAt = new Date(
    Date.now() + Math.max(1000, Math.round(backoffBase + jitter)),
  ).toISOString();

  let query = admin
    .from("jobs")
    .update({
      status: dead ? "dead" : "failed",
      last_error: message,
      available_at: dead ? new Date().toISOString() : availableAt,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  if (workerId) query = query.eq("locked_by", workerId);
  await query;
}

async function upsertNormalizedLead(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  normalized: ReturnType<typeof normalizeKommoLead>,
  rawLead: unknown,
) {
  if (!normalized.kommoLeadId) {
    throw new Error("Lead Kommo sem id.");
  }

  let previous: {
    id: string;
    qualification: QualificationStage | null;
    pipeline_id: string | null;
    status_id: string | null;
    status_name: string | null;
    custom_fields: Record<string, unknown>;
    closed_at: string | null;
  } | null = null;

  const { data } = await admin
    .from("leads")
    .select(
      "id, qualification, pipeline_id, status_id, status_name, custom_fields, closed_at",
    )
    .eq("tenant_id", tenantId)
    .eq("kommo_lead_id", normalized.kommoLeadId)
    .maybeSingle();
  previous = data;

  const completedCustomFields = completeQualificationMilestones(
    {
      ...(previous?.custom_fields ?? {}),
      ...normalized.customFields,
    },
    normalized.qualification,
  );

  const closedAt = resolveClosedAt({
    qualification: normalized.qualification,
    kommoClosedAt: normalized.closedAt,
    previousClosedAt: previous?.closed_at,
  });

  const previousQualification = previous?.qualification ?? null;
  let transitions: QualificationStage[] = [];
  if (
    normalized.qualification &&
    previousQualification !== normalized.qualification
  ) {
    const positiveStages = milestonesForQualification(normalized.qualification);
    const previousIndex = previousQualification
      ? positiveStages.indexOf(previousQualification)
      : -1;
    transitions =
      normalized.qualification === "perda"
        ? ["perda"]
        : !previousQualification
          ? positiveStages
          : previousIndex >= 0
            ? positiveStages.slice(previousIndex + 1)
            : [normalized.qualification];
  }

  const stageChanged = Boolean(
    previous &&
      (previous.status_id !== normalized.statusId ||
        previous.pipeline_id !== normalized.pipelineId),
  );

  const contactPayload = normalized.contact.kommoContactId
    ? {
        kommo_contact_id: normalized.contact.kommoContactId,
        name: normalized.contact.name,
        email: normalized.contact.email,
        phone: normalized.contact.phone,
        company: normalized.contact.company,
      }
    : null;

  const { data: leadId, error } = await admin.rpc("sync_kommo_lead_state", {
    p_tenant_id: tenantId,
    p_kommo_lead_id: normalized.kommoLeadId,
    p_lead: {
      name: normalized.name,
      pipeline_id: normalized.pipelineId,
      status_id: normalized.statusId,
      status_name: normalized.statusName,
      price: normalized.price != null ? String(normalized.price) : null,
      responsible_user_id: normalized.responsibleUserId,
      qualification: normalized.qualification,
      utm_source: normalized.utm_source,
      utm_medium: normalized.utm_medium,
      utm_campaign: normalized.utm_campaign,
      utm_content: normalized.utm_content,
      utm_term: normalized.utm_term,
      custom_fields: completedCustomFields,
      raw: rawLead,
      first_seen_at:
        normalized.createdAt ?? (previous ? null : new Date().toISOString()),
      closed_at: closedAt,
    },
    p_contact: contactPayload,
    p_transitions: transitions,
    p_from_qualification: previousQualification,
    p_stage_changed: stageChanged,
    p_previous_pipeline_id: previous?.pipeline_id ?? null,
    p_previous_status_id: previous?.status_id ?? null,
    p_previous_status_name: previous?.status_name ?? null,
    // Perda carimba o changed_at com o closed_at real (funil/dwell/CAPI corretos);
    // transições positivas são "live" e usam now() via coalesce no SQL.
    p_changed_at: normalized.qualification === "perda" ? closedAt : null,
  });

  if (error || !leadId) {
    throw new Error(error?.message || "Falha ao sincronizar lead.");
  }

  // Outbox CAPI é trigger SQL em qualification_history; shim mantido por compat.
  const occurredAt = new Date().toISOString();
  for (const toQualification of transitions) {
    try {
      await enqueueMetaCapiEvent(tenantId, {
        lead_id: String(leadId),
        qualification: toQualification,
        occurred_at: occurredAt,
      });
    } catch (err) {
      console.warn(
        "meta_capi_enqueue_failed",
        err instanceof Error ? err.name : "error",
      );
    }
  }
}
