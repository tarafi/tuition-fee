const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// The database (and session secret) live next to DB_PATH, so they can sit outside the code folder.
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'tuition.db');
const dataDir = path.dirname(dbPath);
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Amounts are stored as whole currency units (integers).
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  timing TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  parent_name TEXT,
  batch_id INTEGER REFERENCES batches(id),
  monthly_fee INTEGER NOT NULL DEFAULT 0,
  join_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS dues (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  month TEXT NOT NULL,
  amount INTEGER NOT NULL,
  UNIQUE (student_id, month)
);
CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  total INTEGER NOT NULL,
  method TEXT NOT NULL,
  paid_on TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS receipt_items (
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  due_id INTEGER NOT NULL REFERENCES dues(id),
  amount INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attendance (
  student_id INTEGER NOT NULL REFERENCES students(id),
  date TEXT NOT NULL,
  present INTEGER NOT NULL,
  PRIMARY KEY (student_id, date)
);
CREATE INDEX IF NOT EXISTS idx_receipts_paid_on ON receipts(paid_on);
CREATE INDEX IF NOT EXISTS idx_items_due ON receipt_items(due_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
`);

// Local dates (respects the TZ env var) as YYYY-MM-DD / YYYY-MM.
const today = () => new Date().toLocaleDateString('en-CA');
const thisMonth = () => today().slice(0, 7);

// Outstanding amount of a due row aliased as `d`.
const DUE_BALANCE = `(d.amount - IFNULL((SELECT SUM(amount) FROM receipt_items WHERE due_id = d.id), 0))`;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}

function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(pw, salt, 64));
}

if (!db.prepare('SELECT 1 FROM users').get()) {
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hashPassword(pw));
  console.log(`Created user "admin"${process.env.ADMIN_PASSWORD ? '' : ' with password "admin123" - change it after logging in'}`);
}

const secretFile = path.join(dataDir, '.secret');
if (!process.env.SESSION_SECRET && !fs.existsSync(secretFile)) {
  fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
}
const sessionSecret = process.env.SESSION_SECRET || fs.readFileSync(secretFile, 'utf8');

function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

const insertDue = db.prepare('INSERT OR IGNORE INTO dues (student_id, month, amount) VALUES (?, ?, ?)');

// New student: create a due for every month from joining up to now.
const backfillDues = db.transaction(s => {
  if (s.monthly_fee <= 0) return;
  for (const m of monthsBetween(s.join_date.slice(0, 7), thisMonth())) insertDue.run(s.id, m, s.monthly_fee);
});

// Every active student gets a due for the current month.
const ensureDues = db.transaction(() => {
  const m = thisMonth();
  for (const s of db.prepare('SELECT id, monthly_fee FROM students WHERE active = 1 AND monthly_fee > 0 AND join_date <= ?').all(today())) {
    insertDue.run(s.id, m, s.monthly_fee);
  }
});

module.exports = { db, today, thisMonth, monthsBetween, DUE_BALANCE, hashPassword, verifyPassword, sessionSecret, backfillDues, ensureDues };
