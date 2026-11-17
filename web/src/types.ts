export type CompanyStatus = 'active' | 'paused' | 'done' | 'replied';
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
  replied_at: string;
  replied_by: string;
  /** 'scout' when imported from the Scout sheet */
  source: string;
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
  /** 'company' = a shared inbox such as careers@; blank or 'person' = a named person */
  type: 'person' | 'company' | '';
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
  signature_id: string;
  auto_link: boolean;
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
  reason: string;
}

export interface Link {
  id: string;
  label: string;
  url: string;
  key: string;
  auto_words: string;
  is_primary: boolean;
  scope: 'global' | 'company' | 'contact';
  company_id: string;
  contact_id: string;
  created_at: string;
  track_clicks: boolean;
}

export interface Signature {
  id: string;
  name: string;
  html: string;
  image_url: string;
  is_default: boolean;
  updated_at: string;
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
  sender_name: string;
  test_mode: boolean;
  test_email: string;
  paused: boolean;
  weekly_goal_companies: number;
  import_per_day: number;
  tracking: boolean;
  site_url: string;
}

export interface ImportLog {
  id: string;
  run_at: string;
  trigger: 'daily' | 'manual';
  imported: number;
  imported_names: string;
  skipped: string;
  lines_added: number;
  errors: string;
}

export interface TrackEvent {
  id: string;
  send_id: string;
  contact_id: string;
  company_id: string;
  batch_id: string;
  copy_id: string;
  type: 'open' | 'click';
  link_key: string;
  at: string;
  user_agent: string;
  likely_auto: boolean;
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
  links: Link[];
  signatures: Signature[];
  importlog: ImportLog[];
  batches: Batch[];
  sendlog: SendLogRow[];
  events: TrackEvent[];
  meta: Meta;
}

export type Table = 'Companies' | 'Contacts' | 'Lines' | 'Copies' | 'Batches' | 'SendLog' | 'Links' | 'Signatures';

export interface Delta {
  upsert?: Partial<Record<Table, any[]>>;
  remove?: Partial<Record<Table, string[]>>;
}

export interface Rendered {
  subject: string;
  html: string;
  plain: string;
  missing: string[];
  links_used?: Array<{ key: string; label: string; url: string; level: 'global' | 'company' | 'contact' }>;
  to?: string;
  copy_id?: string;
}

export const csv = (s: string | undefined | null): string[] =>
  String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
