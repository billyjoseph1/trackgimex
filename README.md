# TrackGimex

*Every property, tenant and shilling — tracked.*

A rent-tracking web app for Kenyan landlords, agents and tenants. Landlords set up their buildings and houses, do a monthly occupancy check, track rent, approve house requests and get alerts when tenants are moving out. Tenants find empty houses, book them, pay rent and give move-out notice.

## Project status
| Stage | What | Status |
|-------|------|--------|
| 0 | Own repository, clean structure | ✅ Done |
| 1 | Backend: real accounts and a shared online database (Supabase) | ✅ Done |
| 2 | M-Pesa payments to each landlord's own Paybill / Till (Daraja) | ✅ Done (first live Paybill pending) |
| 3 | Go live: hosting, domain, email sending, legal, backups, pilot landlords | ⏳ Next |

> **Current state:** real accounts and a shared online database (Supabase). Landlords who connect their M-Pesa Paybill/Till get paid by PIN prompt, confirmed automatically; others use the manual code + confirm method. Don't launch to the public until Stage 3 (hosting, email sending, legal) is done.

## Folder layout
```
public/            ← the website (this folder is what gets hosted)
  index.html       landing page
  login.html       login / register (Landlord / Agent and Tenant tabs)
  landlord.html    landlord / agent dashboard
  tenant.html      tenant dashboard
  pay.html         payment page (book a house, pay deposit, pay rent)
  css/styles.css   all styling; colours are variables at the top
  js/config.js     Supabase project URL + publishable key (public by design)
  js/store.js      ALL data access, the only file that talks to Supabase
  js/ui.js         modals, toasts, receipts, icons
  js/shell.js      dashboard layout, sidebar, notifications
  js/landlord.js   landlord dashboard screens
  js/tenant.js     tenant dashboard screens
  img/skyline.svg  hero image
supabase/
  migrations/      database schema, security rules and server functions (run in order)
  tests/           security test suite for the database (runs on a local Postgres)
```

## How the backend works
- **Supabase** stores everything (Postgres database + logins). The project is set in `public/js/config.js`.
- **Row Level Security** is on for every table: tenants only see their own house and payments; landlords only see their own buildings, tenants and money.
- Anything that changes money, tenants or a house's status goes through **server functions** (`supabase.rpc(...)`) that check who is calling. Their code is in `supabase/migrations/`.
- **Payments:** a landlord can record cash/M-Pesa/bank payments directly (confirmed at once). A tenant *reports* a payment with its M-Pesa/bank code; it stays **pending** until the landlord confirms it. A booking is confirmed when the landlord approves the house request.
- **Linking tenants:** when a landlord adds a tenant, they get an 8-character **invite code** to send by WhatsApp/SMS. The tenant enters it after signing up. If the landlord entered the tenant's email, the house links automatically once that email is verified.

### M-Pesa (Stage 2)
- Each landlord connects **their own** Paybill or Till in **Settings → M-Pesa payments** (Daraja Consumer Key, Consumer Secret, Passkey). Keys are checked with Safaricom and stored encrypted in **Supabase Vault**; the browser can never read them.
- The landlord then sends a **Ksh 1 test prompt** to their own phone. Tenants only see **Pay with M-Pesa** after it succeeds (changing details requires a new test).
- Edge Functions in `supabase/functions/`: `pay-connect` (save + check keys), `pay-start` (send prompt / check status / test), `pay-callback` (Safaricom's result — verified again with Safaricom's STK query before anything is marked paid).
- Server secrets (Supabase → Edge Functions → Secrets): `DARAJA_SANDBOX_KEY`, `DARAJA_SANDBOX_SECRET` (TrackGimex's own sandbox app, used by "test mode").
- Deploy a function: `supabase functions deploy pay-start --no-verify-jwt` (or the Management API). All three run with JWT verification off and check the caller themselves.

### Changing the database
1. Add a new file in `supabase/migrations/` (e.g. `20261201000001_add_x.sql`). Never edit a migration that has already been run.
2. Test it locally: `PGHOST=... supabase/tests/run_local.sh` (needs a local Postgres).
3. Run it in Supabase → **SQL Editor**.

### Supabase settings that must be right before launch
- **Authentication → Email → Confirm email: ON.**
- **Authentication → SMTP:** add your own email sender (e.g. Resend or Brevo). Supabase's built-in sender only delivers to your own team's addresses and a few emails per hour — real users would never get their confirmation or password-reset emails.
- **Authentication → URL Configuration:** Site URL = your live address; add it to Redirect URLs.

## Run it locally
No install needed: open `public/index.html` in a browser.

Or serve it (recommended, closer to the live site):
```bash
npx serve public
```

Then open http://localhost:3000 and create an account (choose *Landlord / Agent* or *Tenant*). Supabase's default Site URL is `http://localhost:3000`, so email links work when testing this way.

## Features
**Landlords / agents:** buildings and a custom number of houses, confirm tenants' reported payments, invite codes for tenants, monthly occupancy check, rent tracker (paid / partial / unpaid, reminders, CSV export), tenants, house requests and bookings, move-out notices, payments and printable receipts, expenses and net income, lease renewals, notifications.

**Tenants:** my home (rent status, arrears, deposit, lease), link a house with an invite code, find a house (search and filters), request or book and pay, pay rent (Paybill / bank code, confirmed by landlord), move-out notice that notifies the landlord instantly, payment history and receipts.
