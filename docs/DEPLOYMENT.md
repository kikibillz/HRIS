# Persistent production deployment

Run one HRIS container on a host with persistent disk and Docker Compose. This SQLite deployment is not suitable for ephemeral serverless filesystems or multiple independently replicated writers. This configuration does not provision a public server or domain.

## First start

1. Point your domain at the host and configure an HTTPS reverse proxy. Keep the application's port bound to loopback, as in `compose.yaml`.
2. Set `HRIS_PUBLIC_ORIGIN=https://hr.example.com` in the shell or a private `.env` file. Use the exact public origin without a path or trailing slash.
3. Run `docker compose up -d --build`. The named `hris-data` volume stores the database and document records across container replacement. Startup applies additive migrations before accepting traffic. Fresh production databases contain no demo employees.
4. Visit `/signup` to create the first company and owner. Production disables the prototype setup flow; signup remains publicly available for new companies.

Example host Caddy configuration (replace the domain):

```
hr.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy provides TLS; ensure your firewall permits only the intended public proxy ports. Keep production credentials out of source control. The configured HTTPS origin is enforced for mutations, and session cookies use Secure.

## Health and updates

`GET /api/health/live` checks the HTTP process. `GET /api/health/ready` checks access to an existing database and required tables without creating a database or exposing records, paths, or internal errors. Readiness does not guarantee disk capacity or future write success. Both endpoints are public and uncached. Docker uses readiness for its health status; Docker Compose does not automatically restart a merely unhealthy container.

Before updates, create an encrypted operator backup and verify it using [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md). Then pull the reviewed release and run `docker compose up -d --build`. Keep the same Compose project and named volume. Never delete the volume during updates. Check container logs and health after restart. Code rollback does not undo database migrations; use the recovery procedure if data recovery is needed.

For an existing installation, stop its writer, back it up, and copy the complete consistent data directory into the named volume with ownership UID/GID 1000 before the first container startup. Do not copy a live SQLite database alone: committed changes may be in its WAL. Test the migration on a restored copy first. Keep the original installation intact until the new deployment is verified.

Operator tools are included under `/app/scripts`. Supply `HRIS_BACKUP_PASSPHRASE` privately and use `TMPDIR=/var/lib/hris` for large backup snapshots rather than the container's memory-backed `/tmp`. Export encrypted archives off the host and test restoration; a volume alone is not a backup. Never bake passphrases or database files into an image.

## CI and local checks

GitHub Actions builds the app, checks types, runs permission/payroll/migration/backup tests, exercises browser workflows and the calculation workbook, then builds and tests a disposable production container. The container test checks HTTPS origin restrictions, cookie flags, health, absence of demo seed data, and account/password preservation across restart.

Run locally with Node 24:

```sh
npm ci
npm run build
npm run typecheck
npm test
node --experimental-strip-types tests/readiness.mjs
docker build -t hris:test .
python3 tests/container.py hris:test
```

For a non-container standalone launch, copy `public` and `.next/static` into `.next/standalone` as documented by Next.js, then set an absolute persistent `HRIS_DATA_DIR`, HTTPS `HRIS_PUBLIC_ORIGIN`, and `HRIS_ALLOW_SETUP=0` and run `npm run start:production`. The startup script requires Node 24. Keep the process behind your HTTPS proxy and supervise it with your host's service manager.

## Automatic onboarding reminders

Production startup supervises a separate reminder worker. It polls every minute against the same persistent database, with no public job endpoint or scheduler secret. Administrators opt in their own company under **Reminder automation** and choose a Lagos hour. Existing companies start disabled. The worker processes one daily batch at or after that hour; restarting late catches up today's batch but does not replay missed days. Checklists added after a completed batch wait until the next day, or HR can send a manual reminder.

A batch creates inbox notifications and records deliveries in one SQLite transaction. A failed batch rolls back, is marked Failed, and retries on the next poll. Persistent per-checklist daily keys prevent duplicates across workers, retries, restarts, and manual reminders. Older manual audit entries also suppress duplicate sends on their day. Automatic deliveries are attributed to the system, with no fabricated human actor.

The administrator delivery monitor shows the last heartbeat, recent job results, recorded notifications, and employee read marks. A heartbeat older than three minutes is shown as stale. Creation confirms the notification exists in the in-app inbox; read status is not external email delivery or proof that the employee completed the task. If the database is unavailable, inspect process logs as the worker may be unable to record the failure. A Failed job retries; a missing worker requires process recovery. Production startup exits if its worker exits unexpectedly so the configured service supervisor can restart the deployment.

Set `HRIS_REMINDER_WORKER=0` to disable the production worker when a separate supervised worker owns scheduling. For development or an external service manager, use Node 24 and an existing absolute data directory:

```sh
HRIS_DATA_DIR=/absolute/path/to/data npm run reminders:once
HRIS_DATA_DIR=/absolute/path/to/data npm run reminders:watch
```

The CLI refuses missing storage and never seeds demo staff. Do not schedule it against an old database while an incompatible app version is running. Schedule settings, job results and delivery records are included in company backup comparisons and full operator backups. After restoring a historical backup, review reminder settings before restarting scheduling: notifications created after that backup cannot be inferred from the restored database.
