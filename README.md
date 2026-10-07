# Fulfillment Hub

A lightweight fulfillment operations app for **XYZ** — a small e-commerce business shipping 200–300 orders a day from its own warehouse, currently run on spreadsheets and shared folders.

> **Make fulfillment status obvious, prevent avoidable mistakes, and surface exceptions before they become missed shipments.**

Order Received → Processed → Picking → Packing → Staging → Shipped — every step is visible, every mistake the warehouse used to make is blocked at the moment it would happen, and every problem becomes a tracked issue with an owner.

---

## Quick start (about 3 minutes)

You need **Python 3.10+** and **Node.js 18.18+**.

```bash
# 1) Backend — http://localhost:8000  (API docs at /docs)
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The first start creates `backend/fulfillment_hub.db` and fills it with demo data automatically.

```bash
# 2) Frontend — http://localhost:3000   (in a second terminal)
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**. If the backend runs somewhere else, copy `frontend/.env.example` to `frontend/.env.local` and change `NEXT_PUBLIC_API_URL`.

### Reset / reseed demo data

| How | Command |
|---|---|
| From the app | **Settings & demo → Reset demo data** (Office role) |
| From the terminal | `cd backend && python -m app.seed` |

Demo data is generated **relative to the current time**, so ship-by deadlines, courier pickups and "delayed" orders always look realistic whenever you run it.

### Run the tests

```bash
cd backend
python -m pytest            # or: python -m unittest discover -s tests
```

### Production build

```bash
cd frontend && npm run build && npm start
```

### Deploy to Vercel

The repo deploys as **one Vercel project with two services**, defined in `vercel.json` at the repo root:

| Service | Folder | Public path |
|---|---|---|
| `backend` (FastAPI, `app.main:app`) | `backend/` | `/api/*`, plus `/docs` and `/openapi.json` |
| `frontend` (Next.js) | `frontend/` | everything else |

Both share one domain, so the web app simply calls `/api/...` on its own site. No URLs, CORS or environment variables to set.

1. Push the repo to GitHub.
2. Vercel → **Add New → Project** → import the repo. Leave **Root Directory** as the repo root (`./`) — Vercel reads `vercel.json` and builds both services.
3. Deploy. Check `https://<your-app>.vercel.app/api/health` → `{"ok": true, ...}`, then open the site.

To run the same setup locally: `vercel dev` from the repo root (Vercel CLI). The usual two-terminal setup in **Quick start** still works too.

**About the demo data on Vercel.** Vercel Functions have no permanent disk, so the backend keeps its SQLite database in `/tmp` and seeds fresh demo data automatically when a new instance starts. Everything works normally while an instance is warm, but after a period of inactivity (or if traffic is spread over several instances) the data starts again from a fresh seed — like pressing **Reset demo data**. That is fine for a demo. For data that must persist, run the backend on a host with a persistent disk (e.g. Render, Railway, Fly.io) with `uvicorn app.main:app --host 0.0.0.0 --port $PORT` and `FH_DB_PATH` pointing at that disk.

Optional backend environment variables: `FH_TZ` (business time zone, default `Asia/Kolkata`), `FH_DB_PATH` (database file), and `FH_CORS_ORIGINS` / `FH_CORS_ORIGIN_REGEX` (only when a frontend on another domain calls the API through `NEXT_PUBLIC_API_URL`).

---

## Demo roles (no passwords)

Switch in the sidebar (bottom-left) or on the Settings page. Every action is recorded under the chosen person.

| Role | Who | Sees |
|---|---|---|
| **Office Operator** | Priya (Office) | Everything: dashboard, processing desk, orders, inventory & transfers, issues, analytics, reset |
| **Warehouse Worker** | Ravi (Warehouse) | A simple home with big doors: Picking, Packing, Staging, Receiving, Bins & stock (read-only), Guide (+ Issues, Shift handover) |

Rules are enforced by the **backend** (e.g. a warehouse worker can't write off stock or process orders — the API returns 403), not just hidden buttons.

---

## The 5-minute demo

The seed creates one priority order (shown on **Settings → 5-minute demo guide**, usually the newest one, customer *Ananya Iyer*) that is set up for this exact walkthrough:

1. **Dashboard** — the Action Queue ranks what to do first; the pipeline and the bottleneck banner show where work is piling up. Every KPI opens its filtered list.
2. **Open the priority order** — ship-by countdown, *"Why is this blocked?"*: *"SKU SHO-009-BLK-42 (Black / 42) needs 2 units. Main Warehouse has 0 available. Secondary Warehouse has 8. Transfer required."*
3. **Next action → Transfer 8 units** (covers both orders waiting for that shoe *and* refills the empty bin). Then **Inventory → Received at Main**. The order becomes *Ready to pick* automatically — and so does the other waiting order.
   - **Processing desk** — new orders in queue order (priority → ship-by → first received); "What will happen" previews each result before you click *Process next*.
   - **Inventory & bins** — every bin aisle by aisle with a fill bar; bins below 50% say *Transfer required* (create one or all in a click).
4. **Switch to Warehouse → Picking** — items listed in walking order by bin, big *Picked* buttons.
5. **Packing** — scan `TSH-014-BLU-L` on purpose → *"Stop — Wrong variant: expected TSH-014-BLU-M (Blue / M), scanned TSH-014-BLU-L (Blue / L)"*. Scan the right items, try a wrong label (e.g. `LBL-FH-23001`) → rejected. Scan the right label → packed.
6. **Stage** in the suggested courier lane → **tick the parcel → Hand over** → manifest created, order *Shipped*.
7. **Dashboard** again — KPIs, pipeline and the activity log have all updated. The order timeline shows every step, who did it and when.

---

## New in this version

| Area | What it does |
|---|---|
| **Activity records** (`/activity`) | A permanent, read-only record of every action by every person (and the system). One card per person (actions today, total, last action, main area of work) — click to filter. Filter by date (Today / Yesterday / 7 days / All / pick dates), role, area of work (Orders, Picking, Packing, Staging & handover, Stock, Receiving & reorders, Issues, Team) and free-text search; records grouped by day, newest first, with links to the order, parcel or issue; **Show more** paging and **Export CSV**. *My activity* in the top-right person menu; *All records* on the Dashboard; *Full record* on every order. Switching person ("sign in") and resetting demo data are now recorded too. API: `GET /api/activity/records`, `GET /api/activity/people`, `GET /api/activity/actions`, `POST /api/session`. |
| **New look** | Navy sidebar with a clear "you are here" marker and grouped menu; top bar shows the current page, search, clock, alerts and a person menu; roomier cards and tables, one accent colour for actions and colour reserved for status (green done · blue in progress · amber attention · red act now); KPI cards with a status strip; segmented tabs; modals with a fixed header and footer. **Guide** now has a sticky contents list that follows your scroll and one full-width card per page (steps left, buttons right) instead of wrapping chips and narrow columns. |
| **Staging** (`/staging`) | Packed parcels only. **To stage** lists every packed parcel with a suggested area and the reason — one tap *Stage at …*, or *Choose area*. All **eight staging areas** are shown as cards with purpose, capacity and fill: the four courier lanes plus **Priority Shelf P-01** (priority, any courier), **Dispatch Zone 1/2** (overflow, any courier) and **Rack B-04** (hold rack — never handed over). Suggestion rule: blocked/cancelled → hold rack; priority → priority shelf; else the courier's lane, overflow when full. Putting a parcel in another courier's lane needs an extra confirmation and is flagged *Wrong lane*. Open an area to see its parcels, whether each can leave, and *Move*. |
| **Ready to hand over** (`/handover`) | Staged parcels by courier: ready to leave (with where to collect them) and *can't leave yet* (not staged, hold rack, blocking issue — with the reason). **Courier arrived** records the visit and hands over in the courier's **handover mode** (set by the office): *Manual* (checklist pre-ticked, grouped by area), *Automatic when the courier arrives* (every ready parcel at once), or *Automatic at pickup time* (the system hands over ready parcels at each scheduled pickup instead of flagging a missed pickup). "Courier is here" badge, last visit, manifest on completion. |
| **Shipped** (`/shipped`) | Everything that left: Today / Yesterday / 7 days / All, courier filter, search. Tabs for **Parcels** (courier, time, before/after ship-by, by hand vs automatic, manifest, area it was taken from), **Manifests** (view & print) and **Courier visits** (parcels taken, parcels left behind). |
| **Guide & glossary** | Every page now has *How to use it* steps and a *Buttons and what they do* table; new rules for staging and handover; ~30 new glossary words; new "what to do when…" answers; colour legend for staging areas and handover types. |
| **Reorders** (`/reorders`) | Buying from suppliers, end to end. **Needs reordering** lists every SKU whose *stock position* (available in Main + available in Secondary + waiting for put-away + already on order) is below the **reorder point** (half the Main bin + what waiting orders need) — i.e. a transfer can't fix it. Each row explains why, suggests a quantity (fills the Main bin and covers waiting orders, rounded up to packs of 5) and a supplier (last supplier for that SKU, else the category's usual one). Tick → **Order selected** creates one reorder per supplier; **New reorder** orders anything by hand. Every reorder creates an **expected delivery** on Receiving and tracks per line: *ordered · arrived OK · damaged · not coming · still due · on shelf*. Statuses: Ordered → Partly received → Received / Closed short, or Cancelled. Office can change the expected date, cancel (before anything arrived) or close (rest not coming). Late deliveries are flagged. |
| **Receiving, reworked** (`/receiving`) | Tabs *Needs action / To count / To put away / Done*. Each line is counted as **arrived OK, damaged or not arrived** (big − / + boxes, *All OK*, *Not arrived*, *Everything arrived*). Missing units are either **still coming** (a follow-up delivery is created with its date) or **not coming** (closed + Receiving Shortage issue); damaged units can be sent back for replacement. **Put away now** shelves the good units in their usual bins in the same step, or **Put away all** later. **Correct count** fixes a mistake afterwards (with a reason) and adjusts stock waiting for put-away automatically. **Log a new arrival** records stock nobody expected (and warns if that SKU is on an expected delivery). |
| **Joined-up stock screens** | Inventory shows *On order* per SKU, a *Reorder / on order* filter, and every *Reorder* badge opens the Reorders page with that SKU ticked; the blocking-stock panel offers *Reorder from supplier* instead of a dead end. Manual stock adjustment stays (office), now with a − / + counter, the change shown as +/−, and one-tap reasons. Dashboard: *Need reordering* and *Deliveries to receive* KPIs, Action Queue rows for reorders and late deliveries. Global search finds reorders (RO-…) and deliveries (IN-…). Guide: new page docs, rules, glossary words and "what to do when…" answers. |
| **Processing desk** (`/processing`) | New orders are handled strictly in queue order — **priority first → earliest ship-by → first received (FIFO)**. Each row shows its queue position, the suggested courier, and a preview of what processing will do (*Stock ready* / *Will wait for stock* / *Will be held*), simulated top to bottom so it accounts for stock the orders above will take. *Process next*, *Process next N* and *Process selected* always run in queue order; each order runs on its own savepoint so one problem never half-applies a batch. Also lists orders on hold and orders waiting for stock (with the fix), plus recently processed. |
| **Bins in order** (Inventory) | Every bin in walking order (A-01-01, A-01-02 … aisle by aisle; Secondary by rack) with on hand, reserved, available, capacity and a fill bar (available / reserved / 50% line). Main ↔ Secondary switch, search by bin/SKU, phone layout. |
| **Preventive refill — "Transfer required"** | Every bin has a **capacity**. When **available** units in the Main bin drop **below 50%** of capacity, a transfer from Secondary is required (below 25% = critical). The suggested quantity refills the bin (and covers any waiting orders), capped by what Secondary has. One transfer or **Create all** in one click; shown on the Dashboard (KPI + Action Queue row), sidebar badge, Inventory and the bin map. Capacity is editable per bin (office). If Secondary is empty it says *Reorder*; if a delivery is due or waiting for put-away it says so. |
| **Guide & glossary** (`/guide`) | Plain-language help for everyone: start-here steps per role, the journey of an order, every page explained, the live rules (numbers from `config.py`), colours & badges, order statuses, a searchable A–Z glossary of ~60 words, "what to do when…", and what is deliberately not built. |

**Bugs fixed:** resolving a blocking issue now releases a waiting order when stock is available (it used to stay stuck); the warehouse can confirm a *Return to Shelf* task (the people returning the items were blocked); a courier chosen before processing is kept instead of being overwritten; the Orders date filter uses local (IST) days, not UTC days; put-away refuses a bin that already holds another SKU; an issue can't reference a package that doesn't exist; older databases are upgraded in place (new `capacity` column) instead of crashing; detail pages no longer flash the previous order/issue when you move to another one; cards no longer overflow the screen on phones (grid items can shrink).

---

## Which problems I chose, and why

The PDF lists seven symptoms. They share three root causes: **nobody can see the state of an order**, **mistakes are only discovered after they ship**, and **problems live in people's heads**. So the product is organised around those three.

| # | Problem (from the PDF) | What Fulfillment Hub does | Why this matters most |
|---|---|---|---|
| 1 | Can't see order status at a glance | Pipeline, live order statuses, full **timeline/audit log** per order, global search | Every other fix depends on knowing where an order is |
| 2 | Delays go unnoticed | Every order has a **ship-by** time; **On track / At risk / Delayed** computed from configurable thresholds; Action Queue | Late is only fixable *before* the deadline |
| 3 | Priority orders get mixed in | Priority badge everywhere; priority sorts first in every work queue; blocked priority orders are flagged *At risk* | Priority = same-day promise to the customer |
| 4 | Stock in the spreadsheet can't be found | **Reservation** (available = on hand − reserved), **two-warehouse transfers**, **Stock Not Found** exception flow, **receiving/put-away** | Stops promising stock that isn't really there |
| 5 | Wrong product or variant shipped | **Packing verification**: every unit scanned against the order, wrong SKU/variant/over-scan rejected, **label check**, weight sanity check | The most expensive mistake — prevent it, don't correct it |
| 6 | Boxes misplaced / courier misses pickup | **Package records** with a **staging location**, "Find a package", pickup alerts, automatic **Missed Pickup** issues, handover **manifests** | A box always has a known place until the courier signs for it |
| 7 | Problems handled informally | Central **Issues** with type, severity, owner, status, history; **Shift handover** notes | Nothing is forgotten when someone goes home |

### Required by the PDF vs. enhancements

| Feature | Source |
|---|---|
| Order stages, status visibility, delays, priority handling | Required by the PDF |
| Two warehouses — ship only from Main, transfer from Secondary | Required by the PDF |
| Couriers differ in cost, speed and pickup time — transparent recommendation | Required by the PDF |
| Wrong-item prevention, misplaced boxes, missed pickups, informal problems | Required by the PDF |
| Receiving & put-away (stock not sellable until shelved) | PDF background ("each delivery has to be unloaded, checked, and put on the shelves") |
| **Action Queue** (ranked to-do list with one-click fixes) | Enhancement |
| **"Why is this blocked?"** and **Next action** on every order | Enhancement |
| **Inventory reservation**, all-or-nothing, priority-first allocation | Enhancement |
| **Label mismatch** and **weight** checks at packing | Enhancement |
| Order **holds**: duplicate import, incomplete address, unusual value/quantity | Enhancement (multi-channel reality) |
| **Processing desk** with fixed queue order and batch processing | Enhancement |
| **Bin map** and **preventive refill** (below 50% of bin capacity → transfer required) | Enhancement |
| **Guide & glossary** page | Enhancement (training / handover) |
| **Courier cutoff** rule: orders after cutoff show next-day ship-by honestly | Enhancement |
| **Cancellation mid-flow** → return-to-shelf / pull-from-staging tasks | Enhancement |
| **Handover manifests** (proof of what the courier took) | Enhancement |
| **Shift handover** summary + notes | Enhancement |
| **Bottleneck detection** (largest queue, rule-based) & small Analytics page | Enhancement |
| Idempotent actions, strict state transitions, activity log | Enhancement (reliability) |
| Demo reset, demo roles | For the reviewer |

### Deliberately **not** built (and why)

- **Real barcode scanners, courier APIs, marketplace integrations** — out of scope for sample data; the scan box accepts keyboard-wedge scanners as-is.
- **Batch/wave picking** — with 2–3 pickers and bin-sorted pick lists, the added complexity wasn't worth it yet. It's the natural next step if picking becomes the bottleneck.
- **Full authentication** — demo roles show the permission model without passwords.
- **Predictive/AI features** — every rule (risk, ranking, courier choice, bottlenecks) is deterministic and explained on screen. Warehouse staff need to trust *why* the system says something.
- **Multi-carrier rate shopping, returns (RTO) processing, cycle-count scheduling** — valuable, but secondary to the seven problems above.

---

## How it works — the key rules

- **Ship-by**: priority orders received before 14:00 ship the same day by 18:00; after that, the next day (flagged *after cutoff*). Normal orders ship the next day (or the day after if received after 16:00). All values live in `backend/app/config.py`.
- **Risk**: *Delayed* = ship-by passed and not shipped. *At risk* = inside the warning window (3h priority, 6h normal) and not yet staged, **or** a priority order that is blocked.
- **Reservation**: processing reserves stock in Main **all-or-nothing** (a half-reserved order would lock stock another order could ship today). Picking converts the reservation into a deduction exactly once. Cancelling releases it.
- **Allocation order** when stock arrives (transfer or put-away): priority first, then earliest ship-by.
- **Queue order** for processing: priority first, then earliest ship-by, then first received.
- **Preventive refill**: available in Main < `REPLENISH_BELOW_PCT` (50%) of the bin's capacity → *Transfer required*; suggested = fill the bin (or cover waiting orders, whichever is more), capped by Secondary's available stock.
- **Transitions** are enforced in the service layer: can't pack before every item is picked *and* every unit scanned; can't stage before packing; can't hand over unless staged; can't ship with an unresolved critical/blocking issue. There is no status dropdown.
- **Idempotency**: picking twice, handing over twice, receiving a transfer twice, resolving twice, or re-reporting the same problem never duplicates stock movements, shipments or issues. Duplicate open transfers are rejected.
- **Missed pickup**: a packed/staged parcel still in the building 15 minutes after its courier's pickup gets a *Missed Pickup* issue and is rolled to the next pickup; the issue closes itself when the parcel is handed over.
- **Action Queue score** = base for the kind of problem + 30 if priority + urgency (time left) + severity. Shown one row per order, most important reason only.

---

## Architecture

```
fulfillment-hub/
├── backend/                  FastAPI + SQLite
│   ├── app/
│   │   ├── main.py           app, CORS, error handlers, auto-seed on first start
│   │   ├── config.py         every operational threshold in one place
│   │   ├── db.py             connections, schema, transactions
│   │   ├── clock.py          business time zone, pickup slots
│   │   ├── schemas.py        typed request bodies (Pydantic)
│   │   ├── deps.py           request dependencies (db, demo actor)
│   │   ├── seed.py           realistic demo data (runs the real services)
│   │   ├── routers/          orders, warehouse (pick/pack/stage), inventory, issues, system
│   │   └── services/         ALL business rules live here
│   │       ├── orders.py     intake, holds, courier choice, risk, "why blocked", next action
│   │       ├── processing.py queue order, "what will happen" preview, batch processing
│   │       ├── inventory.py  reservation, allocation, transfers, receiving, adjustments, bin map, refills
│   │       ├── reorders.py   reorder suggestions, purchase orders, arrival tracking
│   │       ├── picking.py    picking + stock-not-found / damaged flows
│   │       ├── packing.py    scan verification, label & weight checks, packages
│   │       ├── dispatch.py   staging, handover, manifests, missed-pickup sweep
│   │       ├── issues.py     issue lifecycle
│   │       └── dashboard.py  KPIs, Action Queue, bottleneck, search, analytics, shift
│   └── tests/                business-rule, workflow, seed and HTTP tests
└── frontend/                 Next.js (App Router) + React + TypeScript + Tailwind
    ├── app/                  one folder per screen
    ├── components/           StatusBadge, KpiCard, DataTable, OrderTimeline, IssueCard, EmptyState,
    │                         Modal/ConfirmDialog, SearchBar, FilterBar, BlockedReason, NextActionBanner, AppShell
    └── lib/                  api client, hooks (live data, countdowns), formatting, types, context
```

**Design choices**

- **One process, one database file.** No queues, caches or microservices — a small warehouse doesn't need them.
- **Business rules only in `services/`.** Routers are thin; the UI never decides whether a transition is allowed.
- **Each request is one transaction** (`BEGIN IMMEDIATE`), so the same unit of stock can't be reserved by two requests at once, and a failed action leaves nothing half-done.
- **Plain SQL on Python's built-in `sqlite3`** behind `db.py`. Moving to PostgreSQL means swapping the connection in `db.py` and the `?` placeholders for `%s`; the schema uses standard types.
- **Recorded failures are returned, not raised.** A wrong scan or wrong label is a normal outcome: it is saved (activity + issue) and returned as `{ok: false, message}`. Rule violations that should change nothing (e.g. packing before picking) are raised as friendly `409` errors.
- **Times** are stored in UTC and always displayed in the business time zone (`Asia/Kolkata` by default).

### Database entities

`warehouses`, `products` (SKU = product + variant), `inventory` (per SKU per warehouse: bin, capacity, on hand, reserved, awaiting put-away), `couriers` (pickup times, cost, speed, staging lane), `orders`, `order_items` (reserved / picked / verified quantities), `packages`, `manifests` (with how the handover happened), `courier_visits`, `transfers`, `reorders` + `reorder_lines` (purchase orders), `inbound` + `inbound_lines` (deliveries: source, linked reorder line, what happened to missing units), `issues`, `activity` (audit log), `shift_notes`, plus `counters` and `meta`.

### API overview

All endpoints are under `/api`; interactive docs at **http://localhost:8000/docs**. Send `X-Role: office|warehouse` to act as a demo role.

| Area | Endpoints |
|---|---|
| Overview | `GET /dashboard`, `/notifications`, `/nav-counts`, `/search?q=`, `/analytics`, `/activity`, `/meta` |
| Orders | `GET /orders` (filters: q, stage, priority, risk, courier, channel, has_issue, date_from, date_to, sort), `GET /orders/{id}`, `POST /orders`, `POST /orders/{id}/process`, `/release-hold`, `/cancel`, `/courier` |
| Picking | `GET /picking/queue`, `GET /picking/{id}`, `POST /order-items/{id}/pick`, `POST /order-items/{id}/problem`, `POST /issues/{id}/pick-action` |
| Packing | `GET /packing/queue`, `GET /packing/{id}`, `POST /packing/{id}/scan`, `/reset`, `/complete` |
| Staging & handover | `GET /staging` (to stage + areas), `GET /staging/areas`, `GET /packages/find?q=`, `POST /packages/{id}/stage` (`location`, `confirm_other_lane`), `GET /handover` (per courier: ready / not ready / mode / on site), `POST /couriers/{id}/arrived` (`package_ids` or none = mode decides), `POST /couriers/{id}/handover-mode`, `POST /handover`, `GET /manifests/{id}`, `GET /shipped?range=today\|yesterday\|7d\|all&courier=&q=` |
| Processing | `GET /processing`, `POST /processing/batch` (`{count}` or `{order_ids}`) |
| Inventory | `GET /inventory` (view, q, sort=bin), `GET /inventory/bins?warehouse=MAIN\|SEC`, `GET /inventory/replenishment`, `POST /inventory/replenish`, `POST /inventory/capacity`, `GET /inventory/shortages`, `POST /inventory/adjust`, `GET/POST /transfers`, `POST /transfers/{id}/dispatch`, `/receive`, `/cancel` |
| Receiving | `GET /inbound`, `POST /inbound/{id}/receive` (`lines`, `missing_action: close\|backorder`, `replace_damaged`, `backorder_expected_at`, `putaway_now`), `POST /inbound/arrival`, `POST /inbound/{id}/putaway-all`, `POST /inbound-lines/{id}/putaway`, `POST /inbound-lines/{id}/correct` |
| Reorders | `GET /reorders` (status=open\|overdue\|done\|all, q), `GET /reorders/suggestions`, `GET /reorders/suppliers`, `POST /reorders`, `POST /reorders/bulk`, `GET /reorders/{id}`, `POST /reorders/{id}/expected`, `/cancel`, `/close` |
| Issues | `GET/POST /issues`, `GET/PATCH /issues/{id}`, `POST /issues/{id}/resolve` |
| Shift & demo | `GET /shift`, `POST /shift/notes`, `POST /demo/reset` |

Errors always come back as `{"detail": "<plain-language message>", "code": "..."}` — the UI shows the message as-is.

---

## Demo data

~275 orders (about a day and a half of volume plus a few stuck older ones) across Amazon, Flipkart, Myntra and the website; 50 SKUs across 17 products; 2 warehouses with bin locations; 4 couriers (Delhivery, BlueDart, XpressBees, Shadowfax) with different pickup times, costs and speeds; packages, manifests, transfers, deliveries, issues and ~2,500 activity records.

Orders are pushed through the **real service functions** with a simulated clock, so stock, reservations, packages and history are always consistent. Deliberate scenarios include: the demo priority order waiting on a transfer, a second order waiting on the same SKU, a SKU with no stock anywhere and a supplier delivery on the way, received stock awaiting put-away that is blocking orders, a stock-not-found report, a wrong-variant scan waiting at packing, wrong variants caught earlier, a duplicate marketplace import, an incomplete address, a cancellation after picking, missed courier pickups, a transfer in transit, a short supplier delivery, and delayed priority orders.

---

## How it was built — step by step

1. **Read the brief, list the problems.** Grouped the PDF's seven symptoms into three root causes (visibility, prevention, exceptions) and listed hidden problems the PDF implies (receiving, overselling, wrong labels, cutoffs, cancellations, shift changes).
2. **Wrote the rules before the screens.** Order statuses and the allowed transitions; ship-by and risk rules; the stock model (on hand / reserved / available / awaiting put-away). Put every threshold in `config.py`.
3. **Built the database and service layer.** One service per area (orders, inventory, picking, packing, dispatch, issues), each writing to the activity log.
4. **Added the "brains" as plain rules.** Blocked reasons with real numbers, next actions, the Action Queue score, courier recommendation, bottleneck detection, missed-pickup sweep.
5. **Wrote realistic seed data** by running the real services over a simulated day and a half, plus specific scenarios for the demo.
6. **Tested the rules** — happy path end to end, every forbidden transition, idempotency, reservations, transfers, receiving, verification failures, missed pickups.
7. **Exposed a REST API** with typed request bodies and friendly error messages.
8. **Built the frontend** shell (sidebar, search, alerts, roles), then the dashboard, then each workflow screen — warehouse screens with large text and large buttons, office screens with tables and filters.
9. **Checked it in a browser** — clicked through the whole demo, looked at every page at desktop and phone widths, fixed what looked cluttered.
10. **Documented** decisions, trade-offs and the demo path.

---

## Walkthrough video & AI usage

- Video (≤ 5 min): _[Insert video link here before submitting]_
- AI usage note: see [`AI_USAGE.md`](AI_USAGE.md)
