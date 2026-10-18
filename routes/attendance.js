const router = require('express').Router();
const { db, today } = require('../db');

const validDate = d => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today());

router.get('/attendance', (req, res) => {
  const date = validDate(req.query.date);
  const batches = db.prepare(`
    SELECT b.*, COUNT(s.id) AS students, COUNT(a.student_id) AS marked, IFNULL(SUM(a.present), 0) AS present
    FROM batches b
    LEFT JOIN students s ON s.batch_id = b.id AND s.active = 1
    LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
    WHERE b.active = 1 GROUP BY b.id ORDER BY b.name`).all(date);
  res.render('attendance', { title: 'Attendance', date, batches, saved: req.query.saved });
});

router.get('/attendance/:batchId', (req, res, next) => {
  const date = validDate(req.query.date);
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batchId);
  if (!batch) return next();
  const students = db.prepare(`
    SELECT s.id, s.name, a.present FROM students s
    LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
    WHERE s.batch_id = ? AND s.active = 1 ORDER BY s.name`).all(date, batch.id);
  res.render('attendance-mark', { title: batch.name, batch, date, students, isMarked: students.some(s => s.present !== null) });
});

const upsert = db.prepare(`
  INSERT INTO attendance (student_id, date, present) VALUES (?, ?, ?)
  ON CONFLICT (student_id, date) DO UPDATE SET present = excluded.present`);

router.post('/attendance/:batchId', (req, res) => {
  const date = validDate(req.body.date);
  const present = new Set([].concat(req.body.present || []).map(Number));
  const ids = db.prepare('SELECT id FROM students WHERE batch_id = ? AND active = 1').pluck().all(req.params.batchId);
  db.transaction(() => { for (const id of ids) upsert.run(id, date, present.has(id) ? 1 : 0); })();
  res.redirect(`/attendance?date=${date}&saved=${encodeURIComponent(req.params.batchId)}`);
});

module.exports = router;
