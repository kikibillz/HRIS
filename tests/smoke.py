"""Production HTTP tests, isolated accounts, sessions, and SQLite storage."""
import datetime, http.cookiejar, json, os, secrets, sqlite3, subprocess, tempfile, time, urllib.request, urllib.error
BASE='http://127.0.0.1:3101'
checks=0
class Client:
    def __init__(self):
        self.jar=http.cookiejar.CookieJar()
        self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
    def request(self,path='/',body=None,method=None,origin=BASE,headers=None):
        req=urllib.request.Request(BASE+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Content-Type':'application/json','Origin':origin,**(headers or {})})
        try:
            with self.http.open(req,timeout=5) as r:return r.status,r.read().decode()
        except urllib.error.HTTPError as e:return e.code,e.read().decode()
    def expect(self,status,path='/',body=None,method=None,**kwargs):
        global checks
        actual,text=self.request(path,body,method,**kwargs)
        assert actual==status,f'{method or "GET"} {path}: expected {status}, got {actual}: {text[:200]}'
        checks+=1
        return text
password=secrets.token_urlsafe(24)
year=datetime.datetime.now(datetime.timezone.utc).year+1
monday=datetime.date(year,1,4)
while monday.weekday()!=0:monday+=datetime.timedelta(days=1)
def leave(start=monday,end=None,**extra):
    return {'type':'Annual leave','start':start.isoformat(),'end':(end or start+datetime.timedelta(days=2)).isoformat(),'reason':'Family break',**extra}
with tempfile.TemporaryDirectory(prefix='hris-smoke-') as directory:
    with open(os.path.join(directory,'server.log'),'w+') as log:
        server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3101'],env={**os.environ,'HRIS_DATA_DIR':directory,'HRIS_ALLOW_SETUP':'1'},stdout=log,stderr=log)
        try:
            guest,admin,employee,manager=Client(),Client(),Client(),Client()
            for _ in range(60):
                try:
                    if guest.request('/login')[0]==200:break
                except (OSError,TimeoutError):pass
                if server.poll() is not None:raise AssertionError('Server exited')
                time.sleep(.25)
            else:raise AssertionError('Server did not become ready')
            assert 'Olivia Rhye' not in guest.expect(200)
            guest.expect(401,'/api/leaves',leave())
            guest.expect(403,'/api/auth',{'action':'setup','name':'Admin','email':'admin@example.test','password':password},origin='https://untrusted.example')
            admin.expect(201,'/api/auth',{'action':'setup','name':'Admin','email':'admin@example.test','password':password})
            guest.expect(403,'/api/auth',{'action':'setup','name':'Intruder','email':'bad@example.test','password':password})
            assert 'A good day starts with your people.' in admin.expect(200)
            admin.expect(400,'/api/employees',{'name':'Bad email','email':'invalid'})
            for name,access in [('Worker','employee'),('Manager','manager')]:
                body={'name':name,'email':name.lower()+'@example.test','role':'Tester','department_id':1,'access':access,'password':password}
                admin.expect(201,'/api/employees',body)
            admin.expect(400,'/api/employees',body)
            employee.expect(200,'/api/auth',{'email':'worker@example.test','password':password})
            manager.expect(200,'/api/auth',{'email':'manager@example.test','password':password})
            # Verify both HTML and the serialized React payload, not just visible UI.
            for headers in ({}, {'RSC':'1'}):
                personal=employee.expect(200,headers=headers)
                assert 'Worker' in personal and 'worker@example.test' in personal
                if not headers:
                    assert 'My dashboard' in personal and 'My leave balance' in personal
                for private in ('Olivia Rhye','olivia@peopleos.demo','manager@example.test','admin@example.test','Quality Assurance','Employee directory','Total employees','Marketing','Finance','Design'):
                    assert private not in personal, f'Employee payload leaked {private}'
            assert 'manager@example.test' in manager.expect(200)
            manager.expect(403,'/api/employees',body)
            manager.expect(403,'/api/departments',{'name':'Forbidden'})
            guest.expect(401,'/api/employees',body)
            guest.expect(401,'/api/departments',{'name':'Forbidden'})
            employee.expect(403,'/api/employees',body)
            employee.expect(403,'/api/departments',{'name':'Forbidden'})
            admin.expect(201,'/api/departments',{'name':'Quality Assurance'})
            admin.expect(400,'/api/departments',{'name':'Quality Assurance'})
            employee.expect(403,'/api/leaves',leave(employee_id=1))
            employee.expect(400,'/api/leaves',leave(start=monday,end=monday-datetime.timedelta(days=1)))
            employee.expect(400,'/api/leaves',{**leave(),'start':f'{year}-02-30','end':f'{year}-03-02'})
            saturday=monday+datetime.timedelta(days=5)
            employee.expect(400,'/api/leaves',leave(saturday,saturday+datetime.timedelta(days=1)))
            employee.expect(400,'/api/leaves',{**leave(),'start':f'{year}-12-31','end':f'{year+1}-01-02'})
            employee.expect(201,'/api/leaves',leave()) # id 3
            employee.expect(409,'/api/leaves',leave())
            employee.expect(409,'/api/leaves',leave(monday+datetime.timedelta(days=28),monday+datetime.timedelta(days=55)))
            employee.expect(403,'/api/leaves',{'id':3,'status':'Approved','note':''},'PATCH')
            manager.expect(200,'/api/leaves',{'id':3,'status':'Approved','note':'Enjoy your break'},'PATCH')
            manager.expect(409,'/api/leaves',{'id':3,'status':'Declined','note':'Changed mind'},'PATCH')
            manager.expect(201,'/api/leaves',leave()) # id 4 manager own
            manager.expect(403,'/api/leaves',{'id':4,'status':'Approved','note':''},'PATCH')
            employee.expect(404,'/api/leaves',{'id':4,'status':'Cancelled','note':''},'PATCH')
            for request_id in (4, 999999):
                for status in ('Cancelled','Approved','Declined'):
                    text=employee.expect(404,'/api/leaves',{'id':request_id,'status':status,'note':'Forbidden'},'PATCH')
                    assert json.loads(text)=={'error':'Request not found.'}
            manager.expect(200,'/api/leaves',{'id':4,'status':'Cancelled','note':'Plans changed'},'PATCH')
            employee.expect(201,'/api/leaves',leave(monday+datetime.timedelta(days=7))) # id 5
            admin.expect(400,'/api/leaves',{'id':5,'status':'Declined','note':''},'PATCH')
            admin.expect(200,'/api/leaves',{'id':5,'status':'Declined','note':'Please choose another week'},'PATCH')
            employee.expect(201,'/api/leaves',leave(monday+datetime.timedelta(days=7))) # released reservation id 6
            employee.expect(200,'/api/leaves',{'id':6,'status':'Cancelled','note':''},'PATCH')
            _,html=employee.request()
            assert 'manager@example.test' not in html and 'olivia@peopleos.demo' not in html
            assert 'Enjoy your break' in html and 'Plans changed' not in html, 'Leave history must be scoped to requester'
            with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
                assert db.execute('SELECT status FROM leaves WHERE id=3').fetchone()[0]=='Approved'
                assert db.execute('SELECT COUNT(*) FROM leave_events WHERE leave_id=3').fetchone()[0]==2
                assert db.execute('SELECT COUNT(*) FROM employees').fetchone()[0]==11
                assert all(password not in row[0] for row in db.execute('SELECT password_hash FROM accounts'))
            admin.expect(200,'/api/auth',method='DELETE')
            admin.expect(401,'/api/leaves',leave())
            for _ in range(10):guest.expect(401,'/api/auth',{'email':'worker@example.test','password':'wrong-password-123'})
            guest.expect(429,'/api/auth',{'email':'worker@example.test','password':'wrong-password-123'})
            print(f'PASS: {checks} HTTP checks plus history privacy, hashed passwords, persisted decisions, and audit events.')
        except Exception:
            log.seek(0);print(log.read()[-6000:]);raise
        finally:
            server.terminate();server.wait(timeout=10)

