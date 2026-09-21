# Caprae LeadGen Enhancement Pipeline

An enhancement layer for the SaaSquatch / Caprae lead generation stack. Paste a lead or drop a CSV, and every address is checked for valid syntax, live mail servers and throwaway domains, then scored out of 100 so a sales team can work the top of the list first. Don't have an email yet? Give it a name and a company domain and it will find and rank the most likely address. Once a lead is saved, one click fetches a light company profile (industry, description) from their own public website, and a dashboard chart set shows score distribution, quality mix and volume over time.

- **Frontend** Next.js 14 (App Router), Tailwind CSS, Lucide icons, Axios, Recharts, Apple Crystal glass UI
- **Backend** Node.js, Express, Mongoose, native `dns/promises` MX lookups, hand-rolled SMTP probing, native `fetch` for enrichment
- **Database** MongoDB Atlas, database name `caprae_leadgen_db`

---

## Requirements

- Node.js 18 or newer (the backend uses `dns/promises`, the global `fetch` API and other Node 18+ features)
- npm 9 or newer
- A MongoDB Atlas cluster that allows connections from your IP

---

## Quickstart

Run the two halves in separate terminals.

### 1. Backend

```bash
cd backend
npm install
npm run dev
```

The API starts on `http://localhost:5000`. `backend/.env` already contains the Atlas connection string:

```
MONGODB_URI=mongodb+srv://...@cluster0.jkqxozn.mongodb.net/caprae_leadgen_db?retryWrites=true&w=majority&appName=Cluster0
PORT=5000
CLIENT_ORIGIN=http://localhost:3000
MAX_BATCH_SIZE=500
DNS_CONCURRENCY=12
```

Confirm it is up:

```bash
curl http://localhost:5000/api/health
```

If `database` comes back as `disconnected`, add your current IP under **Network Access** in the Atlas dashboard and restart. If your network blocks the `mongodb+srv://` DNS lookup entirely (some ISPs and corporate networks do), switch to the standard, non-SRV connection string from Atlas's **Connect → Drivers** screen instead.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The API base URL lives in `frontend/.env.local` as `NEXT_PUBLIC_API_URL`.

---

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service and database status |
| `GET` | `/api/leads` | All leads, newest first, plus summary stats. Optional `?quality=High Quality` and `?limit=` |
| `POST` | `/api/leads/process` | Verify, score and store one lead, an array of leads, or raw CSV text |
| `POST` | `/api/leads/find-email` | Generate and rank likely email addresses for a name + company domain, without saving anything |
| `POST` | `/api/leads/:id/enrich` | Fetch a stored lead's public homepage and add industry/description, then rescore |
| `DELETE` | `/api/leads/:id` | Remove a single lead |

### POST `/api/leads/process`

Accepts any one of three shapes. `email` can be omitted if `firstName`/`lastName` and a `domain` or `website` are given instead, in which case the pipeline discovers a likely email automatically before verifying and scoring it.

Single lead, email provided:

```json
{ "company": "Northwind Logistics", "domain": "northwind.com", "email": "dana.mercer@northwind.com" }
```

Single lead, email discovered from a name:

```json
{ "company": "Northwind Logistics", "domain": "northwind.com", "firstName": "Dana", "lastName": "Mercer" }
```

Batch:

```json
{ "leads": [{ "company": "Halcyon Foods", "email": "ops@halcyonfoods.co" }] }
```

Raw CSV text:

```json
{ "csv": "company,domain,email\nNorthwind Logistics,northwind.com,dana.mercer@northwind.com" }
```

Recognised CSV headers: `company`, `domain`, `email`, `firstName`, `lastName`, `industry`, `website`, plus common aliases such as `company name`, `work email`, `first name` and `url`. Each row needs either an `email`, or a first/last name plus a domain/website so one can be discovered. Re-running a batch updates existing leads rather than duplicating them.

### POST `/api/leads/find-email`

```json
{ "company": "Northwind Logistics", "domain": "northwind.com", "firstName": "Dana", "lastName": "Mercer" }
```

Returns every candidate pattern ranked by likelihood, each tagged `confirmed`, `catch-all`, `unconfirmed` or `invalid`, plus a `bestGuess`. Confirmation requires a live SMTP probe on port 25 against the domain's mail server; most home networks, corporate networks and cloud platforms block outbound port 25, so on those networks every result falls back to `unconfirmed`, ranked purely by how common the pattern is (`first.last@` scores highest, matching real-world convention). The response always says plainly which case occurred, nothing is silently overstated as confirmed.

### POST `/api/leads/:id/enrich`

Fetches the lead's own homepage (HTTPS first, HTTP as a fallback), reads the `<title>` and meta description, and guesses an industry from a small keyword taxonomy. If the lead had no industry set, the detected one fills it in and the lead is rescored. This is on-demand per lead rather than automatic during batch processing, so a large CSV import isn't slowed down by fetching hundreds of external websites.

---

## How the score works

Each lead starts at zero and collects signals. Deliverability carries the most weight, firmographic completeness adds lift, and weak or unconfirmed addresses are penalised.

| Signal | Points |
| --- | --- |
| Valid email syntax | +26 |
| Mail servers confirmed via MX lookup | +30 |
| Resolvable company domain | +12 |
| Company name on record | +10 |
| Company-owned mailbox (not consumer, not disposable) | +8 |
| Addressed to a named person | +5 |
| Industry captured | +5 |
| Website captured | +4 |
| Disposable inbox | −45 |
| Consumer mailbox (gmail, outlook, yahoo and similar) | −14 |
| Shared inbox (info@, sales@, support@) | −8 |
| Email domain differs from company domain | −6 |
| Discovered email not confirmed as deliverable | −10 |

Two ceilings keep unreachable leads out of the top band:

- Invalid syntax or a disposable domain caps the score at 24
- No confirmed mail servers caps the score at 58

Bands: **High Quality** 80–100, **Medium** 50–79, **Low Quality** below 50.

---

## Project structure

```
Caprae LeadGen Enhancement Pipeline/
├── backend/
│   ├── models/Lead.js          Mongoose schema (caprae_leadgen_db)
│   ├── utils/verifier.js       Syntax, MX lookup, disposable and role detection
│   ├── utils/scorer.js         Scoring weights and quality bands
│   ├── utils/emailFinder.js    Pattern generation and best-effort SMTP mailbox probing
│   ├── utils/enrichment.js     Homepage fetch, title/description parsing, industry guessing
│   ├── server.js               Express app, CORS, Mongo connection, REST routes, CSV parser
│   ├── package.json
│   └── .env
├── frontend/
│   ├── app/globals.css                 Crystal glass design system
│   ├── app/layout.tsx                  Root layout with ambient light field
│   ├── app/page.tsx                    Dashboard
│   ├── components/StatsCards.tsx
│   ├── components/LeadForm.tsx         Lead entry, CSV batch, and the "find email" flow
│   ├── components/LeadTable.tsx        Results table, enrich action, CSV export
│   ├── components/AnalyticsCharts.tsx  Score distribution, quality mix, leads over time
│   ├── components/types.ts
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.json
│   └── .env.local
└── README.md
```

---

## Notes on reliability

- MX lookups run with a 5 second timeout and a concurrency ceiling of 12, so one dead nameserver cannot stall a batch.
- Email pattern discovery caps SMTP probing at 6 candidates per domain and treats any connection failure, timeout, or blocked port as "unconfirmed" rather than an error, since outbound port 25 is blocked on most networks by design. A catch-all domain (one that accepts mail for any address) is detected first and reported explicitly, since individual confirmations are meaningless there.
- Company enrichment caps parsing at 250KB of HTML per page and a 6 second fetch timeout, and never throws on a dead site, it returns a clear note instead.
- A failed DNS lookup is recorded as `mxStatus: "error"` and reported in the UI as "Check failed", which is kept distinct from a domain that genuinely has no mail servers.
- Malformed CSV (unclosed quotes, missing email/name+domain columns) returns a 400 with a message naming the problem instead of importing partial rows.
- If `MONGODB_URI` is missing or malformed the server still boots and the lead endpoints return 503 with an explanation, so the frontend can show a clear connection banner.

## Production checklist

- Move `.env` out of version control and rotate the Atlas password before deploying.
- Set `CLIENT_ORIGIN` to your deployed frontend origin rather than leaving CORS open.
- Add authentication in front of `/api/leads` before exposing the API publicly.
- Outbound port 25 (used for email confirmation) is blocked on most PaaS platforms (Heroku, Vercel, Railway and similar); if confirmed-not-just-guessed emails matter in production, deploy the backend somewhere that allows outbound SMTP, or use a dedicated verification API instead.

#   C a p r a e - L e a d G e n - E n h a n c e m e n t - P i p e l i n e  
 