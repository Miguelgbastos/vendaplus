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
  backfillChangedAtAfterLastPerda,
  commercialStageFromMilestones,
  isCommercialPriorStage,
  previousCommercialStageFromEvents,
  unresolvedMarkerChangedAt,
  type CommercialPriorStage,
} from "@/lib/kommo/backfill-loss-resolve";
import type { FieldMapping } from "@/types/database";

export {
  backfillChangedAtAfterLastPerda,
  commercialStageFromMilestones,
  isCommercialPriorStage,
  previousCommercialStageFromEvents,
  resolveQualificationFromStatusId,
  unresolvedMarkerChangedAt,
} from "@/lib/kommo/backfill-loss-resolve";

type BackfillJob = {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

type AdminClient = ReturnType<typeof createAdminClient>;

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
  workerId?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const admin = createAdminClient();
  const leadId = String(job.payload.lead_id ?? "");
  const kommoLeadId = String(job.payload.kommo_lead_id ?? "");

  if (!leadId || !/^\d+$/.test(kommoLeadId) || kommoLeadId === "0") {
    await markJob(admin, job.id, "completed", undefined, workerId);
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

  // Any prior attempt (resolved or unresolved) must not hit Kommo again.
  if (existingBackfill) {
    await markJob(admin, job.id, "completed", undefined, workerId);
    return {
      ok: true,
      reason: isCommercialPriorStage(existingBackfill.from_qualification)
        ? "already_backfilled"
        : "already_attempted",
    };
  }

  let resolved: CommercialPriorStage | null = null;
  let changedAt: string | null = lead.closed_at;
  let resolution: "db_milestones" | "events" | "milestones" | "unresolved" =
    "unresolved";
  // Erros transitórios da Kommo (429/403/timeout) não devem virar marcador
  // `unresolved` permanente: nesse caso retentamos o job.
  let apiError: unknown = null;

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
    } catch (err) {
      apiError = err;
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
    } catch (err) {
      apiError = err;
      // Keep DB custom_fields only.
    }

    resolved = commercialStageFromMilestones(customFields);
    if (resolved) resolution = "milestones";
  }

  // Sem estágio resolvido E com falha de API: deixa o worker retentar (backoff)
  // em vez de gravar um marcador `unresolved` que impediria novas tentativas.
  if (!resolved && apiError) {
    throw apiError instanceof Error ? apiError : new Error(String(apiError));
  }

  const { data: lastPerda } = await admin
    .from("qualification_history")
    .select("id, changed_at")
    .eq("tenant_id", job.tenant_id)
    .eq("lead_id", leadId)
    .eq("to_qualification", "perda")
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!resolved) {
    const { error } = await admin.from("qualification_history").insert({
      tenant_id: job.tenant_id,
      lead_id: leadId,
      from_qualification: null,
      to_qualification: "perda",
      source: "kommo_backfill",
      changed_at: unresolvedMarkerChangedAt(
        lastPerda?.changed_at,
        lead.closed_at,
      ),
      metadata: {
        backfill: true,
        resolution: "unresolved",
        kommo_lead_id: kommoLeadId,
      },
    });
    if (error && error.code !== "23505") {
      throw new Error(error.message);
    }
    await markJob(admin, job.id, "completed", undefined, workerId);
    return { ok: true, reason: "unresolved" };
  }

  // dashboard_loss_events_deduped picks DISTINCT ON lead_id ORDER BY changed_at DESC.
  // Webhook "kommo" perda rows often land a few ms after the real transition; bump
  // backfill changed_at so it becomes the authoritative last perda for the chart.
  const writeChangedAt = backfillChangedAtAfterLastPerda(
    changedAt ?? lead.closed_at,
    lastPerda?.changed_at,
  );

  const row = {
    tenant_id: job.tenant_id,
    lead_id: leadId,
    from_qualification: resolved,
    to_qualification: "perda" as const,
    source: "kommo_backfill",
    changed_at: writeChangedAt,
    metadata: {
      backfill: true,
      resolution,
      kommo_lead_id: kommoLeadId,
    },
  };

  const { error } = await admin.from("qualification_history").insert(row);
  if (error) {
    if (error.code === "23505") {
      await markJob(admin, job.id, "completed", undefined, workerId);
      return { ok: true, reason: "duplicate" };
    }
    throw new Error(error.message);
  }

  try {
    revalidateTag(dashboardCacheTag(job.tenant_id), { expire: 0 });
  } catch {
    // Cache tag optional in non-Next contexts.
  }

  await markJob(admin, job.id, "completed", undefined, workerId);
  return { ok: true, reason: resolution };
}

async function markJob(
  admin: AdminClient,
  jobId: string,
  status: "completed" | "failed",
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
  await query;
}
