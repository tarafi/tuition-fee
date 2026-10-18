const router = require('express').Router();
const { db, today, thisMonth, monthsBetween, DUE_BALANCE } = require('../db');

const PENDING_SQL = `
  SELECT s.id, s.name, s.phone, b.name AS batch_name, SUM(x.balance) AS pending, COUNT(*) AS months
  FROM (SELECT d.student_id, ${DUE_BALANCE} AS balance FROM dues d) x
  JOIN students s ON s.id = x.student_id
  LEFT JOIN batches b ON b.id = s.batch_id
  WHERE x.balance > 0 AND s.active = 1
  GROUP BY s.id ORDER BY pending DESC, s.name`;

router.get('/', (req, res) => {
  const t = today();
  const todayTotal = db.prepare('SELECT IFNULL(SUM(total), 0) FROM receipts WHERE paid_on = ?').pluck().get(t);
  const monthTotal = db.prepare('SELECT IFNULL(SUM(total), 0) FROM receipts WHERE paid_on LIKE ?').pluck().get(thisMonth() + '%');
  const pending = db.prepare(PENDING_SQL).all();
  const att = db.prepare('SELECT COUNT(*) AS total, IFNULL(SUM(present), 0) AS present FROM attendance WHERE date = ?').get(t);

  const [y, m] = thisMonth().split('-').map(Number);
  const start = new Date(y, m - 6, 1).toLocaleDateString('en-CA').slice(0, 7);
  const byMonth = Object.fromEntries(db.prepare(
    `SELECT substr(paid_on, 1, 7) AS month, SUM(total) AS total FROM receipts WHERE paid_on >= ? GROUP BY month`
  ).all(start + '-01').map(r => [r.month, r.total]));
  const chart = monthsBetween(start, thisMonth()).map(month => ({ month, total: byMonth[month] || 0 }));

  const recent = db.prepare(`SELECT r.*, s.name FROM receipts r JOIN students s ON s.id = r.student_id ORDER BY r.id DESC LIMIT 5`).all();

  res.render('dashboard', {
    title: 'Dashboard', todayTotal, monthTotal, att, chart, recent,
    pendingTotal: pending.reduce((a, p) => a + p.pending, 0), pendingCount: pending.length,
  });
});

function range(req) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : thisMonth() + '-01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : today();
  return { from, to };
}

const COLLECTIONS_SQL = `
  SELECT r.*, s.name, s.phone FROM receipts r JOIN students s ON s.id = r.student_id
  WHERE r.paid_on BETWEEN ? AND ? ORDER BY r.paid_on DESC, r.id DESC`;

router.get('/reports', (req, res) => {
  const tab = ['collections', 'pending', 'attendance'].includes(req.query.tab) ? req.query.tab : 'collections';
  const { from, to } = range(req);
  const batch = Number(req.query.batch) || 0;
  const data = { title: 'Reports', tab, from, to, batch, batches: db.prepare('SELECT * FROM batches WHERE active = 1 ORDER BY name').all() };

  if (tab === 'collections') {
    data.rows = db.prepare(COLLECTIONS_SQL).all(from, to);
    data.byMethod = db.prepare('SELECT method, SUM(total) AS total, COUNT(*) AS n FROM receipts WHERE paid_on BETWEEN ? AND ? GROUP BY method ORDER BY total DESC').all(from, to);
    data.total = data.rows.reduce((a, r) => a + r.total, 0);
  } else if (tab === 'pending') {
    data.rows = db.prepare(PENDING_SQL).all();
    data.total = data.rows.reduce((a, r) => a + r.pending, 0);
  } else {
    data.rows = db.prepare(`
      SELECT s.id, s.name, b.name AS batch_name, COUNT(a.date) AS total, IFNULL(SUM(a.present), 0) AS present
      FROM students s LEFT JOIN batches b ON b.id = s.batch_id
      LEFT JOIN attendance a ON a.student_id = s.id AND a.date BETWEEN ? AND ?
      WHERE s.active = 1 AND (? = 0 OR s.batch_id = ?)
      GROUP BY s.id ORDER BY s.name`).all(from, to, batch, batch);
  }
  res.render('reports', data);
});

router.get('/reports/collections.csv', (req, res) => {
  const { from, to } = range(req);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Receipt', 'Date', 'Student', 'Phone', 'Method', 'Amount', 'Note'].join(',')];
  for (const r of db.prepare(COLLECTIONS_SQL).all(from, to)) {
    lines.push([req.app.locals.receiptNo(r.id), r.paid_on, r.name, r.phone, r.method, r.total, r.note].map(esc).join(','));
  }
  res.attachment(`collections_${from}_to_${to}.csv`).type('text/csv').send(lines.join('\n'));
});

module.exports = router;
