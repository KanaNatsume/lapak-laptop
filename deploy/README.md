# Debian deployment

## 1. Prepare the application

```bash
sudo useradd --system --home /opt/pos-laptop --shell /usr/sbin/nologin pos-laptop
sudo mkdir -p /opt/pos-laptop /var/lib/pos-laptop/data /var/backups/pos-laptop
sudo chown -R pos-laptop:pos-laptop /opt/pos-laptop /var/lib/pos-laptop
```

Copy the repository to `/opt/pos-laptop`, then create `/opt/pos-laptop/.env`:

```env
PORT=3000
DATABASE_PATH=/var/lib/pos-laptop/data/pos.sqlite
DEFAULT_ADMIN_PASSWORD=replace-with-a-long-random-password
CORS_ORIGIN=https://pos.example.com
```

The first startup creates the `admin` user with `DEFAULT_ADMIN_PASSWORD`. Change it from the profile screen after login. Do not commit `.env` or reuse the example password.

## 2. Install and build

Use a supported Node.js LTS version, then:

```bash
cd /opt/pos-laptop
npm ci
npm run build:frontend
sudo chown -R pos-laptop:pos-laptop /opt/pos-laptop /var/lib/pos-laptop
```

## 3. Run with systemd

```bash
sudo cp deploy/pos-laptop.service /etc/systemd/system/pos-laptop.service
sudo systemctl daemon-reload
sudo systemctl enable --now pos-laptop
sudo systemctl status pos-laptop
```

## 4. Reverse proxy and HTTPS

Copy `deploy/nginx.conf` to `/etc/nginx/sites-available/pos-laptop`, replace `pos.example.com`, enable it, then issue a certificate with Certbot:

```bash
sudo ln -s /etc/nginx/sites-available/pos-laptop /etc/nginx/sites-enabled/pos-laptop
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d pos.example.com
```

After HTTPS is active, set `CORS_ORIGIN` to the HTTPS origin and restart the service.

## 5. SQLite backup

Install the `sqlite3` CLI, make the script executable, and add a daily cron entry:

```bash
sudo chmod +x deploy/backup-sqlite.sh
sudo -u pos-laptop BACKUP_DIR=/var/backups/pos-laptop DATABASE_PATH=/var/lib/pos-laptop/data/pos.sqlite deploy/backup-sqlite.sh
```

The script uses SQLite online backup and removes backups older than 14 days. Copy backups to a separate disk or server for disaster recovery.
