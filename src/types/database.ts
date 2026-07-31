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
