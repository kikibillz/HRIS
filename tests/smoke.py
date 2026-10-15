"""Functional tests against a production server with a disposable SQLite database."""
import json, os, subprocess, tempfile, time, urllib.request, urllib.error

def request(path='/', body=None, method=None):
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request('http://127.0.0.1:3101'+path, data=payload, method=method, headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

with tempfile.TemporaryDirectory(prefix='hris-smoke-') as directory:
    with open(os.path.join(directory,'server.log'),'w+') as log:
        server = subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3101'], env={**os.environ,'HRIS_DATA_DIR':directory}, stdout=log, stderr=log)
        try:
            for _ in range(60):
                try:
                    status, html = request()
                    if status == 200: break
                except (OSError, TimeoutError): pass
                if server.poll() is not None: raise AssertionError('Server exited before readiness')
                time.sleep(.25)
            else: raise AssertionError('Server did not become ready')
            assert 'A good day starts with your people.' in html
            assert 'Olivia Rhye' in html
            assert request('/api/employees', {'name':'Test Person','email':'invalid','role':'Tester','department_id':1})[0] == 400
            employee={'name':'Test Person','email':'test@example.test','role':'Tester','department_id':1}
            assert request('/api/employees', employee)[0] == 201
            assert request('/api/employees', employee)[0] == 400
            assert request('/api/departments', {'name':'Quality Assurance'})[0] == 201
            assert request('/api/departments', {'name':'Quality Assurance'})[0] == 400
            assert request('/api/leaves', {'employee_id':9,'type':'Annual leave','start':'2026-12-10','end':'2026-12-09'})[0] == 400
            assert request('/api/leaves', {'employee_id':9,'type':'Annual leave','start':'2026-12-10','end':'2026-12-12'})[0] == 201
            assert request('/api/leaves', {'id':3,'status':'Approved'}, 'PATCH')[0] == 200
            assert request('/api/leaves', {'id':3,'status':'Declined'}, 'PATCH')[0] == 409
            assert request('/api/leaves', {'id':2,'status':'Declined'}, 'PATCH')[0] == 200
            _, html = request()
            assert 'Test Person' in html and 'Quality Assurance' in html
            import sqlite3
            with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
                assert db.execute('SELECT status FROM leaves WHERE id=3').fetchone()[0] == 'Approved'
                assert db.execute('SELECT COUNT(*) FROM employees').fetchone()[0] == 9
            print('PASS: functional checks — rendering, creation, validation, duplicate prevention, leave decisions, SQLite persistence.')
        except Exception:
            log.seek(0)
            print(log.read()[-6000:])
            raise
        finally:
            server.terminate()
            server.wait(timeout=10)
