import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchQualificationEvent } from "@/lib/meta-capi/send";
import type { QualificationStage } from "@/types/database";

type JobRow = {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

/**
 * Processa um job `send_meta_capi_event`: carrega o lead + contato do banco,
 * monta o payload CAPI (com hashes) e envia via `dispatchQualificationEvent`.
 * Falhas transitórias (HTTP 5xx / rede) resultam em throw para o retry padrão.
 */
export async function processMetaCapiJob(job: JobRow): Promise<void> {
  const admin = createAdminClient();
  const leadId = typeof job.payload.lead_id === "string" ? job.payload.lead_id : null;
  const qualification =
    typeof job.payload.qualification === "string"
      ? (job.payload.qualification as QualificationStage)
      : null;
  const occurredAt =
    typeof job.payload.occurred_at === "string" ? job.payload.occurred_at : null;

  if (!leadId || !qualification) {
    await markJob(admin, job.id, "completed");
    return;
  }

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select(
      "id, tenant_id, contact_id, name, price, utm_source, utm_medium, utm_campaign, utm_content, utm_term",
    )
    .eq("id", leadId)
    .eq("tenant_id", job.tenant_id)
    .maybeSingle();

  if (leadError) throw new Error(leadError.message);
  if (!lead) {
    await markJob(admin, job.id, "completed");
    return;
  }

  let contact: {
    kommo_contact_id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null = null;

  if (lead.contact_id) {
    const { data } = await admin
      .from("contacts")
      .select("kommo_contact_id, name, email, phone")
      .eq("id", lead.contact_id)
      .eq("tenant_id", job.tenant_id)
      .maybeSingle();
    contact = data ?? null;
  }

  const outcome = await dispatchQualificationEvent({
    tenantId: job.tenant_id,
    leadId: lead.id,
    qualification,
    occurredAt,
    value: lead.price != null ? Number(lead.price) : null,
    currency: "BRL",
    user: {
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      full_name: contact?.name ?? lead.name ?? null,
      external_id: contact?.kommo_contact_id ?? lead.contact_id ?? null,
    },
    custom: {
      content_name: lead.name ?? undefined,
      utm_source: lead.utm_source ?? undefined,
      utm_medium: lead.utm_medium ?? undefined,
      utm_campaign: lead.utm_campaign ?? undefined,
      utm_content: lead.utm_content ?? undefined,
      utm_term: lead.utm_term ?? undefined,
    },
  });

  if (!outcome.skipped && !outcome.result.ok) {
    // Erros 5xx / rede devem tentar de novo. 4xx (config/permissão) marcam falhado
    // sem retries úteis; deixamos o retry padrão decidir, mas registramos o erro.
    const status = outcome.result.httpStatus;
    if (status === 0 || status >= 500 || status === 429) {
      throw new Error(
        outcome.result.errorMessage || `meta_capi_http_${status}`,
      );
    }
  }

  await markJob(admin, job.id, "completed");
}

async function markJob(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  status: "completed",
) {
  await admin
    .from("jobs")
    .update({
      status,
      last_error: null,
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}
