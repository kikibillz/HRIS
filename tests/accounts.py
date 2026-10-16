"""Account lifecycle HTTP checks. Uses a disposable database and port 3103."""
import concurrent.futures
import hashlib
import http.cookiejar
import json
import os
import secrets
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

BASE = 'http://127.0.0.1:3103'
checks = 0
password = secrets.token_urlsafe(24)
new_password = secrets.token_urlsafe(24)
reset_password = secrets.token_urlsafe(24)
class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.http = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
    def request(self, path='/', body=None, method=None, origin=BASE):
        request = urllib.request.Request(BASE+path, data=None if body is None else json.dumps(body).encode(), method=method,
            headers={'Origin':origin, 'Content-Type':'application/json'})
        try:
            response = self.http.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read().decode(), response.headers
    def expect(self, status, path='/', body=None, method=None, **kwargs):
        global checks
        actual, text, headers = self.request(path,body,method,**kwargs)
        assert actual == status, f'{method or "GET"} {path}: expected {status}, got {actual}: {text[:200]}'
        checks += 1
        return json.loads(text) if headers.get('Content-Type','').startswith('application/json') else text

def redeem(link, secret=password, **extra):
    return {'token': link['path'].split('token=')[1], 'password':secret, **extra}
def login(client,email,secret=password):
    return client.expect(200,'/api/auth',{'email':email,'password':secret})

with tempfile.TemporaryDirectory(prefix='hris-accounts-') as directory:
    database = os.path.join(directory,'hris.sqlite')
    with open(os.path.join(directory,'server.log'),'w+') as log:
        server = subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3103'],
            env={**os.environ,'HRIS_DATA_DIR':directory,'HRIS_ALLOW_SETUP':'1'},stdout=log,stderr=log)
        try:
            guest, admin, staff, second, manager = Client(), Client(), Client(), Client(), Client()
            for _ in range(80):
                try:
                    if guest.request('/login')[0] == 200: break
                except OSError: pass
                if server.poll() is not None: raise AssertionError('Server exited')
                time.sleep(.25)
            else: raise AssertionError('Server did not start')
            admin.expect(201,'/api/auth',{'action':'setup','name':'Account Admin','email':'admin@example.test','password':password})
            def employee(name, access='employee', **extra):
                return {'name':name,'email':name.lower()+'@example.test','role':'Engineer','department_id':1,'access':access,**extra}
            for name,access in [('Worker','employee'),('Manager','manager')]:
                admin.expect(201,'/api/employees',employee(name,access,password=password))
            login(staff,'worker@example.test');login(second,'worker@example.test');login(manager,'manager@example.test')
            with sqlite3.connect(database) as db:
                worker_id=db.execute("SELECT id FROM employees WHERE email='worker@example.test'").fetchone()[0]
                manager_id=db.execute("SELECT id FROM accounts WHERE email='manager@example.test'").fetchone()[0]
                admin_id=db.execute("SELECT employee_id FROM accounts WHERE email='admin@example.test'").fetchone()[0]
            target={'employee_id':worker_id}
            guest.expect(405,'/api/account-links')
            guest.expect(405,'/api/account-links/redeem')
            guest.expect(405,'/api/password')
            for method in ['POST','DELETE']:
                guest.expect(401,'/api/account-links',target,method)
                staff.expect(403,'/api/account-links',target,method)
                manager.expect(403,'/api/account-links',target,method)
                admin.expect(403,'/api/account-links',target,method,origin='https://untrusted.example')
            guest.expect(401,'/api/password',{'current_password':password,'password':new_password})
            staff.expect(403,'/api/password',{'current_password':password,'password':new_password},origin='https://untrusted.example')
            staff.expect(400,'/api/password',{'current_password':password,'password':'short'})
            staff.expect(400,'/api/password',{'current_password':password,'password':password})
            admin.expect(400,'/api/account-links',{**target,'access':'admin'})
            admin.expect(404,'/api/account-links',{'employee_id':999999})
            # Reissue and revocation do not alter passwords or existing sessions.
            first = admin.expect(200,'/api/account-links',target)
            status, payload, headers=admin.request('/api/account-links',target)
            assert status==200 and headers.get('Cache-Control')=='no-store'
            replacement = admin.expect(200,'/api/account-links',target)
            assert replacement['purpose']=='reset' and 3500000 < replacement['expires']-time.time()*1000 < 3601000
            guest.expect(400,'/api/account-links/redeem',redeem(first))
            admin.expect(200,'/api/account-links',target,'DELETE')
            guest.expect(400,'/api/account-links/redeem',redeem(replacement))
            staff.expect(200)
            expired=admin.expect(200,'/api/account-links',target)
            with sqlite3.connect(database) as db:
                db.execute('UPDATE account_links SET expires=0 WHERE token_hash=?',(hashlib.sha256(redeem(expired)['token'].encode()).hexdigest(),))
            guest.expect(400,'/api/account-links/redeem',redeem(expired))
            # Current-password verification is throttled per account.
            for _ in range(5):staff.expect(400,'/api/password',{'current_password':'wrong-password-long','password':new_password})
            staff.expect(429,'/api/password',{'current_password':password,'password':new_password})
            recovery=admin.expect(200,'/api/account-links',target)
            guest.expect(403,'/api/account-links/redeem',redeem(recovery,reset_password),origin='https://untrusted.example')
            guest.expect(400,'/api/account-links/redeem',{**redeem(recovery),'password':'short'})
            # Visiting the page does not consume the fragment token or expose it server-side.
            html=guest.expect(200,'/activate')
            assert redeem(recovery)['token'] not in html
            with sqlite3.connect(database) as db:
                assert db.execute('SELECT used_at FROM account_links WHERE token_hash=?',(hashlib.sha256(redeem(recovery)['token'].encode()).hexdigest(),)).fetchone()[0] is None
            guest.expect(200,'/api/account-links/redeem',redeem(recovery,reset_password,employee_id=admin_id,access='admin'))
            guest.expect(400,'/api/account-links/redeem',redeem(recovery,new_password))
            staff.expect(401,'/api/leaves',{})
            second.expect(401,'/api/leaves',{})
            guest.expect(401,'/api/auth',{'email':'worker@example.test','password':password})
            login(staff,'worker@example.test',reset_password);login(second,'worker@example.test',reset_password)
            outstanding=admin.expect(200,'/api/account-links',target)
            staff.expect(200,'/api/password',{'current_password':reset_password,'password':new_password,'employee_id':admin_id})
            staff.expect(401,'/api/leaves',{})
            second.expect(401,'/api/leaves',{})
            guest.expect(400,'/api/account-links/redeem',redeem(outstanding,password))
            guest.expect(401,'/api/auth',{'email':'worker@example.test','password':reset_password})
            login(staff,'worker@example.test',new_password)
            login(Client(),'admin@example.test') # target spoof did not affect admin
            # Invite new staff without an initial password. Roles come from the stored link.
            invitation=admin.expect(201,'/api/employees',employee('Invited',setup='invite'))
            assert invitation['purpose']=='invite' and 172700000 < invitation['expires']-time.time()*1000 < 172801000
            with sqlite3.connect(database) as db:
                invited_id=db.execute("SELECT id FROM employees WHERE email='invited@example.test'").fetchone()[0]
                assert db.execute('SELECT id FROM accounts WHERE employee_id=?',(invited_id,)).fetchone() is None
                stored=db.execute('SELECT token_hash FROM account_links WHERE employee_id=?',(invited_id,)).fetchone()[0]
                assert stored==hashlib.sha256(redeem(invitation)['token'].encode()).hexdigest()
                assert redeem(invitation)['token'] not in stored
            guest.expect(401,'/api/auth',{'email':'invited@example.test','password':password})
            guest.expect(200,'/api/account-links/redeem',redeem(invitation,access='admin',email='admin@example.test'))
            guest.expect(400,'/api/account-links/redeem',redeem(invitation))
            invited=Client();login(invited,'invited@example.test')
            invited.expect(403,'/api/departments',{'name':'Forbidden escalation'})
            # Existing imported people can receive invitations without duplicate employees.
            imported=admin.expect(200,'/api/account-links',{'employee_id':1,'access':'manager'})
            guest.expect(200,'/api/account-links/redeem',redeem(imported))
            imported_manager=Client();login(imported_manager,'olivia@peopleos.demo')
            imported_manager.expect(403,'/api/employees',employee('Forged',password=password))
            assert 'Overview' in imported_manager.expect(200)
            admin.expect(200,'/api/employees',{'employee_id':worker_id,'manager_id':manager_id},'PATCH')
            # Simultaneous redemption succeeds once, and preserves manager scope and account role.
            one_use=admin.expect(200,'/api/account-links',target)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                outcomes=list(executor.map(lambda _:Client().request('/api/account-links/redeem',redeem(one_use,new_password))[0],range(2)))
            assert sorted(outcomes)==[200,400],outcomes
            with sqlite3.connect(database) as db:
                assert db.execute('SELECT manager_id FROM reporting_lines WHERE employee_id=?',(worker_id,)).fetchone()[0]==manager_id
                assert db.execute('SELECT access FROM accounts WHERE employee_id=?',(worker_id,)).fetchone()[0]=='employee'
                assert db.execute("SELECT COUNT(*) FROM employees WHERE email='invited@example.test'").fetchone()[0]==1
                assert db.execute("SELECT COUNT(*) FROM security_events WHERE action='Password changed'").fetchone()[0]==1
                assert db.execute("SELECT COUNT(*) FROM security_events WHERE action='Invitation accepted'").fetchone()[0]==2
                assert all(secret not in str(row) for row in db.execute('SELECT * FROM accounts') for secret in [password,new_password,reset_password])
                assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
            # Operator recovery handles the sole-admin case without replacing accounts.
            operator=subprocess.run(['node','scripts/recover-admin.mjs','admin@example.test',BASE],env={**os.environ,'HRIS_DATA_DIR':directory},capture_output=True,text=True,check=True)
            operator_link={'path':operator.stdout.strip().splitlines()[-1]}
            guest.expect(200,'/api/account-links/redeem',redeem(operator_link,reset_password))
            admin.expect(401,'/api/leaves',{})
            login(admin,'admin@example.test',reset_password)
            admin.expect(201,'/api/departments',{'name':'Admin access preserved'})
            print(f'PASS: {checks} account HTTP checks plus token hashing, expiry, revocation, replay/race protection, session invalidation and role preservation.')
        except Exception:
            log.seek(0);print(log.read()[-5000:]);raise
        finally:
            server.terminate();server.wait(timeout=10)
