# Tuition Manager

A small, mobile-friendly app for a tuition centre that does two things: tracks fees and tracks attendance.

**Stack:** Node.js + Express, EJS templates, SQLite (better-sqlite3). No build step.

## Features

- **Dashboard**: amount collected today and this month, pending dues, today's attendance, a 6-month collections chart, recent payments, and a big **Collect fee** button.
- **Fees**: each student has a monthly fee. A due is created automatically every month. Collect several months at once, or pay part of a month. You get a receipt you can share on WhatsApp or print. You can adjust a month's due (discount or waiver) and delete a receipt entered by mistake.
- **Attendance**: pick a batch; everyone starts as present; tap the students who are absent; save.
- **Reports**: collections by date range (with CSV export), pending dues, and attendance % per student.

## Run locally

```bash
npm install
cp .env.example .env      # edit centre name, currency, admin password
npm start                 # http://localhost:3000  (user: admin)
```

## Deploy on Ubuntu VPS

```bash
# 1. Node 22+ and build tools (for better-sqlite3)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential nginx

# 2. App
sudo mkdir -p /opt/tuition && sudo chown $USER /opt/tuition
# copy project files to /opt/tuition (git clone / scp), then:
cd /opt/tuition
npm ci --omit=dev
cp .env.example .env && nano .env          # set ADMIN_PASSWORD, CURRENCY, TZ

# 3. Keep it running with PM2
sudo npm i -g pm2
pm2 start npm --name tuition -- start
pm2 save && pm2 startup                    # run the command it prints

# 4. Nginx + HTTPS
sudo cp deploy/nginx.conf /etc/nginx/sites-available/tuition   # edit server_name
sudo ln -s /etc/nginx/sites-available/tuition /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tuition.example.com
# then set COOKIE_SECURE=1 in .env and: pm2 restart tuition

# 5. Daily backup at 2 AM (keeps 30 days in /opt/tuition/backups)
(crontab -l 2>/dev/null; echo "0 2 * * * cd /opt/tuition && /usr/bin/node scripts/backup.js >> backups/backup.log 2>&1") | crontab -
```

Copy the `backups/` folder off the server from time to time. All your data is in the single file `data/tuition.db`.

## Notes

- Amounts are whole numbers (no paise/halalas).
- When a student's fee changes, the new fee applies to the current and future months that haven't been paid yet.
- A student marked inactive gets no new dues. Any dues they already owe stay pending.
- There is one login (`admin`). Change the password from **Account** after you first log in.
