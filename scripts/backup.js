// Safe online backup of the SQLite database. Keeps the last 30 daily copies.
// Usage: node scripts/backup.js   (run daily from cron)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..');
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'tuition.db');
const dir = process.env.BACKUP_DIR || path.join(root, 'backups');
fs.mkdirSync(dir, { recursive: true });

const file = path.join(dir, `tuition-${new Date().toLocaleDateString('en-CA')}.db`);
new Database(dbPath, { readonly: true }).backup(file).then(() => {
  console.log('Backup written to', file);
  const old = fs.readdirSync(dir).filter(f => /^tuition-.*\.db$/.test(f)).sort().slice(0, -30);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
});
