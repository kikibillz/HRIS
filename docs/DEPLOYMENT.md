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
