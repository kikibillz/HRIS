# Production operations and backup automation

Status: tooling and examples are prepared. No production host, off-site mount, timer or alert destination is installed by committing these files. The owner still needs to name the operator and confirm the host/domain and storage destination. Use Node 24 and a compatible application revision. Keep secrets outside Git and chat.

## Responsibilities to assign

| Role | Responsibility | Assigned person |
| --- | --- | --- |
| HR lead | Staff data, access, salaries, workflows, pilot acceptance | Unassigned |
| Accountant/payroll specialist | Tax/contribution rules, reference cases and representative payroll approval | Unassigned |
| Technical operator | HTTPS host, persistent storage, monitoring, backup schedule and updates | Unassigned |
| Recovery owner and alternate | Backup key custody, restore decisions, restore rehearsal and cutover | Unassigned |

One qualified person may cover several roles. The checklist and this table record responsibilities; they do not appoint or notify anybody.

## Automated backup and restore rehearsal

`npm run backup:maintain` wraps the existing full-database CLI. Each run:

1. Requires an existing absolute live data directory, a separate existing owner-only backup directory, and an owner-only service-owned passphrase file. It never initializes application storage. Keep the key outside the archive destination and retain it separately in your chosen secret store.
2. Requires the configured backup filesystem to be mounted. If the mount disappears, the job fails instead of silently filling an ordinary local directory. A mount check proves a filesystem is mounted, not that its provider stores an independent off-site copy; the operator must verify that arrangement.
3. Acquires a directory lock, creates a consistent encrypted archive, restores it into a new private temporary directory, and verifies integrity, foreign keys and the source snapshot hash. Only the recovered copy has sessions/unused links revoked. The live database is never replaced or migrated. The plaintext drill copy is removed after normal completion or handled failure.
4. Writes owner-only verification metadata, `last-success.json` and `last-attempt.json`. Reports omit passwords, passphrases, employee names and payroll details. Archives still include every company's sensitive data and account password hashes.
5. Removes expired archives only after this run's successful restore drill. Cleanup is limited to this tool's managed, unchanged, verified archives for this source path. It preserves manual archives, other-source archives and unverified/tampered files. Default retention is 30 days, configurable from 1 to 3650 days. Keep this policy consistent with your actual recovery and data-retention obligations. A restored source path has a different source identity; its old archives are deliberately not pruned automatically.

The job is one run, not a scheduler. Use a host scheduler to invoke it. Configure `HRIS_DATA_DIR`, `HRIS_BACKUP_DIR`, `HRIS_BACKUP_MOUNT`, `HRIS_BACKUP_KEY_FILE` and retention using [the environment example](../deploy/operations.env.example). The source database must be readable and the archive destination writable by the service user. This release targets Linux for mount validation.

Use a **dedicated backup directory per source installation**: status files and the overlap lock belong to that installation. Existing directories must already exist; the tool will not create an off-site mount. Set mode 0700 on the archive directory and 0600 on the key, owned by the service user. Provision the key through your secure configuration mechanism, not a command argument. These files and permissions must be mapped appropriately when using a container.

`HRIS_BACKUP_ALLOW_LOCAL=1` explicitly enables a **local rehearsal only**. Reports label it `local-test`; production monitoring rejects such a report unless the monitor is also explicitly in local-test mode. This is useful for disposable tests, not evidence that off-site backups are configured.

A hard kill or host crash can leave private temporary files and the overlap lock. Inspect the process list and service journal, confirm no backup is running, remove the stale lock, and inspect temporary recovery directories before retrying. The script never guesses that a lock is stale. Keep backup encryption keys available when the host is lost; recovery cannot recreate them.

## Five-minute read-only monitor

`npm run operations:check` emits one JSON report and exits 0 when all configured checks pass, otherwise 1. It checks:

- Required database migrations without seeding or repairing storage.
- Available disk bytes in the live filesystem, with a default minimum of 1 GiB (`HRIS_MIN_FREE_BYTES`).
- A fresh verified backup from this source (default maximum 36 hours via `HRIS_BACKUP_MAX_AGE_HOURS`), an unchanged encrypted archive hash, the destination mount, and a successful latest attempt. A failed latest attempt still needs attention even if an older good archive exists.
- Reminder-worker heartbeat under three minutes old and no last recorded error, when any company has enabled automatic reminders. Disabled schedules do not require a running worker.
- The readiness HTTP response when `HRIS_MONITOR_ORIGIN` is configured. Use the exact HTTPS origin or loopback HTTP origin. Requests time out after five seconds and do not follow redirects.

This reports conditions; it does not send emails, page an operator, restart processes, verify payroll law, or detect every failure. Connect the exit status/journal to your host's monitoring/alert service and test a real alert after choosing a provider and recipient. Reading large encrypted backup files for a hash can take time; schedule accordingly. The monitor does not require or read the backup passphrase.

## Linux systemd examples

The units in [deploy/systemd](../deploy/systemd) are **templates for a standalone host checkout**, not a drop-in mapping of a Docker named volume. They assume an unprivileged `hris` service user, code at `/opt/peopleos`, live storage `/var/lib/hris`, and an already-mounted backup filesystem `/mnt/hris-backups`. Adapt every path, mount dependency, service account and Node 24 binary before installation. Review the service's read/write paths and ensure the actual storage is visible to that user. Docker images include the two operator scripts too, but you must explicitly mount archive storage and a private key before running them; the application Compose service does not mount secrets or off-site storage automatically.

The backup timer runs daily around **02:00 Africa/Lagos**, with up to five minutes of jitter and one catch-up run after downtime. The monitor runs every five minutes. Neither timer is enabled in this development workspace.

On the provisioned host, after installing the adapted units in `/etc/systemd/system/` and the real private configuration in `/etc/peopleos/operations.env`:

```sh
sudo systemctl daemon-reload
sudo systemctl start hris-backup.service
sudo systemctl start hris-monitor.service
sudo systemctl enable --now hris-backup.timer hris-monitor.timer
sudo systemctl list-timers 'hris-*'
sudo journalctl -u hris-backup.service -u hris-monitor.service --since today
```

Start each service successfully before enabling its timer. Read the report: a `local-test` result is not production off-site verification. With Docker, use the actual volume/bind-mount paths and service UID; do not point an operator at a second empty directory that merely resembles live storage.

## Incident and release routine

- **Preview won't open:** in the Codespace, run `npm run dev -- --port 3000` from the HRIS directory and keep the terminal running. Open the private forwarded port 3000. This workspace and your Codespace are separate machines. Inspect terminal output if the port is occupied or compilation fails.
- **Production unavailable:** check the reverse proxy, process/container state, `/api/health/live`, `/api/health/ready`, and the monitor report. Inspect storage capacity and reminder-worker supervision. Do not delete the data volume or reset accounts to fix availability.
- **Backup failure:** check mount availability, filesystem space, ownership, key file and lock. Preserve the last good archive and key. Correct the condition and rerun maintenance; confirm the new drill succeeds before relying on retention.
- **Update:** preserve a verified off-site archive and compatible revision/configuration, test on a restored copy, update the single writer, then verify login, readiness and worker behavior. See [deployment](DEPLOYMENT.md).
- **Recovery:** use [the recovery procedure](BACKUP-RECOVERY.md) to write a separate copy and validate existing accounts/documents/payroll. A restore drill is not a live cutover. Only the designated operator stops the writer and switches persistent storage after approval from the recovery owner.

A restored historical backup cannot infer later payments, external filings or later notifications. Reconcile external evidence and review reminder settings before resuming operations.
