# TrackGimex

*Every property, tenant and shilling — tracked.*

A rent-tracking web app for Kenyan landlords, agents and tenants. Landlords set up their buildings and houses, do a monthly occupancy check, track rent, approve house requests and get alerts when tenants are moving out. Tenants find empty houses, book them, pay rent and give move-out notice.

## Project status
| Stage | What | Status |
|-------|------|--------|
| 0 | Own repository, clean structure | ✅ Done |
| 1 | Backend: real accounts and a shared online database (Supabase) | ⏳ Next |
| 2 | Real payments (M-Pesa, cards) through a payment provider | Planned |
| 3 | Go live: hosting, domain, legal, backups, pilot landlords | Planned |

> **Right now this is a working demo.** All data is saved in the visitor's own browser, and payments are simulated, so no real money moves. Don't use it with real tenants until Stages 1–3 are done.

## Folder layout
```
public/            ← the website (this folder is what gets hosted)
  index.html       landing page
  login.html       login / register (Landlord / Agent and Tenant tabs)
  landlord.html    landlord / agent dashboard
  tenant.html      tenant dashboard
  pay.html         payment page (book a house, pay deposit, pay rent)
  css/styles.css   all styling; colours are variables at the top
  js/store.js      ALL data access, the only file that knows where data lives
  js/ui.js         modals, toasts, receipts, icons
  js/shell.js      dashboard layout, sidebar, notifications
  js/landlord.js   landlord dashboard screens
  js/tenant.js     tenant dashboard screens
  img/skyline.svg  hero image
```

## Run it locally
No install needed: open `public/index.html` in a browser.

Or serve it (recommended, closer to the live site):
```bash
npx serve public
```

### Demo accounts (password `demo123`)
| Role | Email |
|------|-------|
| Landlord / Agent | `landlord@demo.com` |
| Tenant with a house | `tenant@demo.com` |
| Tenant looking for a house | `mercy@demo.com` |

Reset the demo data from Landlord dashboard → Settings → Reset demo data.

## Features
**Landlords / agents:** buildings and a custom number of houses, monthly occupancy check, rent tracker (paid / partial / unpaid, reminders, CSV export), tenants, house requests and bookings, move-out notices, payments and printable receipts, expenses and net income, lease renewals, notifications.

**Tenants:** my home (rent status, arrears, deposit, lease), find a house (search and filters), request or book and pay, pay rent (M-Pesa, card, bank), move-out notice that notifies the landlord automatically, payment history and receipts.
