import type { FieldMapping, QualificationStage } from "@/types/database";

const QUALIFICATION_ALIASES: Record<QualificationStage, string[]> = {
  mql: ["mql", "marketing qualified", "marketing_qualified", "lead marketing"],
  sal: ["sal", "sales accepted", "sales_accepted", "aceito vendas"],
  sql: ["sql", "sales qualified", "sales_qualified", "qualificado vendas"],
  oportunidade: ["oportunidade", "opportunity", "opp"],
  negociacao: ["negociacao", "negociação", "negotiation", "proposta", "proposal"],
  venda: ["venda", "won", "ganho", "closed won", "fechado ganho"],
  perda: ["perda", "lost", "perdido", "closed lost", "fechado perdido"],
};

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type NormalizedLead = {
  kommoLeadId: string | null;
  name: string | null;
  pipelineId: string | null;
  statusId: string | null;
  statusName: string | null;
  price: number | null;
  responsibleUserId: string | null;
  qualification: QualificationStage | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  customFields: Record<string, unknown>;
  contact: {
    kommoContactId: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function mapQualification(value: unknown): QualificationStage | null {
  const raw = str(value);
  if (!raw) return null;
  const normalized = normalizeKey(raw).replace(/_/g, " ");
  for (const [stage, aliases] of Object.entries(QUALIFICATION_ALIASES) as [
    QualificationStage,
    string[],
  ][]) {
    if (aliases.some((alias) => normalizeKey(alias).replace(/_/g, " ") === normalized)) {
      return stage;
    }
    if (aliases.some((alias) => normalized.includes(normalizeKey(alias).replace(/_/g, " ")))) {
      return stage;
    }
  }
  return null;
}

type CustomField = {
  field_id?: number | string;
  field_name?: string;
  field_code?: string;
  values?: Array<{ value?: unknown; enum_code?: string }>;
};

function extractCustomFields(lead: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fields = Array.isArray(lead.custom_fields_values)
    ? (lead.custom_fields_values as CustomField[])
    : [];

  for (const field of fields) {
    const key =
      str(field.field_code) ||
      str(field.field_name) ||
      (field.field_id != null ? `field_${field.field_id}` : null);
    if (!key) continue;
    const first = field.values?.[0];
    out[key] = first?.value ?? first?.enum_code ?? null;
    out[normalizeKey(key)] = out[key];
  }
  return out;
}

function applyMappings(
  source: Record<string, unknown>,
  mappings: FieldMapping[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const mapping of mappings.filter((m) => m.is_active && m.entity === "lead")) {
    const direct = source[mapping.source_field];
    const normalized = source[normalizeKey(mapping.source_field)];
    const value = direct ?? normalized;
    if (value !== undefined) {
      result[mapping.target_field] = value;
    }
  }
  return result;
}

function pickUtm(bag: Record<string, unknown>) {
  const utm: Record<(typeof UTM_KEYS)[number], string | null> = {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
  };
  for (const key of UTM_KEYS) {
    utm[key] =
      str(bag[key]) ||
      str(bag[key.toUpperCase()]) ||
      str(bag[normalizeKey(key)]) ||
      null;
  }
  return utm;
}

function firstContact(lead: Record<string, unknown>) {
  const embedded = asRecord(lead._embedded);
  const contacts = Array.isArray(embedded.contacts) ? embedded.contacts : [];
  const contact = asRecord(contacts[0]);
  const custom = extractCustomFields(contact);
  return {
    kommoContactId: str(contact.id),
    name: str(contact.name),
    email:
      str(custom.email) ||
      str(custom.Email) ||
      str(
        (Array.isArray(contact.custom_fields_values)
          ? (contact.custom_fields_values as CustomField[]).find((f) =>
              normalizeKey(String(f.field_code || f.field_name || "")).includes("email"),
            )?.values?.[0]?.value
          : null) ?? null,
      ),
    phone:
      str(custom.phone) ||
      str(custom.telefone) ||
      str(
        (Array.isArray(contact.custom_fields_values)
          ? (contact.custom_fields_values as CustomField[]).find((f) =>
              /phone|tel|telefone/.test(
                normalizeKey(String(f.field_code || f.field_name || "")),
              ),
            )?.values?.[0]?.value
          : null) ?? null,
      ),
    company: str(custom.company) || str(custom.empresa),
  };
}

export function normalizeKommoLead(
  rawLead: unknown,
  mappings: FieldMapping[] = [],
): NormalizedLead {
  const lead = asRecord(rawLead);
  const custom = extractCustomFields(lead);
  const mapped = applyMappings({ ...lead, ...custom }, mappings);
  const bag = { ...custom, ...mapped, ...lead };
  const utm = pickUtm(bag);

  const qualification =
    mapQualification(mapped.qualification) ||
    mapQualification(bag.qualification) ||
    mapQualification(bag.etapa) ||
    mapQualification(bag.stage) ||
    mapQualification(bag.status_name) ||
    mapQualification(lead.status_name);

  return {
    kommoLeadId: str(lead.id),
    name: str(mapped.name) || str(lead.name),
    pipelineId: str(lead.pipeline_id),
    statusId: str(lead.status_id),
    statusName: str(lead.status_name) || str(mapped.status_name),
    price: num(mapped.price) ?? num(lead.price),
    responsibleUserId: str(lead.responsible_user_id),
    qualification,
    ...utm,
    customFields: custom,
    contact: firstContact(lead),
  };
}

export function extractLeadIdsFromWebhookPayload(payload: unknown): string[] {
  const root = asRecord(payload);
  const ids = new Set<string>();

  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    const rec = asRecord(value);
    if (rec.id != null) ids.add(String(rec.id));
    if (rec.lead_id != null) ids.add(String(rec.lead_id));
    if (rec.element_id != null && String(rec.element_type || "") === "2") {
      ids.add(String(rec.element_id));
    }
  };

  const leads = root.leads ?? asRecord(root._embedded).leads;
  collect(leads);

  for (const [key, value] of Object.entries(root)) {
    if (/lead/i.test(key)) collect(value);
  }

  // Form-urlencoded Kommo style: leads[status][0][id]
  for (const [key, value] of Object.entries(root)) {
    if (/^leads\[/.test(key) && /\[id\]$/.test(key) && value != null) {
      ids.add(String(value));
    }
  }

  return [...ids];
}

export function detectEventType(payload: unknown): string {
  const root = asRecord(payload);
  if (typeof root.event_type === "string") return root.event_type;
  if (root.leads && asRecord(root.leads).status) return "leads.status";
  if (root.leads && asRecord(root.leads).add) return "leads.add";
  if (root.leads && asRecord(root.leads).update) return "leads.update";
  return "kommo.webhook";
}
