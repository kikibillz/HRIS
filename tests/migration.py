"""Verify additive reporting migrations preserve a pre-feature database exactly."""
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile

with tempfile.TemporaryDirectory(prefix='hris-migration-') as directory:
    database = Path(directory) / 'hris.sqlite'
    with sqlite3.connect(database) as db:
        db.executescript("""
CREATE TABLE departments(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE employees(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, department_id INTEGER NOT NULL REFERENCES departments(id), joined TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active');
CREATE TABLE leaves(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending');
CREATE TABLE accounts(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL UNIQUE REFERENCES employees(id), email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, access TEXT NOT NULL CHECK(access IN ('admin','manager','employee')));
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
CREATE TABLE login_attempts(email TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE TABLE leave_details(leave_id INTEGER PRIMARY KEY REFERENCES leaves(id), reason TEXT NOT NULL);
CREATE TABLE leave_events(id INTEGER PRIMARY KEY, leave_id INTEGER NOT NULL REFERENCES leaves(id), actor_id INTEGER NOT NULL REFERENCES accounts(id), action TEXT NOT NULL, note TEXT NOT NULL, created TEXT NOT NULL);
INSERT INTO departments VALUES(7,'Existing department');
INSERT INTO employees VALUES(41,'Existing person','existing@example.test','Engineer',7,'2025-01-01','Active');
INSERT INTO accounts VALUES(23,41,'existing@example.test','preserve-this-password-hash','admin');
INSERT INTO sessions VALUES('existing-session-hash',23,9999999999999);
INSERT INTO leaves VALUES(17,41,'Annual leave','2026-01-05','2026-01-06','Approved');
INSERT INTO leave_details VALUES(17,'Existing private reason');
INSERT INTO leave_events VALUES(5,17,23,'Submitted','Original note','2025-12-01T12:00:00Z');
INSERT INTO login_attempts VALUES('existing@example.test',2,9999999999999);
""")
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        before = {table: db.execute(f'SELECT * FROM {table}').fetchall() for table in tables}
    for _ in range(2):
        subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e',
                        f'import {str((Path.cwd()/"lib/db.ts").as_uri())!r}'],
                       env={**os.environ, 'HRIS_DATA_DIR': directory}, check=True, capture_output=True)
    with sqlite3.connect(database) as db:
        assert before == {table: db.execute(f'SELECT * FROM {table}').fetchall() for table in tables}
        assert db.execute('SELECT COUNT(*) FROM reporting_lines').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM reporting_events').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM account_links').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM password_attempts').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM security_events').fetchone()[0] == 0
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    # Existing reporting lines and their audit records also survive future starts.
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO employees VALUES(42,'Existing manager','manager@example.test','Lead',7,'2025-01-01','Active')")
        db.execute("INSERT INTO accounts VALUES(24,42,'manager@example.test','manager-hash','manager')")
        db.execute('INSERT INTO company_employees(employee_id,company_id) VALUES(42,1)')
        db.execute('INSERT INTO reporting_lines VALUES(41,24)')
        db.execute("INSERT INTO reporting_events(employee_id,manager_id,actor_id) VALUES(41,24,23)")
        db.execute("INSERT INTO compensation(employee_id,data) VALUES(41,?)",('{"basic":10000000,"version":"legacy-input"}',))
        db.execute("INSERT INTO payroll_runs(id,company_id,period,status,policy,created_by) VALUES(77,1,'2026-09','Paid',?,23)",('{"version":"NG-2026-fixed-monthly-v1"}',))
        db.execute("INSERT INTO payroll_items(run_id,employee_id,details) VALUES(77,41,?)",('{"name":"Existing person","gross":10000000,"paye":123400,"net":9876600,"version":"NG-2026-fixed-monthly-v1"}',))
        db.execute("INSERT INTO payments(run_id,reference,paid_on,created_by) VALUES(77,'EXISTING-BANK-REF','2026-09-30',23)")
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        assigned = {table: db.execute(f'SELECT * FROM {table}').fetchall() for table in tables}
    subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e',
                    f'import {str((Path.cwd()/"lib/db.ts").as_uri())!r}'],
                   env={**os.environ, 'HRIS_DATA_DIR': directory}, check=True, capture_output=True)
    with sqlite3.connect(database) as db:
        assert assigned == {table: db.execute(f'SELECT * FROM {table}').fetchall() for table in tables}
    # Upgrade an existing saved-view table from before pinning, without changing its settings.
    with sqlite3.connect(database) as db:
        db.execute("INSERT INTO review_followup_views(company_id,account_id,name,name_key,filters_json,version) VALUES(1,23,'Existing view','existing view',?,7)", ('{"status":"Open","ownership":"mine","overdue_only":true,"needs_hr_owner":false,"search":"Existing private filter"}',))
        db.execute('ALTER TABLE review_followup_views DROP COLUMN pinned')
        old_view=db.execute('SELECT * FROM review_followup_views').fetchone()
    for _ in range(2):
        subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',f'import {str((Path.cwd()/"lib/db.ts").as_uri())!r}'],env={**os.environ,'HRIS_DATA_DIR':directory},check=True,capture_output=True)
    with sqlite3.connect(database) as db:
        migrated=db.execute('SELECT * FROM review_followup_views').fetchone()
        assert migrated[:-1]==old_view and migrated[-1]==0
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
print('PASS: migration is repeatable; existing accounts, hashes, sessions, employees, requests, reasons and history, including legacy paid payroll, are unchanged.')
