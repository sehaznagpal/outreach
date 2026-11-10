export type CompanyStatus = 'active' | 'paused' | 'done';
export type ContactStatus = 'draft' | 'ready' | 'scheduled' | 'sent' | 'followed_up' | 'replied' | 'bounced' | 'stopped';
export type BatchStatus = 'planned' | 'sending' | 'sent' | 'cancelled' | 'partial';

export interface Company {
  id: string;
  name: string;
  industry: string;
  domain: string;
  website: string;
  opening_title: string;
  opening_url: string;
  pitch_page_url: string;
  email_pattern: string;
  notes: string;
  copy_ids: string;
  followup_copy_ids: string;
  batch_size: number | null;
  followup_after_days: number | null;
  max_followups: number | null;
  status: CompanyStatus;
  created_at: string;
}

export interface Contact {
  id: string;
  company_id: string;
  name: string;
  first_name: string;
  role: string;
  email: string;
  linkedin_url: string;
  line_override: string;
  copy_override_id: string;
  status: ContactStatus;
  assigned_line: string;
  assigned_copy_id: string;
  batch_id: string;
  thread_id: string;
  first_sent_at: string;
  last_sent_at: string;
  followups_sent: number | null;
  replied_at: string;
  created_at: string;
}

export interface Line {
  id: string;
  company_id: string;
  text: string;
}

export interface Copy {
  id: string;
  name: string;
  kind: 'first' | 'followup';
  tags: string;
  subject: string;
  body_html: string;
  uses_vars: string;
  image_url: string;
  include_signature: boolean;
  archived: boolean;
  updated_at: string;
}

export interface Batch {
  id: string;
  company_id: string;
  type: 'first' | 'followup';
  scheduled_at: string;
  status: BatchStatus;
  contact_ids: string;
  sent_at: string;
  created_at: string;
}

export interface SendLogRow {
  id: string;
  contact_id: string;
  company_id: string;
  batch_id: string;
  type: string;
  copy_id: string;
  line_used: string;
  subject: string;
  sent_at: string;
  thread_id: string;
  result: 'ok' | 'error' | 'test';
  error: string;
}

export interface Settings {
  daily_cap: number;
  send_days: string[];
  default_send_time: string;
  followup_after_days: number;
  max_followups: number;
  signature_html: string;
  sender_name: string;
  portfolio_url: string;
  test_mode: boolean;
  test_email: string;
  paused: boolean;
  weekly_goal_companies: number;
}

export interface Meta {
  sheet_url: string;
  me: string;
  server_time: string;
  cap_hit_date: string;
}

export interface Data {
  settings: Settings;
  roles: string[];
  companies: Company[];
  contacts: Contact[];
  lines: Line[];
  copies: Copy[];
  batches: Batch[];
  sendlog: SendLogRow[];
  meta: Meta;
}

export type Table = 'Companies' | 'Contacts' | 'Lines' | 'Copies' | 'Batches' | 'SendLog';

export interface Delta {
  upsert?: Partial<Record<Table, any[]>>;
  remove?: Partial<Record<Table, string[]>>;
}

export interface Rendered {
  subject: string;
  html: string;
  plain: string;
  missing: string[];
  to?: string;
  copy_id?: string;
}

export const csv = (s: string | undefined | null): string[] =>
  String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
