# Outreach: setup

One-time setup (about 15 minutes). Test mode is on by default, so nothing goes to a real person until you turn it off in Settings.

1. **Install clasp and log in**
   ```bash
   npm i -g @google/clasp
   clasp login
   ```
2. Turn on the Apps Script API at https://script.google.com/home/usersettings.
3. **Create a Google Sheet** (blank). Copy its ID from the URL.
4. **Create the script** from the `apps-script/` folder:
   ```bash
   cd apps-script
   clasp create --type standalone --title Outreach
   clasp push
   ```
   When asked about `appsscript.json`, accept the overwrite.
5. In the Apps Script editor: Project Settings → Script Properties, add
   - `SHEET_ID` = the Sheet ID from step 3
   - `API_TOKEN` = a long random string (for example `openssl rand -hex 32`)
6. In the editor, pick `setup` in the function menu and press Run. Approve the permissions. It creates the Sheet tabs, seeds roles and settings, and installs the 10-minute trigger.
7. **Deploy** → New deployment → Web app. Execute as: Me. Who has access: Anyone. Copy the Web App URL.
   Later re-deploys keep the same URL:
   ```bash
   clasp push
   clasp deploy -i <deploymentId>
   ```
8. **Front end**
   ```bash
   cd web
   cp .env.example .env     # paste the Web App URL into VITE_API_URL
   npm install
   npm run dev
   ```
   Open the app, go to Settings, paste the `API_TOKEN`, press Save and connect.
9. Deploy `web/` to Vercel (framework: Vite, root directory: `web`). Add `VITE_API_URL` as an environment variable.

## Before sending for real
- Settings → set a test email, write your signature, then try **Send test to me** on a company page.
- Leave test mode on and mark a few people ready. Batches send to your test address only (once each) so you can check timing.
- Turn test mode off when you are happy.

## Notes
- Emails go out around the scheduled time, within about ten minutes.
- Test sends are logged in SendLog as `test` and never count toward the daily cap or the stats.
- Email images: put files in `web/public/email/` and paste the full Vercel URL in the copy's Image URL field.
