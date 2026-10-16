# Backup and recovery

These tools preserve the existing SQLite data model and accounts. They do not automatically replace a live database, stop a server, reset passwords, or switch the running app to another directory. Creating a backup and exercising recovery are separate actions.

## Company-admin archive

Open **HR operations & self-service → Backups & recovery**.

1. Enter a private 12–128 character backup passphrase, confirm it, and download the encrypted company archive. Store the passphrase separately; the app does not retain or recover it. Copy the downloaded file to storage outside the Codespace/server.
2. The archive includes this company’s employee records, leave, attendance, private/company documents, company account metadata, payroll, payment/void history, reviewed identifiers and generated export packs. Document BLOBs are encoded in the encrypted logical archive. Inactive employees are included.
3. Authentication password hashes, sessions, invitation/reset token rows, login/password attempt counters and AI usage counters are excluded. The archive is not a complete authentication or database-recovery image. It cannot replace records through the web interface.
4. Upload it under **Compare company archive** with its passphrase to compare row counts and content fingerprints. Matching numeric company IDs alone are insufficient: a stored recovery UUID must also match this workspace installation. Archives from another company/installation, operator backups, wrong passphrases and tampered files are rejected.
5. The comparison never applies records. It can show changes even when a table’s row count is unchanged. Generating an archive adds an audit event, so the audit table can differ immediately after download. Initial generation also creates the company’s recovery UUID.

Company archives use AES-256-GCM authenticated encryption with a fresh salt/nonce and a scrypt-derived key. The file header is authenticated too. The download response includes a SHA-256 fingerprint; generated filenames use the UTC metadata date, while comparison times display in Africa/Lagos. Passphrases are sent in the authenticated request body, never a URL, and are not stored. Use the existing private/HTTPS app connection.

The company plaintext archive limit is 96 MiB; the browser accepts encrypted files up to 105 MiB and the preview request is limited to 140 MiB. Large companies should use the operator streaming database backup. Logical company archives require this version’s exact table set for comparison; future schema migrations may need a compatible comparison tool. There is no company-archive import/merge operation.

## Full database backup: trusted server operator only

The operator CLI needs Node.js 24 and filesystem access to the existing database. It includes **every company and account password hash**, along with documents and all SQLite business data. It is deliberately unavailable through company-admin HTTP endpoints.

The CLI uses SQLite’s backup API for a consistent snapshot, including committed data still in the WAL. Copying only a running `hris.sqlite` file with ordinary filesystem copy is not a replacement for this procedure.

From the repository root, retain the server’s existing `HRIS_DATA_DIR` setting. If unset, the tools use `./data/hris.sqlite`. They refuse to create a missing source database. Supply the backup passphrase privately for the shell session:

```bash
read -rs -p 'Backup passphrase: ' HRIS_BACKUP_PASSPHRASE
export HRIS_BACKUP_PASSPHRASE
```

Use a unique, strong passphrase kept separately from the archive. Do not put it in command arguments, source control or shared logs.

```bash
mkdir -p data/backups
npm run backup:create -- --output data/backups/hris-2026-10-16.hrisbackup
```

The output file must not already exist. The command creates a consistent snapshot, checks SQLite integrity and foreign keys, encrypts it, and reports table counts, content fingerprints and the plaintext snapshot SHA-256. Files are created with mode `0600`; temporary directories use `0700`. Streaming encryption/decryption avoids loading the whole database into memory. Private temporary plaintext snapshots are removed on normal completion or handled failure; an abrupt operating-system/process crash may leave its private temporary directory for operator cleanup.

Copy the encrypted archive outside the server/Codespace and test recovery periodically. There is no automatic schedule, offsite storage integration or retention cleanup in this release. SQLite backups do not include code, `.env` configuration, external credentials or files stored outside the database; retain the compatible GitHub revision and server configuration separately.

## Preview recovery

```bash
npm run backup:preview -- --input data/backups/hris-2026-10-16.hrisbackup
```

The CLI authenticates/decrypts the backup into a private temporary directory, checks integrity and foreign keys, and compares table counts and row-content hashes against the configured live database. It uses read transactions so comparisons are internally consistent. It does not import the application database module, run migrations, seed accounts or modify the live database.

A healthy backup can still be inspected when the current database is missing or damaged: the report gives `current_error` and no current comparison. A damaged backup, failed authentication, unsupported backup type or missing core schema is rejected. Recovery supports the current HRIS schema with companies, employees, accounts and payroll runs; this is not a universal SQLite restore tool.

## Prepare a recovered copy

```bash
npm run backup:restore -- --input data/backups/hris-2026-10-16.hrisbackup --output data/recovered-2026-10-16
```

The destination must be a **new directory**. The CLI refuses to overwrite any existing directory or database. It verifies the source, writes the recovered database into the new directory, and validates it again. In that copy it deletes recovered sessions and marks unused invitation/reset links as used. Original accounts, password hashes, employee records, documents, approved payslips, payment records and export history remain intact. All companies’ users will need to sign in again after cutover; old unused account links cannot be replayed.

The result reports the source and recovered database hashes, checks, counts and the number of revoked bearer credentials. The hashes can differ because session/link revocation intentionally changes the recovered copy. No running server is stopped or switched, and the original data directory remains intact.

After checking the recovered copy, an operator can perform the separate cutover:

1. Stop the existing HRIS server using its terminal/process manager; keep its data directory for rollback. Do not start a second server against the same live database during cutover.
2. Persist `HRIS_DATA_DIR` as the absolute path to the recovered directory in the server environment.
3. Start the compatible app revision. In a Codespace, after stopping the old preview, a one-session example is:

   ```bash
   HRIS_DATA_DIR="$PWD/data/recovered-2026-10-16" bash scripts/start-preview.sh
   ```

4. Sign in using an existing account/password and verify company isolation, employee/document access, released payroll, payment balances and export history. The preview script’s health check will reuse an already-running server, so stop the old instance before expecting a data-directory switch.
5. Keep the previous directory until recovery has been verified and a new offsite backup exists. A one-command environment assignment is not persistent server configuration; preserve `HRIS_DATA_DIR` for future restarts.

```bash
unset HRIS_BACKUP_PASSPHRASE
```

The CLI never prints the passphrase or account hashes. Operator reports include cross-company names/counts and content fingerprints; keep them in operator-only logs. Git ignores encrypted `.hrisbackup` files and `hris.sqlite` database/sidecar files to reduce accidental commits. These safeguards do not turn a Codespace disk into offsite backup storage.

## Verification

`python3 tests/backups.py` uses disposable databases to verify company/role boundaries, authentication-field exclusion, document preservation, encrypted downloads, wrong-key/tamper rejection, recovery UUID matching, same-row-count content changes, consistent full backups, no overwrite, inspection with a damaged live database, session/link revocation in a new recovered copy, unchanged live data, preserved account password hashes and a real sign-in against the restored app. It is included in `npm test`.

The browser suite exercises company archive download/comparison and employee denial. All recovery tests use temporary directories; no test reads or restores the working database.

Candidate offer letters and response events are preserved in backups. Company archives exclude `recruiting_offer_links`. Full operator recovery deletes recovered offer-link credentials in the new copy and reports `revoked_offer_links`; the live database is unchanged. Replace links for unexpired unanswered offers through **Offer letters** after recovery. Accepted and declined responses remain final historical records.
