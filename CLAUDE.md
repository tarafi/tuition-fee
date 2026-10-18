# Tuition Manager

Node + Express + EJS + better-sqlite3. No build step, no frontend framework. Server-rendered pages; tiny inline scripts only where needed.

- `server.js`: app setup, auth (cookie-session, single `admin` user), account page, mounts routes
- `db.js`: schema (created on start), date helpers, `DUE_BALANCE` SQL fragment, dues generation (`backfillDues` for new students, `ensureDues` hourly for the current month)
- `routes/`: `reports.js` (dashboard `/` + `/reports`), `students.js` (students, batches, due adjust), `fees.js` (collect + receipts), `attendance.js`
- `views/`: EJS; every page includes `partials/head` and `partials/foot`. Helpers on `app.locals`: `money`, `monthLabel`, `dateLabel`, `receiptNo`
- `public/style.css`: single mobile-first stylesheet

Fee model: `dues` (one row per student per month) ← `receipt_items` → `receipts`. Balance = due amount − sum of items. Amounts are integers.
Run: `npm start`. Config in `.env` (see `.env.example`).
