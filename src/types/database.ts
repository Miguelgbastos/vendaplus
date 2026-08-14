export type TenantRole = "owner" | "admin" | "analyst" | "viewer";

export type QualificationStage =
  | "mql"
  | "sal"
  | "sql"
  | "oportunidade"
  | "negociacao"
  | "venda"
  | "perda";

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "dead";

export type KommoConnectionStatus =
  | "pending"
  | "connected"
  | "disconnected"
  | "error";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
};

/** Nome de domínio exibido no produto; Tenant permanece como contrato do banco. */
export type Company = Tenant;
export type CompanyRole = TenantRole;

export type TenantUser = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
};

export type FieldMapping = {
  id: string;
  tenant_id: string;
  entity: string;
  source_field: string;
  target_field: string;
  transform: string | null;
  is_active: boolean;
};

export type MetaCapiStatus =
  | "pending"
  | "configured"
  | "connected"
  | "disconnected"
  | "error";

export type MetaCapiDispatchStatus = "received" | "sent" | "failed";

export type MetaCapiConnection = {
  id: string;
  tenant_id: string;
  pixel_id: string | null;
  status: MetaCapiStatus;
  is_enabled: boolean;
  test_event_code: string | null;
  last_error: string | null;
  last_sent_at: string | null;
  connected_at: string | null;
  /** Presente apenas em leituras via service_role — nunca no client. */
  access_token_configured?: boolean;
};

export type MetaCapiEventMapping = {
  id: string;
  tenant_id: string;
  qualification: QualificationStage;
  event_name: string;
  include_value: boolean;
  currency: string;
  is_active: boolean;
  action_source: string;
};

export type MetaCapiEventLog = {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  qualification: QualificationStage | null;
  event_name: string;
  event_id: string;
  status: MetaCapiDispatchStatus;
  http_status: number | null;
  fbtrace_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
};

export type KommoConnection = {
  id: string;
  tenant_id: string;
  subdomain: string | null;
  account_id: string | null;
  status: KommoConnectionStatus;
  token_expires_at: string | null;
  last_error: string | null;
  connected_at: string | null;
  /** Presente apenas em leituras via service_role — nunca no client. */
  integration_id?: string | null;
  has_client_secret?: boolean;
};

export type KommoUser = {
  id: string;
  tenant_id: string;
  kommo_user_id: string;
  name: string;
  is_active: boolean;
  synced_at: string;
};

/** Row shapes returned by the dashboard aggregate RPCs (migration dashboard_aggregates). */
export type DashboardStageCountsRow = {
  leads_total: number;
  mql: number;
  sal: number;
  sql: number;
  oportunidade: number;
  negociacao: number;
  venda: number;
  perda: number;
  receita_fechada: number | string;
  utm_complete: number;
};

/** Closed-in-period vs created-and-closed-in-period outcome counts. */
export type DashboardCommercialOutcomesRow = {
  venda_fechada: number;
  perda_fechada: number;
  venda_mesmo_periodo: number;
  perda_mesmo_periodo: number;
};

/** Per-stage dwell (open leads stuck now) and cycle time (completed stays). */
export type DashboardStageDwellRow = {
  stage: QualificationStage;
  open_leads: number;
  median_current_days: number | string | null;
  stuck_7d: number;
  completed_stays: number;
  median_cycle_days: number | string | null;
};

export type DashboardDimension = "campaign" | "source" | "medium" | "content";

export type DashboardDimensionPerformanceRow = {
  name: string;
  leads: number;
  mql: number;
  sal: number;
  sql: number;
  oportunidade: number;
  negociacao: number;
  venda: number;
  perda: number;
};

export type DashboardFilterOptionRow = {
  dimension: "campaign" | "source" | "medium" | "owner";
  value: string | null;
};

export type DashboardTrendRow = {
  day: string;
  stage: QualificationStage;
  total: number;
};

export type DashboardNameValueRow = {
  name: string;
  value: number;
};

export type DashboardRecentLeadRow = {
  id: string;
  kommo_lead_id: string | null;
  name: string | null;
  qualification: QualificationStage | null;
  utm_campaign: string | null;
  loss_reason: string | null;
  updated_at: string;
};

export type DashboardMetrics = {
  leadsTotal: number;
  mql: number;
  sal: number;
  sql: number;
  oportunidade: number;
  negociacao: number;
  venda: number;
  perda: number;
  receitaFechada: number;
  taxaConversao: number;
};
