# Debian deployment

## 1. Prepare the application

```bash
sudo useradd --system --home /opt/pos-laptop --shell /usr/sbin/nologin pos-laptop
sudo mkdir -p /opt/pos-laptop /var/lib/pos-laptop/data /var/lib/pos-laptop/backups
sudo chown -R pos-laptop:pos-laptop /opt/pos-laptop /var/lib/pos-laptop
```

Copy the repository to `/opt/pos-laptop`, then create `/opt/pos-laptop/.env`:

```env
PORT=3000
DATABASE_PATH=/var/lib/pos-laptop/data/pos.sqlite
DEFAULT_ADMIN_PASSWORD=replace-with-a-long-random-password
CORS_ORIGIN=https://pos.example.com
BACKUP_DIR=/var/lib/pos-laptop/backups
BACKUP_INTERVAL_MS=86400000
BACKUP_RETENTION_DAYS=30
SERVICE_PIN_ENCRYPTION_KEY=
```

The first startup creates the `admin` user with `DEFAULT_ADMIN_PASSWORD`. Change it from the profile screen after login. Do not commit `.env` or reuse the example password. The systemd unit sets `NODE_ENV=production`, so browser session cookies receive the `Secure` attribute.

Service device PINs are encrypted at rest. For a managed key, generate one on the server with `openssl rand -hex 32` and place the result in `SERVICE_PIN_ENCRYPTION_KEY`. If the setting is empty, startup generates `/var/lib/pos-laptop/data/pos.sqlite.pin-key`. Preserve the key securely alongside database recovery materials; it is not inside the SQLite snapshot. Losing or changing it makes stored PINs unreadable.

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

The application creates an SQLite backup at startup and then every `BACKUP_INTERVAL_MS` into `BACKUP_DIR`. The systemd unit already permits writes to `/var/lib/pos-laptop`, so keep the built-in backup directory there. Copy the backup files to a separate disk or server as part of your disaster-recovery routine; local snapshots alone do not protect against disk loss.

To verify the backup after installation:

```bash
sudo -u pos-laptop find /var/lib/pos-laptop/backups -name 'pos-*.sqlite' -ls
sudo journalctl -u pos-laptop -n 50 --no-pager
```

An optional external cron backup can be used instead of the built-in schedule when you need a separate mount:

Install the `sqlite3` CLI, make the script executable, and add a daily cron entry:

```bash
sudo chmod +x deploy/backup-sqlite.sh
sudo mkdir -p /var/backups/pos-laptop
sudo chown pos-laptop:pos-laptop /var/backups/pos-laptop
sudo -u pos-laptop BACKUP_DIR=/var/backups/pos-laptop DATABASE_PATH=/var/lib/pos-laptop/data/pos.sqlite /opt/pos-laptop/deploy/backup-sqlite.sh
```

The script uses SQLite online backup and removes backups older than 14 days. Do not schedule both backup methods unless duplicate backups are intentional.
