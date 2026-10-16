"""Two-company end-to-end API tests for the expanded HR suite. Disposable DB/port 3105."""
import concurrent.futures, http.cookiejar, json, os, secrets, sqlite3, subprocess, tempfile, time, urllib.request, urllib.error
BASE='http://127.0.0.1:3105';checks=0;password=secrets.token_urlsafe(24)
class Client:
 def __init__(self):self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def request(self,path='/',body=None,method=None,origin=BASE,raw=None,content='application/json'):
  req=urllib.request.Request(BASE+path,data=raw if raw is not None else None if body is None else json.dumps(body).encode(),method=method,headers={'Origin':origin,'Content-Type':content})
  try:r=self.http.open(req,timeout=15)
  except urllib.error.HTTPError as e:r=e
  with r:
   text=r.read();return r.status,json.loads(text) if r.headers.get('Content-Type','').startswith('application/json') else text.decode(errors='replace')
 def expect(self,status,path='/',body=None,method=None,**kw):
  global checks
  actual,data=self.request(path,body,method,**kw);assert actual==status,f'{method or "GET"} {path} expected {status}, got {actual}: {str(data)[:300]}';checks+=1;return data
 def upload(self,target=None,name='proof.txt',text='private document'):
  boundary='hris-'+secrets.token_hex(8);parts=[]
  if target is not None:parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="employee_id"\r\n\r\n{target}\r\n')
  parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: text/plain\r\n\r\n{text}\r\n--{boundary}--\r\n')
  return self.expect(201,'/api/documents',method='POST',raw=''.join(parts).encode(),content='multipart/form-data; boundary='+boundary)
def signup(c,name,email):c.expect(201,'/api/companies',{'company':name,'name':name+' Admin','email':email,'password':password})
def login(c,email):c.expect(200,'/api/auth',{'email':email,'password':password})
def create(c,name,email,access='employee',department=1):c.expect(201,'/api/employees',{'name':name,'email':email,'role':'Engineer','department_id':department,'access':access,'password':password})
def records(c,kind,body):return c.expect(201,'/api/records/'+kind,body)['id']
with tempfile.TemporaryDirectory(prefix='hris-platform-') as directory:
 with open(os.path.join(directory,'server.log'),'w+') as log:
  server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3105'],env={**os.environ,'HRIS_DATA_DIR':directory,'AI_GATEWAY_API_KEY':'not-a-real-test-key','AI_GATEWAY_MODEL':'test-model-disabled','AI_ENABLED_COMPANY_IDS':''},stdout=log,stderr=log)
  try:
   guest,a,b,worker,peer,manager=Client(),Client(),Client(),Client(),Client(),Client()
   for _ in range(80):
    try:
     if guest.request('/login')[0]==200:break
    except OSError:pass
    time.sleep(.25)
   guest.expect(403,'/api/companies',{'company':'Forged','name':'No','email':'forged@example.test','password':password},origin='https://untrusted.example')
   signup(a,'Alpha','alpha-admin@example.test');signup(b,'Beta','beta-admin@example.test')
   ca=a.expect(200,'/api/operations');assert ca['ai_configured'] is False;cb=b.expect(200,'/api/operations');aid=ca['user']['employee_id'];bid=cb['user']['employee_id'];assert ca['user']['company_id']!=cb['user']['company_id']
   assert 'olivia@peopleos.demo' not in a.expect(200)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    dept_a=db.execute('SELECT department_id FROM company_departments WHERE company_id=?',(ca['user']['company_id'],)).fetchone()[0]
    dept_b=db.execute('SELECT department_id FROM company_departments WHERE company_id=?',(cb['user']['company_id'],)).fetchone()[0]
   create(a,'Alpha Worker','alpha-worker@example.test',department=dept_a);create(a,'Alpha Peer','alpha-peer@example.test',department=dept_a);create(a,'Alpha Manager','alpha-manager@example.test','manager',dept_a)
   for person in a.expect(200,'/api/operations')['employees']:
    if person['email']!='alpha-admin@example.test':a.expect(200,'/api/people',{'employee_id':person['id'],'name':person['name'],'role':person['role'],'joined':'2026-10-01','status':'Active'},'PATCH')
   login(worker,'alpha-worker@example.test');login(peer,'alpha-peer@example.test');login(manager,'alpha-manager@example.test')
   people=a.expect(200,'/api/operations')['employees'];wid=next(p['id'] for p in people if p['email']=='alpha-worker@example.test');pid=next(p['id'] for p in people if p['email']=='alpha-peer@example.test');mid=next(p['id'] for p in people if p['email']=='alpha-manager@example.test')
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:manager_account=db.execute('SELECT id FROM accounts WHERE employee_id=?',(mid,)).fetchone()[0]
   for c in [guest,worker,manager]:c.expect(401 if c is guest else 403,'/api/import',{'csv':'name,email\nBad,bad@example.test','action':'commit'})
   a.expect(400,'/api/employees',{'name':'Foreign department','email':'foreign@example.test','role':'Test','department_id':dept_b,'password':password,'access':'employee'})
   for method in ['POST','DELETE']:a.expect(404,'/api/account-links',{'employee_id':bid},method)
   a.expect(404,'/api/employees',{'employee_id':bid,'manager_id':manager_account},'PATCH')
   a.expect(400,'/api/employees',{'employee_id':wid,'manager_id':cb['user']['id']},'PATCH')
   a.expect(200,'/api/employees',{'employee_id':wid,'manager_id':manager_account},'PATCH')
   csv='name,email,role,department,joined,basic,pension,nhf\nImported Alpha,imported-alpha@example.test,Analyst,Finance,2026-10-01,100000,true,false\n'
   a.expect(400,'/api/import',{'csv':'name,email,email,role,department\nA,a@example.test,b@example.test,Engineer,General','action':'preview'})
   preview=a.expect(200,'/api/import',{'csv':csv,'action':'preview'});assert not preview['errors'] and preview['count']==1
   a.expect(200,'/api/import',{'csv':csv,'action':'commit'});a.expect(400,'/api/import',{'csv':csv,'action':'commit'})
   bad='name,email,role,department\nShould rollback,new-alpha@example.test,Engineer,General\nBad,bad,Engineer,General\n';a.expect(400,'/api/import',{'csv':bad,'action':'commit'})
   assert 'new-alpha@example.test' not in str(a.expect(200,'/api/operations'))
   assert 'imported-alpha@example.test' not in str(b.expect(200,'/api/operations'))
   guest.expect(401,'/api/attendance');worker.expect(200,'/api/attendance',{'action':'in','employee_id':bid});worker.expect(409,'/api/attendance',{'action':'in'});worker.expect(200,'/api/attendance',{'action':'out'});worker.expect(409,'/api/attendance',{'action':'out'})
   assert len(manager.expect(200,'/api/attendance')['rows'])==1 and not b.expect(200,'/api/attendance')['rows']
   peer.expect(200,'/api/attendance',{'action':'in'});assert len(manager.expect(200,'/api/attendance')['rows'])==1
   a.upload(wid);doc=a.expect(200,'/api/documents')['rows'][0]['id'];assert worker.expect(200,f'/api/documents/{doc}')=='private document'
   for c in [b,peer,manager]:c.expect(404,f'/api/documents/{doc}')
   a.upload(None,name='handbook.txt',text='Alpha company guide');assert len(worker.expect(200,'/api/documents')['rows'])==2;assert len(peer.expect(200,'/api/documents')['rows'])==1
   b.expect(404,f'/api/documents/{doc}',{},'DELETE');worker.expect(403,f'/api/documents/{doc}',{},'DELETE')
   job=records(a,'jobs',{'title':'Engineer vacancy','body':'Alpha hiring','status':'Open'});candidate=records(a,'applicants',{'title':'Candidate Example','email':'candidate@example.test','reference_id':job,'status':'Applied'})
   a.expect(200,'/api/records/applicants',{'id':candidate,'status':'Interview'},'PATCH');assert a.expect(200,'/api/records/applicants')['rows'][0]['status']=='Interview'
   assert not b.expect(200,'/api/records/applicants')['rows'];worker.expect(400,'/api/records/jobs',{'title':'Forbidden'})
   b.expect(400,'/api/records/applicants',{'title':'Foreign applicant','email':'foreign@example.test','reference_id':job})
   goal=records(worker,'goals',{'title':'Ship project','employee_id':wid,'body':'Deliver milestone','progress':25});worker.expect(200,'/api/records/goals',{'id':goal,'status':'Completed'},'PATCH');assert worker.expect(200,'/api/records/goals')['rows'][0]['progress']==100
   worker.expect(400,'/api/records/goals',{'title':'Foreign goal','employee_id':bid});peer.expect(400,'/api/records/goals',{'id':goal,'progress':0},'PATCH')
   review=records(a,'reviews',{'title':'Quarterly review','employee_id':wid,'reviewer_id':mid,'status':'Draft'});assert not worker.expect(200,'/api/records/reviews')['rows'];assert len(manager.expect(200,'/api/records/reviews')['rows'])==1
   manager.expect(400,'/api/records/reviews',{'id':review,'status':'Published','rating':5,'body':'Excellent'},'PATCH');manager.expect(200,'/api/records/reviews',{'id':review,'status':'Submitted','rating':5,'body':'Excellent'},'PATCH');a.expect(200,'/api/records/reviews',{'id':review,'status':'Published'},'PATCH');assert worker.expect(200,'/api/records/reviews')['rows'][0]['body']=='Excellent'
   feedback=records(worker,'feedback',{'title':'Peer feedback','employee_id':wid,'reviewer_id':pid});assert not worker.expect(200,'/api/records/feedback')['rows'];peer.expect(200,'/api/records/feedback',{'id':feedback,'rating':4,'body':'Strong collaboration','status':'Submitted'},'PATCH');assert worker.expect(200,'/api/records/feedback')['rows'][0]['body']=='Strong collaboration'
   course=records(a,'courses',{'title':'Security basics','body':'Never share passwords.','quiz_question':'What must you never share?','quiz_answer':'passwords'});assert 'quiz_answer' not in worker.expect(200,'/api/records/courses')['rows'][0]['data']
   learning=records(worker,'enrollments',{'title':'Security induction','employee_id':wid,'reference_id':course});worker.expect(400,'/api/records/enrollments',{'id':learning,'status':'Completed','quiz_answer':'nothing'},'PATCH');worker.expect(200,'/api/records/enrollments',{'id':learning,'status':'Completed','quiz_answer':'passwords'},'PATCH')
   task=records(a,'tasks',{'title':'Read handbook','employee_id':wid,'due':'2026-10-30'});worker.expect(200,'/api/records/tasks',{'id':task,'status':'Done'},'PATCH')
   template=records(a,'templates',{'title':'Welcome letter','body':'Welcome {{employee_name}} to {{company_name}} as {{role}} on {{start_date}}.'});letter=records(a,'letters',{'title':'Employment letter','employee_id':wid,'reference_id':template});assert 'Welcome Alpha Worker to Alpha' in worker.expect(200,'/api/records/letters')['rows'][0]['body'];assert not b.expect(200,'/api/records/letters')['rows'];assert not manager.expect(200,'/api/records/letters')['rows']
   policy=records(a,'policies',{'title':'Remote working','body':'Remote working requires manager approval.','status':'Published'});result=worker.expect(200,'/api/policy-assistant',{'question':'remote working approval'});assert result['sources'][0]['title']=='Remote working' and result['mode']=='Policy search';assert not b.expect(200,'/api/policy-assistant',{'question':'remote working approval'})['sources']
   for kind,record_id in [('jobs',job),('applicants',candidate),('goals',goal),('reviews',review),('feedback',feedback),('courses',course),('enrollments',learning),('tasks',task),('templates',template),('letters',letter),('policies',policy)]:
    assert not b.expect(200,'/api/records/'+kind)['rows']
    b.expect(400,'/api/records/'+kind,{'id':record_id,'title':'Foreign mutation'},'PATCH')
   a.expect(200,'/api/notifications',{'employee_id':wid,'title':'Welcome','body':'Review your onboarding tasks.'});worker.expect(200,'/api/notifications',{'id':worker.expect(200,'/api/notifications')['rows'][0]['id']},'PATCH');a.expect(400,'/api/notifications',{'employee_id':bid,'title':'Foreign','body':'Denied'})
   a.expect(404,'/api/payroll',{'action':'salary','employee_id':bid,'basic':'100000'})
   people=a.expect(200,'/api/operations')['employees']
   for person in people:
    salary={'basic':'0','excluded':True} if person['id'] in [aid,mid] else {'basic':'200000','housing':'100000','transport':'50000','annual_rent':'1200000','nhf':True} if person['id']==wid else {'basic':'100000'}
    a.expect(200,'/api/payroll',{'action':'salary','employee_id':person['id'],**salary})
   cases=json.load(open('public/payroll-reference-cases.json'));assert a.expect(200,'/api/payroll',{'action':'compare','cases':cases})['all_passed'];cases[0]['expected']['net']+=1;assert not a.expect(200,'/api/payroll',{'action':'compare','cases':cases})['all_passed']
   a.expect(400,'/api/payroll',{'action':'draft','period':'2025-12'});
   a.expect(200,'/api/payroll',{'action':'draft','period':'2026-10'});run=a.expect(200,'/api/payroll')['runs'][0]['id'];assert not worker.expect(200,'/api/payroll')['items'];b.expect(400,'/api/payroll',{'action':'approve','run_id':run,'reviewed':True})
   a.expect(400,'/api/payroll',{'action':'approve','run_id':run});a.expect(200,'/api/payroll',{'action':'approve','run_id':run,'reviewed':True});slips=worker.expect(200,'/api/payroll')['items'];assert len(slips)==1 and json.loads(slips[0]['details'])['paye']==3596000
   assert not manager.expect(200,'/api/payroll')['items'] and not b.expect(200,'/api/payroll')['items']
   worker.expect(403,'/api/payroll',{'action':'draft','period':'2026-11'});manager.expect(403,'/api/reports?type=payroll')
   a.expect(200,'/api/payroll',{'action':'record_payment','run_id':run,'reference':'BANK-TEST-001'});a.expect(400,'/api/payroll',{'action':'record_payment','run_id':run,'reference':'DUPLICATE'})
   a.expect(400,'/api/reports?type=payroll&run_id=bad');assert b.expect(200,f'/api/reports?type=payroll&run_id={run}')==''
   export=a.expect(200,f'/api/reports?type=payroll&run_id={run}');assert 'Alpha Worker' in export and 'beta-admin' not in export
   a.expect(200,'/api/people',{'employee_id':wid,'name':'Alpha Worker Renamed','role':'Engineer','joined':'2026-10-01','status':'Active'},'PATCH');login(worker,'alpha-worker@example.test')
   assert worker.expect(200,'/api/payroll')['items'][0]['name']=='Alpha Worker'
   assert 'Alpha Worker Renamed' not in a.expect(200,f'/api/reports?type=payroll&run_id={run}')
   analytics=a.expect(200,'/api/reports');assert 0<=analytics['first_payroll_hours']<24 and analytics['funnel'][0]['status']=='Interview';assert b.expect(200,'/api/reports')['first_payroll_hours'] is None
   audit=a.expect(200,'/api/reports?type=audit');assert any(x['action']=='Payroll approved' for x in audit['rows'])
   a.expect(400,'/api/people',{'employee_id':bid,'name':'Foreign','role':'No','joined':'2026-01-01','status':'Active'},'PATCH');a.expect(200,'/api/people',{'employee_id':pid,'name':'Alpha Peer','role':'Engineer','joined':'2026-10-16','status':'Inactive','access':'employee'},'PATCH');peer.expect(401,'/api/leaves',{});peer.expect(401,'/api/auth',{'email':'alpha-peer@example.test','password':password})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
   print(f'PASS: {checks} platform HTTP checks across two companies; import, private documents, attendance, payroll, payment records, recruiting, reviews, feedback, learning, onboarding, letters, policy search, analytics, audit and deactivation.')
  except Exception:
   log.seek(0);print(log.read()[-7000:]);raise
  finally:server.terminate();server.wait(timeout=10)
