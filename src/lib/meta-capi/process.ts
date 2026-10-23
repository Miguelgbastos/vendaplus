import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchQualificationEvent } from "@/lib/meta-capi/send";
import { extractMetaAttribution } from "@/lib/meta-capi/lead-attribution";
import type { QualificationStage } from "@/types/database";

type JobRow = {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

const QUALIFICATIONS = new Set<QualificationStage>([
  "mql",
  "sal",
  "sql",
  "oportunidade",
  "negociacao",
  "venda",
  "perda",
]);

/**
 * Processa um job `send_meta_capi_event`: carrega o lead + contato do banco,
 * monta o payload CAPI (com hashes) e envia via `dispatchQualificationEvent`.
 * Falhas transitórias (HTTP 5xx / 429 / rede) resultam em throw para o retry.
 */
export async function processMetaCapiJob(
  job: JobRow,
  workerId?: string,
): Promise<void> {
  const admin = createAdminClient();
  const leadId = typeof job.payload.lead_id === "string" ? job.payload.lead_id : null;
  const qualificationRaw =
    typeof job.payload.qualification === "string" ? job.payload.qualification : null;
  const qualification =
    qualificationRaw && QUALIFICATIONS.has(qualificationRaw as QualificationStage)
      ? (qualificationRaw as QualificationStage)
      : null;
  const occurredAt =
    typeof job.payload.occurred_at === "string" ? job.payload.occurred_at : null;
  const eventId =
    typeof job.payload.event_id === "string" && job.payload.event_id.trim()
      ? job.payload.event_id.trim()
      : `job-${job.id}`;

  if (!leadId || !qualification) {
    await markJob(admin, job.id, "completed", undefined, workerId);
    return;
  }

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select(
      "id, tenant_id, contact_id, name, price, utm_source, utm_medium, utm_campaign, utm_content, utm_term, custom_fields",
    )
    .eq("id", leadId)
    .eq("tenant_id", job.tenant_id)
    .maybeSingle();

  if (leadError) throw new Error(`meta_capi_lead_lookup_failed:${leadError.message}`);
  if (!lead) {
    await markJob(admin, job.id, "completed", undefined, workerId);
    return;
  }

  const metaAttribution = extractMetaAttribution(lead.custom_fields);

  let contact: {
    kommo_contact_id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null = null;

  if (lead.contact_id) {
    const { data, error: contactError } = await admin
      .from("contacts")
      .select("kommo_contact_id, name, email, phone")
      .eq("id", lead.contact_id)
      .eq("tenant_id", job.tenant_id)
      .maybeSingle();
    if (contactError) {
      throw new Error(`meta_capi_contact_lookup_failed:${contactError.message}`);
    }
    contact = data ?? null;
  }

  const outcome = await dispatchQualificationEvent({
    tenantId: job.tenant_id,
    leadId: lead.id,
    qualification,
    eventId,
    occurredAt,
    value: lead.price != null ? Number(lead.price) : null,
    // Eventos automáticos não fixam moeda: dispatchQualificationEvent usa a
    // currency configurada no mapping do tenant (fallback BRL).
    currency: null,
    user: {
      lead_id: metaAttribution.leadId,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      full_name: contact?.name ?? lead.name ?? null,
      external_id: contact?.kommo_contact_id ?? lead.contact_id ?? null,
      fbc: metaAttribution.fbc,
      fbp: metaAttribution.fbp,
    },
    custom: {
      utm_source: lead.utm_source ?? undefined,
      utm_medium: lead.utm_medium ?? undefined,
      utm_campaign: lead.utm_campaign ?? undefined,
      utm_content: lead.utm_content ?? undefined,
      utm_term: lead.utm_term ?? undefined,
    },
  });

  if (!outcome.skipped && !outcome.result.ok) {
    const status = outcome.result.httpStatus;
    const reason = outcome.result.errorMessage || `meta_capi_http_${status}`;
    // Transitórios (rede/5xx/429): throw para o worker retentar com backoff.
    if (status === 0 || status >= 500 || status === 429) {
      throw new Error(reason);
    }
    // 4xx definitivos (400/401/403): não concluir em silêncio. Marca o job como
    // `dead` com o erro para aparecer no replay-dead em vez de sumir.
    await markJob(admin, job.id, "dead", reason, workerId);
    return;
  }

  await markJob(admin, job.id, "completed", undefined, workerId);
}

async function markJob(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  status: "completed" | "dead",
  lastError?: string,
  workerId?: string,
) {
  // Lease fencing: só finaliza se ainda for o dono do lease.
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
  const { error } = await query;

  if (error) {
    throw new Error(`meta_capi_job_complete_failed:${error.message}`);
  }
}
