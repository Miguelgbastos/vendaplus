import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { dashboardCacheTag } from "@/lib/dashboard-cache";
import {
  fetchKommoLead,
  fetchKommoLeadStatusEvents,
  fetchKommoStatusNameById,
} from "@/lib/kommo/client";
import { normalizeKommoLead } from "@/lib/kommo/normalize";
import {
  commercialStageFromMilestones,
  isCommercialPriorStage,
  previousCommercialStageFromEvents,
  type CommercialPriorStage,
} from "@/lib/kommo/backfill-loss-resolve";
import type { FieldMapping } from "@/types/database";

export {
  commercialStageFromMilestones,
  isCommercialPriorStage,
  previousCommercialStageFromEvents,
  resolveQualificationFromStatusId,
} from "@/lib/kommo/backfill-loss-resolve";

type BackfillJob = {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

const statusNameCache = new Map<string, Record<string, string>>();

async function statusNamesForTenant(
  tenantId: string,
): Promise<Record<string, string>> {
  const cached = statusNameCache.get(tenantId);
  if (cached) return cached;
  const map = await fetchKommoStatusNameById(tenantId);
  statusNameCache.set(tenantId, map);
  return map;
}

export async function processBackfillLossHistoryJob(
  job: BackfillJob,
): Promise<{ ok: boolean; reason?: string }> {
  const admin = createAdminClient();
  const leadId = String(job.payload.lead_id ?? "");
  const kommoLeadId = String(job.payload.kommo_lead_id ?? "");

  if (!leadId || !/^\d+$/.test(kommoLeadId) || kommoLeadId === "0") {
    await markJob(admin, job.id, "completed");
    return { ok: true, reason: "invalid_payload" };
  }

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("id, tenant_id, kommo_lead_id, qualification, closed_at, custom_fields")
    .eq("id", leadId)
    .eq("tenant_id", job.tenant_id)
    .maybeSingle();

  if (leadError || !lead) {
    throw new Error(leadError?.message || "lead_not_found");
  }

  const { data: existingBackfill } = await admin
    .from("qualification_history")
    .select("id, from_qualification")
    .eq("tenant_id", job.tenant_id)
    .eq("lead_id", leadId)
    .eq("source", "kommo_backfill")
    .eq("to_qualification", "perda")
    .maybeSingle();

  if (isCommercialPriorStage(existingBackfill?.from_qualification)) {
    await markJob(admin, job.id, "completed");
    return { ok: true, reason: "already_backfilled" };
  }

  let resolved: CommercialPriorStage | null = null;
  let changedAt: string | null = lead.closed_at;
  let resolution: "db_milestones" | "events" | "milestones" | "none" = "none";

  // Prefer local milestones first to stay under Kommo's 7 req/s limit.
  const dbFields =
    lead.custom_fields && typeof lead.custom_fields === "object"
      ? (lead.custom_fields as Record<string, unknown>)
      : {};
  resolved = commercialStageFromMilestones(dbFields);
  if (resolved) resolution = "db_milestones";

  if (!resolved) {
    try {
      const statusNames = await statusNamesForTenant(job.tenant_id);
      const events = await fetchKommoLeadStatusEvents(job.tenant_id, kommoLeadId);
      const fromEvents = previousCommercialStageFromEvents(events, statusNames);
      if (fromEvents) {
        resolved = fromEvents.stage;
        changedAt = fromEvents.changedAt ?? lead.closed_at;
        resolution = "events";
      }
    } catch {
      // Fall through to GET lead + milestones.
    }
  }

  if (!resolved) {
    let customFields = dbFields;
    try {
      const { data: mappings } = await admin
        .from("field_mappings")
        .select("*")
        .eq("tenant_id", job.tenant_id)
        .eq("is_active", true);
      const rawLead = await fetchKommoLead(job.tenant_id, kommoLeadId);
      const normalized = normalizeKommoLead(
        rawLead,
        (mappings ?? []) as FieldMapping[],
      );
      customFields = { ...customFields, ...normalized.customFields };
    } catch {
      // Keep DB custom_fields only.
    }

    resolved = commercialStageFromMilestones(customFields);
    if (resolved) resolution = "milestones";
  }

  if (!resolved) {
    await markJob(admin, job.id, "completed");
    return { ok: true, reason: "unresolved" };
  }

  const row = {
    tenant_id: job.tenant_id,
    lead_id: leadId,
    from_qualification: resolved,
    to_qualification: "perda" as const,
    source: "kommo_backfill",
    changed_at: changedAt ?? new Date().toISOString(),
    metadata: {
      backfill: true,
      resolution,
      kommo_lead_id: kommoLeadId,
    },
  };

  if (existingBackfill?.id) {
    const { error } = await admin
      .from("qualification_history")
      .update({
        from_qualification: row.from_qualification,
        changed_at: row.changed_at,
        metadata: row.metadata,
      })
      .eq("id", existingBackfill.id)
      .eq("tenant_id", job.tenant_id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("qualification_history").insert(row);
    if (error) {
      if (error.code === "23505") {
        await markJob(admin, job.id, "completed");
        return { ok: true, reason: "duplicate" };
      }
      throw new Error(error.message);
    }
  }

  try {
    revalidateTag(dashboardCacheTag(job.tenant_id), { expire: 0 });
  } catch {
    // Cache tag optional in non-Next contexts.
  }

  await markJob(admin, job.id, "completed");
  return { ok: true, reason: resolution };
}

async function markJob(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  status: "completed" | "failed",
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
