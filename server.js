const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const { db, hashPassword, verifyPassword, sessionSecret, ensureDues } = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

const CURRENCY = process.env.CURRENCY ?? '₹';
const LOCALE = process.env.LOCALE || 'en-IN';
app.locals.centerName = process.env.CENTER_NAME || 'Tuition Centre';
app.locals.money = n => CURRENCY + Number(n || 0).toLocaleString(LOCALE);
app.locals.monthLabel = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
app.locals.dateLabel = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
app.locals.receiptNo = id => 'R-' + String(id).padStart(5, '0');

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use(cookieSession({
  name: 'sess',
  secret: sessionSecret,
  maxAge: 30 * 24 * 3600 * 1000,
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === '1',
}));

// --- Auth ---
const failures = new Map();
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const f = failures.get(req.ip) || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 15 * 60e3) { f.n = 0; f.t = Date.now(); }
  if (f.n >= 10) return res.status(429).render('login', { error: 'Too many attempts. Try again in 15 minutes.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username || '').trim());
  if (user && verifyPassword(String(req.body.password || ''), user.password_hash)) {
    failures.delete(req.ip);
    req.session.uid = user.id;
    return res.redirect('/');
  }
  f.n++;
  failures.set(req.ip, f);
  res.status(401).render('login', { error: 'Wrong username or password' });
});

app.use((req, res, next) => {
  if (!req.session.uid) return res.redirect('/login');
  res.locals.path = req.path;
  next();
});

app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

app.get('/account', (req, res) => res.render('account', { title: 'Account', msg: null, error: null }));
app.post('/account', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.uid);
  const { current = '', next = '' } = req.body;
  const render = (error, msg) => res.render('account', { title: 'Account', error, msg });
  if (!verifyPassword(current, user.password_hash)) return render('Current password is wrong');
  if (next.length < 6) return render('New password must be at least 6 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
  render(null, 'Password changed');
});

// --- App routes ---
app.use(require('./routes/reports'));
app.use(require('./routes/students'));
app.use(require('./routes/fees'));
app.use(require('./routes/attendance'));

app.use((req, res) => res.status(404).render('message', { title: 'Not found', text: 'That page does not exist.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('message', { title: 'Error', text: 'Something went wrong. Please try again.' });
});

ensureDues();
setInterval(ensureDues, 60 * 60 * 1000);

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`Tuition manager running on http://${host}:${port}`));
