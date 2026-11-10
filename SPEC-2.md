# Outreach — build spec

A personal cold-email outreach tool. A dark, premium web app on the front, Google Apps Script + Gmail + one Google Sheet behind it. Built and maintained through Claude Code.

> **For Claude Code:** read this whole file before writing code. Build in the phase order at the bottom. Do not add features that are not in this spec without asking. Design rules in §7 are strict.

---

## 1. Architecture

```
┌──────────────────────────┐        POST (JSON as text/plain)       ┌───────────────────────────┐
│  web/  (Vite + React)    │  ───────────────────────────────────▶  │  apps-script/  (clasp)    │
│  deployed on Vercel      │  ◀───────────────────────────────────  │  Web App: doPost(e)       │
│  all UI, no secrets      │              JSON response             │  Gmail send, triggers     │
└──────────────────────────┘                                        │  reads/writes the Sheet   │
                                                                    └─────────────┬─────────────┘
                                                                                  │
                                                                    ┌─────────────▼─────────────┐
                                                                    │  Google Sheet = database  │
                                                                    └───────────────────────────┘
```

- **Front end:** Vite + React + TypeScript, plain CSS modules or Tailwind with the tokens in §7 (pick one, be consistent). Lives in `web/`, deployed to Vercel.
- **Back end:** Apps Script, written locally in `apps-script/` and pushed with `clasp`. Deployed as a Web App: *Execute as: Me*, *Who has access: Anyone*.
- **Database:** one Google Sheet. The Sheet is the source of truth; it should stay human-readable but the user never needs to edit it by hand.
- **Auth:** a long random `API_TOKEN` stored in Apps Script Script Properties. The front end never ships it in the bundle: the user pastes it once into Settings, it's kept in `localStorage`, and every request includes it. `doPost` rejects any request without the right token.
- **CORS:** send requests as `fetch(url, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' } })` so there's no preflight. Apps Script redirects to googleusercontent; `fetch` follows it. Return `ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON)`.
- **API shape:** single endpoint, `{ token, action, payload }` → `{ ok, data | error }`. One action per operation (see §6).
- **Speed:** Apps Script calls take ~1–2s. The UI must be optimistic (update locally, reconcile on response) and show a quiet inline saving state, never a full-screen spinner. Load everything the dashboard needs in one `bootstrap` call.

### Folder layout

```
outreach/
├── SPEC.md                 ← this file
├── CLAUDE.md               ← short: "read SPEC.md first; phase we're on: X"
├── web/                    ← Vite + React app
│   ├── src/
│   │   ├── styles/tokens.css   ← every colour, radius, font, gradient lives here
│   │   ├── api.ts              ← the only file that talks to Apps Script
│   │   ├── pages/              ← Dashboard, Companies, CompanyPage, Logs, Copies, Calendar, Settings
│   │   └── components/
│   └── .env                ← VITE_API_URL=<Apps Script web app URL>  (URL only, no token)
└── apps-script/
    ├── .clasp.json
    ├── appsscript.json     ← timezone Asia/Kolkata, Gmail + Sheets scopes
    ├── Api.gs              ← doPost router + token check
    ├── Db.gs               ← Sheet read/write helpers
    ├── Scheduler.gs        ← batch planning, cap checks
    ├── Sender.gs           ← trigger handler: send due batches, follow-ups
    ├── Inbox.gs            ← reply + bounce detection
    └── Render.gs           ← template → final email (subject, HTML body, plain body)
```

### One-time setup (user does these, Claude Code walks her through)
1. `npm i -g @google/clasp`, then `clasp login`.
2. Turn on the Apps Script API at script.google.com/home/usersettings.
3. Create the Google Sheet; put its ID in Script Properties as `SHEET_ID`. Add a random `API_TOKEN`.
4. `clasp create --type standalone --rootDir apps-script`, `clasp push`, deploy as Web App, copy the URL into `web/.env`.
5. Run `setup()` once from the Apps Script editor: creates the Sheet tabs with headers and installs the time trigger.
6. Deploy `web/` to Vercel.

Re-deploys: after `clasp push`, update the **existing** deployment (`clasp deploy -i <deploymentId>`) so the URL never changes.

---

## 2. Core concepts

| Term | Meaning |
|---|---|
| **Company** | A target company. Has its own page. The only place data is edited. |
| **Contact** (POC) | A person at a company. |
| **Copy** | A reusable email template (subject + body) from the central Copies library. |
| **Line** | A personalised line written per company. Randomly assigned to contacts unless overridden. |
| **Ready** | A contact marked good-to-go. Ready contacts are placed into the next open batch for that company. |
| **Batch** (the "log") | A scheduled set of sends for **one company** on a date + time. Has a max size (company's batch size, default 4). |
| **Follow-up** | Auto-generated send N days after the first email, as a reply in the same Gmail thread, cancelled if they reply. |

**Editing rule:** contact details, lines, copies chosen, notes etc. are editable **only** on the Company page (copies themselves in the Copies library). Logs, Dashboard and Calendar are read-only views, except that on a batch the user can change **date and time**, cancel the batch, or remove one contact from it (which sends them back to Ready).

---

## 3. Data model (Sheet tabs)

All IDs are short random strings. All timestamps ISO strings in Asia/Kolkata.

**Companies**
`id, name, industry, domain, website, opening_title, opening_url, pitch_page_url, notes, copy_ids (comma list, 1–3), followup_copy_ids, batch_size (default 4), followup_after_days (blank = global), max_followups (blank = global), status (active | paused | done), created_at`

**Contacts**
`id, company_id, name, first_name, role, email, linkedin_url, line_override, copy_override_id, status (draft | ready | scheduled | sent | followed_up | replied | bounced | stopped), assigned_line, assigned_copy_id, batch_id, thread_id, first_sent_at, last_sent_at, followups_sent, replied_at, created_at`

**Lines**
`id, company_id, text`

**Copies**
`id, name, kind (first | followup), tags (comma list: text, links, opening, signature, image), subject, body_html, uses_vars (computed), image_url, include_signature (bool), archived (bool), updated_at`

**Batches**
`id, company_id, type (first | followup), scheduled_at, status (planned | sending | sent | cancelled | partial), contact_ids (comma list), sent_at, created_at`

**SendLog** (append-only history: one row per actual email sent)
`id, contact_id, company_id, batch_id, type (first | followup_n), copy_id, line_used, subject, sent_at, thread_id, result (ok | error), error`

**Roles**
`role` (one per row; seeded, user can add)

**Settings** (key / value)
`daily_cap (15), send_days (Mon–Fri), default_send_time (10:30), followup_after_days (4), max_followups (1), signature_html, sender_name, test_mode (true|false), test_email, paused (true|false), weekly_goal_companies (5)`

### Seed roles
Founder, Co-founder, CEO, CTO, CPO, Chief of Staff, Founder's Office, Head of Product, Product Manager, Associate Product Manager, Head of Design, Design Lead, Design Manager, Product Designer, UX Researcher, Engineering Manager, Hiring Manager, HR, HR Business Partner, Talent Acquisition, Recruiter, Other.

---

## 4. Screens

Navigation: a slim left rail (icons + labels, like reference 4) with: **Dashboard, Companies, Logs, Copies, Calendar, Settings.** A global **+ Company** button sits at the top of the rail. Keyboard: `N` = new company, `/` = search companies.

### 4.1 Dashboard
A bento grid (reference 1 layout logic). Everything here is read-only and clicks through.

1. **Hero card (gradient):** greeting in Gambetta ("Good morning, Sehaz"), and one line of what's happening today: "2 batches go out today · 7 emails · next at 10:30". If nothing's scheduled: "Nothing scheduled. Pick a company and queue a batch."
2. **Next batch:** company, time, countdown, the names in it. Click → that batch in Logs.
3. **KPI tiles (4):** sent this week, replies this week (+ reply rate), companies active, emails queued for the next 7 days. Big numbers in Gambetta.
4. **Weekly goal:** companies added this week vs goal (ring or bar), plus a streak: consecutive weekdays with at least one email sent.
5. **Activity heatmap:** last 12 weeks, one cell per day (reference 3 "work activity" grid). Cell colour by volume; yellow = first emails, a second tone where follow-ups dominated; empty outlined cell = a weekday with nothing sent.
6. **Recent replies:** the last 5 contacts who replied, with company and how many days after sending. Each links to the company page. This is the most motivating card; give it room.
7. **Needs attention:** bounced emails, companies with ready contacts but no batch, batches over the daily cap, copies referencing a variable the company is missing.

### 4.2 Companies (list)
Grid or table toggle. Each company shows name, industry, counts (contacts / ready / sent / replied), next batch date, status pill. Filters: status, industry. Search.

### 4.3 Company page (the only editing surface)
Two-column layout.

**Left / main:**
- **Header:** company name (Gambetta, large), industry pill, domain, status switch (active / paused / done).
- **People table:**
  - Columns: checkbox, Name, Role (dropdown from Roles, type-to-filter, "Add new role" at the bottom saves it to Roles), Email, LinkedIn, Line (shows the assigned one; click to override), Copy (assigned; click to override), Status pill, **Action**.
  - Action column: a **Ready** toggle for drafts. When toggled, the contact is placed in the next open batch for this company (see §5.1) and the cell shows "Batch · Thu 10:30". Already-sent rows show the sent date and follow-up state instead.
  - Adding people: an always-present empty row at the bottom of the table (type and press Enter for the next field, Tab moves across). Plus a **Paste list** button: paste lines like `Name, Role, email` or tab-separated from a spreadsheet; preview the parsed rows before adding.
  - Email helper: if the company has an email pattern set (e.g. `{first}@domain`, `{first}.{last}@domain`), typing a name auto-fills the email in a muted style the user can accept with Tab.
  - Bulk actions on selected rows: Mark ready, Change role, Remove.
  - Duplicate guard: warn if an email already exists anywhere in the database.
- **Lines:** a list of 1–5 personalised lines for this company, add / edit / delete inline. Small note under it: "Each person gets one at random. Override per person in the table."
- **Notes:** free text, autosaves.

**Right / sidebar:**
- **Copies for this company:** pick 1–3 first-email copies and 0–2 follow-up copies from the library (searchable select showing name + tags). Each contact gets one at random when they're marked ready. Show a warning if a chosen copy uses a variable this company hasn't filled (e.g. `{{opening}}` with no opening set).
- **Company details used in copies:** opening title + URL, pitch page URL, email pattern.
- **Sending rules:** batch size (default 4), follow-up after X days (default from Settings), max follow-ups.
- **Preview:** pick any contact → shows the exact rendered email (subject + body + signature/image) as it will send. Also a **Send test to me** button.
- **Planned batches:** list of this company's upcoming batches with date/time (read-only here; edit in Logs).

### 4.4 Logs (batches)
Read-only overview of every batch, grouped by day: **Today, Tomorrow, This week, Later, Sent.**

- Each batch card: company, type (first / follow-up), scheduled date + time, the contacts in it (name · role · copy name), status.
- Editable here: **date and time** (inline picker), **Cancel batch**, **remove a person** from the batch (returns them to Ready). Nothing else.
- **Plan batches** button: opens a panel listing every company with ready-but-unscheduled contacts. User picks companies, a start date, time, and spacing (every weekday / every 2 days), and the app creates as many batches as needed in one go. Shows a preview of the resulting schedule and any day that would exceed the daily cap before confirming.
- Cap warning: a day whose total (first + follow-ups) exceeds `daily_cap` gets a visible warning; the app never silently moves sends.
- Global **Pause all sending** switch at the top (mirrors Settings).

### 4.5 Copies (central library)
- List of copies, each with name, kind (first / follow-up), tags, last edited, and how many times it's been used + its reply rate (from SendLog).
- Editor: name, kind, tags (text, links, opening, signature, image), subject, body, image URL, include signature toggle. Body is a simple rich-text editor (bold, italic, link, line breaks only; no fonts, no colours) that stores HTML.
- Variables shown as clickable chips that insert into the body: `{{first_name}}`, `{{name}}`, `{{role}}`, `{{company}}`, `{{line}}`, `{{opening_title}}`, `{{opening_url}}`, `{{pitch_page_url}}`, `{{portfolio_url}}`, `{{sender_name}}`.
- Live preview pane rendered with a sample contact.
- Duplicate, archive (archived copies stay attached to past sends but can't be chosen for new companies).
- **Signature** lives in Settings but is previewable here.

### 4.6 Calendar
Month view. Each day shows dots/count for first emails sent, follow-ups sent, and planned (outlined) batches. Past weekdays with nothing sent are marked faintly. Click a day → side panel listing exactly what was sent or is scheduled that day, linking to batches and companies. Read-only.

### 4.7 Settings
Daily cap, send days, default send time, default follow-up days and max follow-ups, sender name, signature (HTML editor with preview), portfolio URL, weekly goal, test mode + test email, pause all sending, API token field, "Run setup" helper, and a link to open the Google Sheet.

---

## 5. Behaviour

### 5.1 Marking ready → batching
When a contact is marked ready:
1. Assign `assigned_line` (override, else random from company Lines) and `assigned_copy_id` (override, else random from the company's copies). Try to spread lines and copies evenly within a company, not purely random, so two people in the same batch rarely get the same line.
2. Find this company's earliest **planned** first-email batch that has room (`< batch_size`) and is in the future. If found, add the contact.
3. Otherwise create a new batch on the next send day after the company's last batch (never two first-email batches for the same company on the same day), at `default_send_time`.
4. Un-marking ready removes them from their batch (deleting the batch if it becomes empty).

### 5.2 Sending (time trigger every 10 minutes)
- If `paused`, do nothing.
- Take all batches with `status = planned` and `scheduled_at <= now`. For each, send to each contact sequentially.
- Before sending, re-check: contact still `scheduled`, not replied, not bounced, email not already contacted.
- Render via `Render.gs`, send with `GmailApp.sendEmail(to, subject, plainBody, { htmlBody, name: sender_name })`. Then find the thread (search `to:<email> subject:"<subject>" newer_than:1d`) and store `thread_id`.
- In test mode, send everything to `test_email` with the real recipient shown at the top of the body, and don't change contact status.
- Write a SendLog row per email. Mark batch `sent` (or `partial` with errors visible in Needs attention).
- Respect `daily_cap` as a hard stop: if hit, leave remaining batches as planned and surface it on the Dashboard.
- Uses `LockService` so two trigger runs never overlap.

### 5.3 Follow-ups
- When a first email is sent, compute the follow-up date (send day N days later, using company override or global). Follow-up contacts for the same company and same day are grouped into one **follow-up batch**, visible in Logs like any batch (editable time/date, cancellable).
- Follow-ups are sent as **replies in the same thread**: `GmailApp.getThreadById(thread_id).reply(plainBody, { htmlBody })`. Subject stays the thread's.
- Follow-up copy: random from the company's follow-up copies, else the default follow-up copy (first copy with kind = followup).
- Cancelled automatically if the contact replied or bounced.

### 5.4 Reply and bounce detection (same trigger, after sending)
- For every contact with a `thread_id` in status sent / followed_up: if the thread has a message not from the user → `replied`, set `replied_at`, cancel pending follow-ups. Check only threads from the last 30 days to stay within quotas.
- Search `from:mailer-daemon newer_than:2d`; match the failed address to a contact → `bounced`, cancel follow-ups.

### 5.5 Rendering
- Replace variables; if a required variable is empty, refuse to schedule (caught earlier on the company page) rather than sending a broken email.
- Body structure: copy body → (optional image as `<img>` with max-width 480px, hosted on Vercel `web/public/email/`) → (optional signature HTML).
- Always produce a plain-text fallback.
- Email HTML stays simple: system font stack, no background colours. The app's dark design does not apply to emails.

### 5.6 Limits to respect
Consumer Gmail via Apps Script allows about 100 recipients/day; the cap of 10–15 is far below that. Triggers run at roughly the time scheduled (within ~10 minutes); the UI should say "around 10:30".

---

## 6. API actions

`bootstrap` (everything needed for Dashboard + lists in one call), `getCompany`, `saveCompany`, `deleteCompany`, `saveContacts` (bulk upsert), `setReady` (ids, bool), `removeContact`, `saveLines`, `listCopies`, `saveCopy`, `archiveCopy`, `previewEmail` (contact_id, copy_id?), `sendTest`, `listBatches` (range), `rescheduleBatch` (id, scheduled_at), `cancelBatch`, `removeFromBatch`, `planBatches` (company_ids, start, time, spacing, dry_run), `getCalendar` (month), `getSettings`, `saveSettings`, `addRole`.

---

## 7. Design system (strict)

**Mood:** dark only. Warm, quiet, editorial. Premium means restraint: a lot of space, few borders, large serif numbers, one luminous gradient used sparingly. It must not look like a generic AI/SaaS dashboard: no neon purple, no glassmorphism everywhere, no heavy drop shadows, no emoji icons, no gradient text on every heading.

**References (in order of influence):**
1. Bento of soft rounded cards with a blue→green→yellow blurred gradient orb and gradient panel (layout + gradient).
2. MindPalace: thin outlined pills, serif-ish large prompt, airy left rail (structure + typography contrast).
3. Dark dashboard with heatmap grid and orange/peach blocks (dark surfaces, heatmap, data density).
4. RevenueX: serif display headline over a warm yellow gradient card, minimal rail (hero card + serif/sans pairing).

### Fonts
- **Gambetta** (variable, Fontshare: `https://api.fontshare.com/v2/css?f[]=gambetta@300,301,400,401,500,501,600,601,700,701&display=swap`, or self-host the variable file in `web/public/fonts/`). Used for: page titles, company names, the greeting, and all large numbers (KPIs). Weights 400–500; use the italic for small emphasis like "today".
- **Bricolage Grotesque** (Google Fonts, variable, `opsz` + `wght`). Used for everything else: UI, tables, labels, buttons, body. 400 for body, 500 for labels/buttons, 600 sparingly. Let optical size do its work: smaller text gets the smaller opsz.
- Type scale (px): 12 / 13 / 15 / 17 / 22 / 32 / 48 / 72. Tables at 14–15. Labels 12–13 uppercase-free, with letter-spacing 0.01em; never shouty all-caps.
- Numbers: `font-variant-numeric: tabular-nums` in tables.

### Colour tokens (`tokens.css`)
Placeholder palette derived from the references. **Sehaz will supply final colours. Swap the values here only; nothing outside this file may hard-code a colour.**

```css
:root {
  /* surfaces: warm near-blacks, not blue-black */
  --bg:          #0C0B09;
  --surface-1:   #141310;
  --surface-2:   #1B1A16;
  --surface-3:   #24221D;
  --line:        rgba(246, 240, 222, 0.07);
  --line-strong: rgba(246, 240, 222, 0.14);

  /* text: cream, not pure white */
  --text:        #F3EEDF;
  --text-2:      #B4AE9F;
  --text-3:      #7A7569;

  /* accents */
  --yellow:      #F2E66B;
  --yellow-soft: #F6EFA6;
  --green-soft:  #CFE3A0;
  --sky:         #8EC8EE;
  --ember:       #E8682E;   /* rare: errors-adjacent attention, "needs attention" */
  --ok:          #A9D88B;
  --danger:      #E5765F;

  /* the gradient (reference 1 + 4) */
  --grad-hero:  radial-gradient(120% 140% at 0% 100%, #8EC8EE 0%, rgba(142,200,238,0) 45%),
                radial-gradient(90% 120% at 100% 0%, #F2E66B 0%, rgba(242,230,107,0) 55%),
                linear-gradient(135deg, #CFE3A0 0%, #F2E66B 60%, #E9C85A 100%);
  --grad-warm:  linear-gradient(160deg, #F6EFA6 0%, #F2E66B 45%, #E9B949 100%);
  --grad-orb:   radial-gradient(circle at 35% 30%, #8EC8EE 0%, #CFE3A0 45%, #F2E66B 75%);

  --radius-sm: 10px;  --radius: 18px;  --radius-lg: 28px;  --pill: 999px;
}
```

### Rules
- **Gradients:** used only on (a) the Dashboard hero card, (b) the Next batch card, (c) a small blurred orb decoration, (d) the primary button on hover. Text on gradient cards is near-black (`#141310`), set in Gambetta. Everywhere else is flat warm surfaces.
- **Grain:** a very faint SVG noise overlay (opacity 0.03–0.05) on the gradient cards and on `--bg`, so gradients don't band and the dark doesn't feel flat.
- **Depth:** separation by surface tone + 1px `--line` borders, not shadows. If any shadow, it's one soft ambient (`0 30px 60px -30px rgba(0,0,0,.6)`) on modals only. A 1px top inner highlight (`inset 0 1px 0 rgba(255,255,255,.04)`) on cards is allowed.
- **Shape:** cards `--radius-lg`, inputs and table rows `--radius-sm`, pills fully rounded and outlined (reference 2), selected pill filled with `--surface-3` or yellow at low opacity.
- **Layout:** generous padding (cards 24–32px), 16px grid gaps, bento grid on Dashboard, max content width ~1360px. The rail is ~220px, collapsible to icons.
- **Tables:** no zebra striping; row hover is `--surface-2`; headers in `--text-3` at 12–13px; status as small outlined pills with a coloured dot.
- **Icons:** one thin-stroke set (Lucide at 1.5 stroke) throughout.
- **Motion:** subtle and quick: 150–220ms ease-out on hover/focus, cards rise 2px on hover, the orb drifts slowly (respect `prefers-reduced-motion`). Number tiles count up once on load. No bouncing.
- **States:** every list has a designed empty state with one sentence and one action. Saving shows a small inline "Saved" in `--text-3`, never toasts for routine saves; toasts only for sends and errors.
- **Focus:** visible focus ring in `--yellow` at 60% opacity, 2px offset. All interactive elements keyboard reachable.
- **Copy in the UI:** sentence case, short, plain. No exclamation marks, no "Let's go!", no emoji.

---

## 8. Build phases

Ship each phase working before starting the next. Use test mode until phase 4 is done.

1. **Skeleton:** repo layout, clasp setup, `setup()` creating the Sheet tabs, `doPost` router with token check, `bootstrap`. Front end: tokens, fonts, rail, empty pages, Settings with token field. Confirm a round trip works.
2. **Company page + Copies:** company CRUD, people table with role dropdown, paste list, lines, notes, copies library with variables and preview, company copy selection, rendered email preview, send test.
3. **Ready → batches → sending:** batching logic, Logs page (read-only + reschedule/cancel/remove), plan multiple batches, the 10-minute trigger, daily cap, SendLog, pause.
4. **Follow-ups + inbox:** thread replies, follow-up batches, reply and bounce detection, cancellation.
5. **Dashboard + Calendar:** all cards, heatmap, streak, weekly goal, needs attention, calendar month view.
6. **Polish:** keyboard shortcuts, email-pattern helper, duplicate guard, empty states, motion, accessibility pass, mobile layout for Dashboard and Logs (read-mostly on phone).

Not in v1: lead-finding integrations, open tracking, link tracking, notifications, multiple sender accounts.
