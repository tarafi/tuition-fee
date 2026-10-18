const router = require('express').Router();
const { db, today, DUE_BALANCE } = require('../db');

const METHODS = ['Cash', 'UPI', 'Bank transfer', 'Card'];

router.get('/collect', (req, res) => {
  const q = String(req.query.q || '').trim();
  const students = db.prepare(`
    SELECT s.id, s.name, s.phone, b.name AS batch_name,
      (SELECT IFNULL(SUM(${DUE_BALANCE}), 0) FROM dues d WHERE d.student_id = s.id) AS pending
    FROM students s LEFT JOIN batches b ON b.id = s.batch_id
    WHERE s.active = 1 AND (s.name LIKE ? OR IFNULL(s.phone, '') LIKE ?)
    ORDER BY pending DESC, s.name LIMIT 100`).all(`%${q}%`, `%${q}%`);
  res.render('collect', { title: 'Collect fee', students, q });
});

router.get('/collect/:id', (req, res, next) => {
  const student = db.prepare('SELECT s.*, b.name AS batch_name FROM students s LEFT JOIN batches b ON b.id = s.batch_id WHERE s.id = ?').get(req.params.id);
  if (!student) return next();
  const dues = db.prepare(`SELECT d.*, ${DUE_BALANCE} AS balance FROM dues d WHERE d.student_id = ? AND ${DUE_BALANCE} > 0 ORDER BY d.month`).all(student.id);
  res.render('collect-form', { title: 'Collect fee', student, dues, methods: METHODS, today: today(), error: req.query.error ? 'Nothing was saved: amounts must be between 0 and the balance due.' : null });
});

const dueBalance = db.prepare(`SELECT d.id, ${DUE_BALANCE} AS balance FROM dues d WHERE d.id = ? AND d.student_id = ?`);
const insertReceipt = db.prepare('INSERT INTO receipts (student_id, total, method, paid_on, note) VALUES (?, ?, ?, ?, ?)');
const insertItem = db.prepare('INSERT INTO receipt_items (receipt_id, due_id, amount) VALUES (?, ?, ?)');

router.post('/collect/:id', (req, res) => {
  const studentId = Number(req.params.id);
  const method = METHODS.includes(req.body.method) ? req.body.method : 'Cash';
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(req.body.paid_on) ? req.body.paid_on : today();
  const note = String(req.body.note || '').trim();

  const save = db.transaction(() => {
    const items = [];
    // Keys are "d<dueId>" so the body parser keeps them as an object, not a renumbered array.
    for (const [key, value] of Object.entries(req.body.pay || {})) {
      const amount = Math.round(Number(value) || 0);
      if (amount === 0) continue;
      const due = dueBalance.get(Number(key.slice(1)), studentId);
      if (!due || amount < 0 || amount > due.balance) throw new Error('Invalid amount');
      items.push([due.id, amount]);
    }
    if (!items.length) return null;
    const total = items.reduce((a, [, amt]) => a + amt, 0);
    const receiptId = insertReceipt.run(studentId, total, method, paidOn, note).lastInsertRowid;
    for (const [dueId, amount] of items) insertItem.run(receiptId, dueId, amount);
    return receiptId;
  });

  let receiptId;
  try { receiptId = save(); } catch { receiptId = undefined; }
  if (!receiptId) return res.redirect(`/collect/${studentId}?error=1`);
  res.redirect('/receipts/' + receiptId);
});

router.get('/receipts/:id', (req, res, next) => {
  const receipt = db.prepare('SELECT r.*, s.name, s.phone, s.parent_name FROM receipts r JOIN students s ON s.id = r.student_id WHERE r.id = ?').get(req.params.id);
  if (!receipt) return next();
  const items = db.prepare('SELECT i.amount, d.month FROM receipt_items i JOIN dues d ON d.id = i.due_id WHERE i.receipt_id = ? ORDER BY d.month').all(receipt.id);
  const pending = db.prepare(`SELECT IFNULL(SUM(${DUE_BALANCE}), 0) FROM dues d WHERE d.student_id = ?`).pluck().get(receipt.student_id);
  res.render('receipt', { title: 'Receipt', receipt, items, pending });
});

router.post('/receipts/:id/delete', (req, res) => {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (receipt) db.prepare('DELETE FROM receipts WHERE id = ?').run(receipt.id);
  res.redirect(receipt ? '/students/' + receipt.student_id : '/');
});

module.exports = router;
