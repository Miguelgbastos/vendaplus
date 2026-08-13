import { randomBytes } from "node:crypto";
import {
  hashEmail,
  hashExternalId,
  hashName,
  hashPhone,
  splitFullName,
} from "./hashing.ts";

export type MetaCapiUserData = {
  lead_id?: string | null;
  email?: string | null;
  phone?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  external_id?: string | null;
  client_ip_address?: string | null;
  client_user_agent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
};

export type MetaCapiCustomData = {
  event_source?: string | null;
  currency?: string | null;
  value?: number | null;
  content_name?: string | null;
  content_category?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  lead_status?: string | null;
  lead_event_source?: string | null;
};

export type MetaCapiEvent = {
  event_name: string;
  event_time: number;
  action_source: string;
  event_id: string;
  event_source_url?: string | null;
  user_data: Record<string, string | string[] | undefined>;
  custom_data?: Record<string, unknown>;
};

export type BuildEventInput = {
  eventName: string;
  eventTimeMs?: number;
  actionSource?: string;
  eventId?: string;
  eventSourceUrl?: string | null;
  user: MetaCapiUserData;
  custom?: MetaCapiCustomData;
};

/**
 * Constrói um evento CAPI válido: user_data já hasheado, campos vazios omitidos.
 * `event_time` em segundos (não milissegundos) conforme spec Meta.
 */
export function buildMetaCapiEvent(input: BuildEventInput): MetaCapiEvent {
  const eventTime = Math.floor((input.eventTimeMs ?? Date.now()) / 1000);
  const emailHash = hashEmail(input.user.email);
  const phoneHash = hashPhone(input.user.phone);

  const { first: derivedFirst, last: derivedLast } = splitFullName(
    input.user.full_name,
  );
  const firstHash = hashName(input.user.first_name ?? derivedFirst);
  const lastHash = hashName(input.user.last_name ?? derivedLast);
  const externalIdHash = hashExternalId(input.user.external_id);

  const user_data: MetaCapiEvent["user_data"] = {};
  if (input.user.lead_id) user_data.lead_id = input.user.lead_id;
  if (emailHash) user_data.em = [emailHash];
  if (phoneHash) user_data.ph = [phoneHash];
  if (firstHash) user_data.fn = [firstHash];
  if (lastHash) user_data.ln = [lastHash];
  if (externalIdHash) user_data.external_id = [externalIdHash];
  if (input.user.client_ip_address)
    user_data.client_ip_address = input.user.client_ip_address;
  if (input.user.client_user_agent)
    user_data.client_user_agent = input.user.client_user_agent;
  if (input.user.fbc) user_data.fbc = input.user.fbc;
  if (input.user.fbp) user_data.fbp = input.user.fbp;

  const custom: Record<string, unknown> = {};
  if (input.custom) {
    if (input.custom.event_source) custom.event_source = input.custom.event_source;
    if (input.custom.value != null && Number.isFinite(input.custom.value)) {
      custom.value = Number(input.custom.value);
    }
    if (input.custom.currency) custom.currency = input.custom.currency;
    if (input.custom.content_name) custom.content_name = input.custom.content_name;
    if (input.custom.content_category)
      custom.content_category = input.custom.content_category;
    if (input.custom.lead_status) custom.lead_status = input.custom.lead_status;
    if (input.custom.lead_event_source)
      custom.lead_event_source = input.custom.lead_event_source;
    if (input.custom.utm_source) custom.utm_source = input.custom.utm_source;
    if (input.custom.utm_medium) custom.utm_medium = input.custom.utm_medium;
    if (input.custom.utm_campaign)
      custom.utm_campaign = input.custom.utm_campaign;
    if (input.custom.utm_content)
      custom.utm_content = input.custom.utm_content;
    if (input.custom.utm_term) custom.utm_term = input.custom.utm_term;
  }

  const event: MetaCapiEvent = {
    event_name: input.eventName,
    event_time: eventTime,
    action_source: input.actionSource ?? "system_generated",
    event_id: input.eventId ?? generateEventId(),
    user_data,
  };

  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
  if (Object.keys(custom).length) event.custom_data = custom;

  return event;
}

export function generateEventId(): string {
  return `${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
}

/**
 * Eventos padrão do Meta Ads para cada estágio Venda+. Owner/admin pode editar
 * na UI, mas estes são os defaults quando o mapeamento não existir.
 */
export const DEFAULT_QUALIFICATION_EVENT_MAP: Record<string, string> = {
  mql: "Lead",
  sal: "Lead",
  sql: "QualifiedLead",
  oportunidade: "InitiateCheckout",
  negociacao: "AddPaymentInfo",
  venda: "Purchase",
  perda: "LostLead",
};
