// All dates in the app are Asia/Kolkata. Stored ISO strings carry +05:30, so their
// first 10 chars are the IST date and chars 11–16 are the IST wall-clock time.

const TZ = 'Asia/Kolkata';
const DAY = 86400000;

const parts = (d: Date) => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const o: Record<string, string> = {};
  f.forEach((p) => { o[p.type] = p.value; });
  return o;
};

export const nowIso = (): string => {
  const p = parts(new Date());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+05:30`;
};

export const todayStr = (): string => nowIso().slice(0, 10);
export const dateOf = (iso: string): string => String(iso || '').slice(0, 10);
export const timeOf = (iso: string): string => String(iso || '').slice(11, 16);
export const atDate = (d: string): Date => new Date(d + 'T12:00:00+05:30');

export const addDays = (d: string, n: number): string => {
  const x = new Date(atDate(d).getTime() + n * DAY);
  const p = parts(x);
  return `${p.year}-${p.month}-${p.day}`;
};

export const diffDays = (a: string, b: string): number =>
  Math.round((atDate(b).getTime() - atDate(a).getTime()) / DAY);

/** 0 = Monday … 6 = Sunday */
export const weekdayIdx = (d: string): number => (atDate(d).getUTCDay() + 6) % 7;
export const startOfWeek = (d: string): string => addDays(d, -weekdayIdx(d));
export const isWeekday = (d: string): boolean => weekdayIdx(d) < 5;

export const fmtDay = (d: string, opts?: Intl.DateTimeFormatOptions): string =>
  atDate(d).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', ...opts });

export const fmtShort = (d: string): string =>
  atDate(d).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' });

export const fmtWhen = (iso: string): string => `${fmtDay(dateOf(iso))} · ${timeOf(iso)}`;

export const fmtMonth = (ym: string): string =>
  atDate(ym + '-01').toLocaleDateString('en-IN', { timeZone: TZ, month: 'long', year: 'numeric' });

export const msUntil = (iso: string): number => new Date(iso).getTime() - Date.now();

export const countdown = (iso: string): string => {
  const ms = msUntil(iso);
  if (ms <= 0) return 'due now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `in ${d} day${d > 1 ? 's' : ''}`;
};

export const greeting = (): string => {
  const h = Number(parts(new Date()).hour);
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** value for <input type="datetime-local"> */
export const toLocalInput = (iso: string): string => String(iso).slice(0, 16);

export const monthOf = (d: string): string => d.slice(0, 7);
export const addMonths = (ym: string, n: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
export const daysInMonth = (ym: string): number => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
