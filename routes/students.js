const router = require('express').Router();
const { db, today, thisMonth, DUE_BALANCE, backfillDues, ensureDues } = require('../db');

const activeBatches = () => db.prepare('SELECT * FROM batches WHERE active = 1 ORDER BY name').all();

function readStudent(body) {
  return {
    name: String(body.name || '').trim(),
    phone: String(body.phone || '').trim(),
    parent_name: String(body.parent_name || '').trim(),
    batch_id: Number(body.batch_id) || null,
    monthly_fee: Math.max(0, Math.round(Number(body.monthly_fee) || 0)),
    join_date: /^\d{4}-\d{2}-\d{2}$/.test(body.join_date) ? body.join_date : today(),
    active: body.active ? 1 : 0,
  };
}

router.get('/students', (req, res) => {
  const q = String(req.query.q || '').trim();
  const batch = Number(req.query.batch) || 0;
  const inactive = req.query.inactive === '1';
  const students = db.prepare(`
    SELECT s.*, b.name AS batch_name,
      (SELECT IFNULL(SUM(${DUE_BALANCE}), 0) FROM dues d WHERE d.student_id = s.id) AS pending
    FROM students s LEFT JOIN batches b ON b.id = s.batch_id
    WHERE s.active = ? AND (s.name LIKE ? OR IFNULL(s.phone, '') LIKE ?) AND (? = 0 OR s.batch_id = ?)
    ORDER BY s.name`).all(inactive ? 0 : 1, `%${q}%`, `%${q}%`, batch, batch);
  res.render('students', { title: 'Students', students, q, batch, inactive, batches: activeBatches() });
});

router.get('/students/new', (req, res) => {
  const batches = activeBatches();
  res.render('student-form', { title: 'Add student', student: { join_date: today(), active: 1, batch_id: Number(req.query.batch) || null }, batches });
});

router.post('/students', (req, res) => {
  const s = readStudent(req.body);
  if (!s.name) return res.redirect('/students/new');
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO students (name, phone, parent_name, batch_id, monthly_fee, join_date, active)
    VALUES (@name, @phone, @parent_name, @batch_id, @monthly_fee, @join_date, 1)`).run(s);
  backfillDues({ id: lastInsertRowid, ...s });
  res.redirect('/students/' + lastInsertRowid);
});

router.get('/students/:id', (req, res, next) => {
  const student = db.prepare('SELECT s.*, b.name AS batch_name FROM students s LEFT JOIN batches b ON b.id = s.batch_id WHERE s.id = ?').get(req.params.id);
  if (!student) return next();
  const dues = db.prepare(`SELECT d.*, ${DUE_BALANCE} AS balance FROM dues d WHERE d.student_id = ? ORDER BY d.month DESC`).all(student.id);
  const receipts = db.prepare('SELECT * FROM receipts WHERE student_id = ? ORDER BY id DESC').all(student.id);
  const att = db.prepare(`SELECT COUNT(*) AS total, IFNULL(SUM(present), 0) AS present FROM attendance WHERE student_id = ? AND date >= date('now', '-30 days')`).get(student.id);
  res.render('student', { title: student.name, student, dues, receipts, att, pending: dues.reduce((a, d) => a + Math.max(0, d.balance), 0) });
});

router.get('/students/:id/edit', (req, res, next) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return next();
  res.render('student-form', { title: 'Edit student', student, batches: activeBatches() });
});

router.post('/students/:id', (req, res) => {
  const s = readStudent(req.body);
  const id = Number(req.params.id);
  if (!s.name) return res.redirect(`/students/${id}/edit`);
  db.prepare(`
    UPDATE students SET name = @name, phone = @phone, parent_name = @parent_name, batch_id = @batch_id,
      monthly_fee = @monthly_fee, join_date = @join_date, active = @active WHERE id = @id`).run({ ...s, id });
  // A fee change applies to this month onwards, as long as nothing has been paid against it yet.
  db.prepare(`UPDATE dues SET amount = ? WHERE student_id = ? AND month >= ? AND id NOT IN (SELECT due_id FROM receipt_items)`)
    .run(s.monthly_fee, id, thisMonth());
  ensureDues();
  res.redirect('/students/' + id);
});

// Change (e.g. discount or waive) a single month's due. Cannot go below what is already paid.
router.post('/dues/:id', (req, res, next) => {
  const due = db.prepare('SELECT d.*, d.amount - ' + DUE_BALANCE + ' AS paid FROM dues d WHERE d.id = ?').get(req.params.id);
  if (!due) return next();
  const amount = Math.max(due.paid, Math.round(Number(req.body.amount) || 0));
  db.prepare('UPDATE dues SET amount = ? WHERE id = ?').run(amount, due.id);
  res.redirect('/students/' + due.student_id);
});

router.get('/batches', (req, res) => {
  const batches = db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.active = 1) AS students
    FROM batches b ORDER BY b.active DESC, b.name`).all();
  res.render('batches', { title: 'Batches', batches });
});

router.post('/batches', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name) db.prepare('INSERT INTO batches (name, timing) VALUES (?, ?)').run(name, String(req.body.timing || '').trim());
  res.redirect('/batches');
});

router.post('/batches/:id', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name) {
    db.prepare('UPDATE batches SET name = ?, timing = ?, active = ? WHERE id = ?')
      .run(name, String(req.body.timing || '').trim(), req.body.active ? 1 : 0, req.params.id);
  }
  res.redirect('/batches');
});

module.exports = router;
