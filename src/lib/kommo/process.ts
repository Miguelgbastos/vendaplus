import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { dashboardCacheTag } from "@/lib/dashboard-cache";
import { fetchKommoLead } from "@/lib/kommo/client";
import {
  completeQualificationMilestones,
  milestonesForQualification,
  normalizeKommoLead,
} from "@/lib/kommo/normalize";
import type { FieldMapping, QualificationStage } from "@/types/database";

type JobRow = {
  id: string;
  tenant_id: string;
  raw_event_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export async function processKommoJob(job: JobRow): Promise<void> {
  const admin = createAdminClient();
  const leadIds = Array.isArray(job.payload.lead_ids)
    ? job.payload.lead_ids.map(String)
    : [];

  if (!leadIds.length) {
    await markJob(admin, job.id, "completed");
    if (job.raw_event_id) {
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

  await markJob(admin, job.id, "completed");
  if (job.raw_event_id) {
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
) {
  await admin
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
}

export async function failJob(job: JobRow, error: unknown) {
  const admin = createAdminClient();
  const message = error instanceof Error ? error.message : String(error);
  const dead = job.attempts >= job.max_attempts;
  const availableAt = new Date(
    Date.now() + Math.min(60_000 * 2 ** Math.max(job.attempts - 1, 0), 3600_000),
  ).toISOString();

  await admin
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
}

async function upsertNormalizedLead(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  normalized: ReturnType<typeof normalizeKommoLead>,
  rawLead: unknown,
) {
  let contactId: string | null = null;

  if (normalized.contact.kommoContactId || normalized.contact.email || normalized.contact.phone) {
    const contactPayload = {
      tenant_id: tenantId,
      kommo_contact_id: normalized.contact.kommoContactId,
      name: normalized.contact.name,
      email: normalized.contact.email,
      phone: normalized.contact.phone,
      company: normalized.contact.company,
      raw: normalized.contact,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (normalized.contact.kommoContactId) {
      const { data } = await admin
        .from("contacts")
        .upsert(contactPayload, {
          onConflict: "tenant_id,kommo_contact_id",
        })
        .select("id")
        .single();
      contactId = data?.id ?? null;
    } else {
      const { data } = await admin
        .from("contacts")
        .insert(contactPayload)
        .select("id")
        .single();
      contactId = data?.id ?? null;
    }
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

  if (normalized.kommoLeadId) {
    const { data } = await admin
      .from("leads")
      .select(
        "id, qualification, pipeline_id, status_id, status_name, custom_fields, closed_at",
      )
      .eq("tenant_id", tenantId)
      .eq("kommo_lead_id", normalized.kommoLeadId)
      .maybeSingle();
    previous = data;
  }

  const completedCustomFields = completeQualificationMilestones(
    {
      ...(previous?.custom_fields ?? {}),
      ...normalized.customFields,
    },
    normalized.qualification,
  );

  // Align dashboard date filters with Kommo "created at": prefer Kommo
  // created_at. Only fall back to "now" on first insert when missing.
  const firstSeenAt =
    normalized.createdAt ??
    (previous ? undefined : new Date().toISOString());

  const isClosed =
    normalized.qualification === "venda" ||
    normalized.qualification === "perda";
  const closedAt = isClosed
    ? normalized.closedAt ?? previous?.closed_at ?? new Date().toISOString()
    : null;

  const leadPayload = {
    tenant_id: tenantId,
    contact_id: contactId,
    kommo_lead_id: normalized.kommoLeadId,
    name: normalized.name,
    pipeline_id: normalized.pipelineId,
    status_id: normalized.statusId,
    status_name: normalized.statusName,
    price: normalized.price,
    responsible_user_id: normalized.responsibleUserId,
    qualification: normalized.qualification,
    utm_source: normalized.utm_source,
    utm_medium: normalized.utm_medium,
    utm_campaign: normalized.utm_campaign,
    utm_content: normalized.utm_content,
    utm_term: normalized.utm_term,
    custom_fields: completedCustomFields,
    raw: rawLead,
    ...(firstSeenAt ? { first_seen_at: firstSeenAt } : {}),
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    closed_at: closedAt,
  };

  if (!normalized.kommoLeadId) {
    throw new Error("Lead Kommo sem id.");
  }

  const { data: lead, error } = await admin
    .from("leads")
    .upsert(leadPayload, { onConflict: "tenant_id,kommo_lead_id" })
    .select("id")
    .single();

  if (error || !lead) {
    throw new Error(error?.message || "Falha ao upsert lead.");
  }

  const previousQualification = previous?.qualification ?? null;
  if (
    normalized.qualification &&
    previousQualification !== normalized.qualification
  ) {
    const positiveStages = milestonesForQualification(normalized.qualification);
    const previousIndex = previousQualification
      ? positiveStages.indexOf(previousQualification)
      : -1;
    const transitions =
      normalized.qualification === "perda"
        ? ["perda" as const]
        : !previousQualification
          ? positiveStages
          : previousIndex >= 0
            ? positiveStages.slice(previousIndex + 1)
            : [normalized.qualification];

    let fromQualification = previousQualification;
    for (const toQualification of transitions) {
      await admin.from("qualification_history").insert({
        tenant_id: tenantId,
        lead_id: lead.id,
        from_qualification: fromQualification,
        to_qualification: toQualification,
        source: "kommo",
        metadata: {
          inferred: toQualification !== normalized.qualification,
          initial: !previous,
        },
      });
      fromQualification = toQualification;
    }
  }

  if (
    previous &&
    (previous.status_id !== normalized.statusId ||
      previous.pipeline_id !== normalized.pipelineId)
  ) {
    await admin.from("stage_history").insert({
      tenant_id: tenantId,
      lead_id: lead.id,
      from_pipeline_id: previous.pipeline_id,
      from_status_id: previous.status_id,
      from_status_name: previous.status_name,
      to_pipeline_id: normalized.pipelineId,
      to_status_id: normalized.statusId,
      to_status_name: normalized.statusName,
      source: "kommo",
      metadata: {},
    });
  } else if (!previous && (normalized.statusId || normalized.pipelineId)) {
    await admin.from("stage_history").insert({
      tenant_id: tenantId,
      lead_id: lead.id,
      from_pipeline_id: null,
      from_status_id: null,
      from_status_name: null,
      to_pipeline_id: normalized.pipelineId,
      to_status_id: normalized.statusId,
      to_status_name: normalized.statusName,
      source: "kommo",
      metadata: { initial: true },
    });
  }
}
