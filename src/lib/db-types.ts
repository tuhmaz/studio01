/**
 * Pure TypeScript row types matching the PostgreSQL schema.
 * No Supabase dependency — these are plain interfaces only.
 */

export type UserRole         = 'ADMIN' | 'LEADER' | 'WORKER';
export type ContractType     = 'MINIJOB' | 'MIDIJOB' | 'VOLLZEIT' | 'TEILZEIT';
export type TaxClass         = 1 | 2 | 3 | 4 | 5 | 6;
export type TimeEntryStatus  = 'OPEN' | 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type AssignmentStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
export type NoteType         = 'text' | 'voice' | 'photo';

export type ServiceCategory =
  | 'AUSSENREINIGUNG'
  | 'GULLIS'
  | 'RASSEN_MAEHEN'
  | 'GARTEN_PFLEGE'
  | 'BAEUME_PRUEFEN'
  | 'LAUBAUFNAHME';

export interface ServiceDetails {
  isActive?: boolean;
  frequency?: string | null;
  months?: string[];
}

// ── Row types (SELECT results) ────────────────────────────────────────────────

export interface DbCompany {
  id: string;
  name: string;
  site_name: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  tax_number: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_data: string | null;
  created_at: string;
}

export interface DbUser {
  id: string;
  company_id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  hourly_rate: number;
  contract_type: ContractType;
  tax_class: TaxClass;
  kinder: number;
  has_church_tax: boolean;
  bundesland: string;
  monthly_target_hours: number | null;
  auth_provider: 'password' | 'anonymous';
  can_login_with_password: boolean;
  invite_id: string | null;
  last_login: string | null;
  sv_nr: string | null;
  steuer_id: string | null;
  status_taetigkeit: string | null;
  kv_zusatz_rate: number | null; // Zusatzbeitrag der Krankenkasse in %
  created_at: string;
  updated_at: string;
}

export interface DbAccountInvite {
  id: string;
  company_id: string;
  email: string;
  role: UserRole;
  created_by: string | null;
  created_at: string;
}

export interface DbJobSite {
  id: string;
  company_id: string;
  name: string;
  address: string;
  city: string;
  postal_code: string | null;
  region: string | null;
  route_code: string | null;
  is_remote: boolean;
  distance_from_hq: number | null;
  travel_time_from_hq: number;
  estimated_travel_time_minutes_from_hq: number | null;
  lat: number | null;
  lng: number | null;
  services: Record<string, ServiceDetails>;
  created_at: string;
}

export interface DbJobAssignment {
  id: string;
  company_id: string;
  job_site_id: string | null;
  title: string;
  scheduled_date: string;
  status: AssignmentStatus;
  assigned_worker_ids: string[];
  categories: ServiceCategory[];
  is_plan_published: boolean;
  created_by: string | null;
  created_at: string;
}

export interface DbTimeEntry {
  id: string;
  company_id: string;
  employee_id: string;
  job_assignment_id: string | null;
  job_site_id: string | null;
  clock_in_datetime: string | null;
  clock_out_datetime: string | null;
  actual_work_minutes: number | null;
  travel_bonus_minutes: number;
  status: TimeEntryStatus;
  gps_verified: boolean;
  lat: number | null;
  lng: number | null;
  is_manual_entry: boolean;
  submission_datetime: string | null;
  created_at: string;
}

export interface DbWorkLogEntry {
  id: string;
  company_id: string;
  time_entry_id: string;
  job_site_id: string | null;
  job_assignment_id: string | null;
  employee_id: string;
  type: NoteType;
  content: string;
  author_name: string;
  duration: number | null;
  created_at: string;
}

// ── Insert types ──────────────────────────────────────────────────────────────

export type DbUserInsert           = Omit<DbUser, 'created_at' | 'updated_at' | 'last_login'> & { last_login?: string | null };
export type DbJobSiteInsert        = Omit<DbJobSite, 'created_at'>;
export type DbJobAssignmentInsert  = Omit<DbJobAssignment, 'created_at'>;
export type DbTimeEntryInsert      = Omit<DbTimeEntry, 'created_at'>;
export type DbWorkLogEntryInsert   = Omit<DbWorkLogEntry, 'created_at'>;
export type DbAccountInviteInsert  = Omit<DbAccountInvite, 'id' | 'created_at'> & { id?: string };
