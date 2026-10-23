"""Two-company end-to-end API tests for the expanded HR suite. Disposable DB/port 3105."""
import concurrent.futures, hashlib, csv as csv_module, io, http.cookiejar, json, os, secrets, sqlite3, subprocess, tempfile, time, urllib.request, urllib.error
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
   guest.expect(401,'/api/launch')
   for period in ['2026-13','2025-01','2026-1','']:
    a.expect(400,'/api/launch?period='+period)
   launch=a.expect(200,'/api/launch?period=2026-10');assert launch['completed']==1 and launch['next']=='compensation' and len(launch['missing_compensation'])==1
   assert 'alpha' not in str(b.expect(200,'/api/launch?period=2026-10&company_id='+str(ca['user']['company_id']))).lower()

   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    dept_a=db.execute('SELECT department_id FROM company_departments WHERE company_id=?',(ca['user']['company_id'],)).fetchone()[0]
    dept_b=db.execute('SELECT department_id FROM company_departments WHERE company_id=?',(cb['user']['company_id'],)).fetchone()[0]
   create(a,'Alpha Worker','alpha-worker@example.test',department=dept_a);create(a,'Alpha Peer','alpha-peer@example.test',department=dept_a);create(a,'Alpha Manager','alpha-manager@example.test','manager',dept_a)
   for person in a.expect(200,'/api/operations')['employees']:
    if person['email']!='alpha-admin@example.test':a.expect(200,'/api/people',{'employee_id':person['id'],'name':person['name'],'role':person['role'],'joined':'2026-10-01','status':'Active'},'PATCH')
   login(worker,'alpha-worker@example.test');login(peer,'alpha-peer@example.test');login(manager,'alpha-manager@example.test')
   for c in [worker,manager]:c.expect(403,'/api/launch?period=2026-10')
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
   # Reusable onboarding templates: atomic bulk writes, retry safety and existing task permissions.
   guest.expect(401,'/api/onboarding')
   for c in [worker,manager]:
    c.expect(403,'/api/onboarding');c.expect(403,'/api/onboarding',{'action':'create','title':'Denied','items':[]})
   onboarding={'action':'create','title':'New starter pack','items':[{'title':'Preboarding paperwork','body':'Bring identity documents','days':-1},{'title':'Read team handbook','body':'Ask your manager about policies','days':0}]}
   a.expect(403,'/api/onboarding',onboarding,origin='https://untrusted.example')
   a.expect(400,'/api/onboarding',{**onboarding,'items':[]})
   a.expect(400,'/api/onboarding',{**onboarding,'items':[{'title':'Invalid','body':'','days':366}]})
   tid=a.expect(201,'/api/onboarding',onboarding)['id']
   assert b.expect(200,'/api/onboarding')['templates']==[]
   batch={'action':'assign','template_id':tid,'employee_ids':[wid,pid],'start_date':'2026-03-01'}
   b.expect(400,'/api/onboarding',batch)
   a.expect(400,'/api/onboarding',{**batch,'employee_ids':[wid,bid]})
   a.expect(400,'/api/onboarding',{**batch,'start_date':'2026-02-30'})
   a.expect(400,'/api/onboarding',{**batch,'employee_ids':[]})
   assert not a.expect(200,'/api/onboarding')['assignments']
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(lambda _:a.expect(200,'/api/onboarding',batch),range(2)))
   assert sum(x['created'] for x in results)==2 and sum(x['skipped'] for x in results)==2 and sum(x['tasks_created'] for x in results)==4
   assigned=worker.expect(200,'/api/records/tasks')['rows'];assert len(assigned)==2 and {x['due'] for x in assigned}=={'2026-02-28','2026-03-01'}
   worker.expect(400,'/api/records/tasks',{'title':'Injected task','employee_id':wid,'reference_id':assigned[0]['reference_id']})
   assert len(manager.expect(200,'/api/records/tasks')['rows'])==2 and len(peer.expect(200,'/api/records/tasks')['rows'])==2 and not b.expect(200,'/api/records/tasks')['rows']
   worker.expect(200,'/api/records/tasks',{'id':assigned[0]['id'],'status':'Done'},'PATCH')
   worker_assignment=next(x for x in a.expect(200,'/api/onboarding')['assignments'] if x['name']=='Alpha Worker');assert worker_assignment['completed']==1 and worker_assignment['total']==2
   # Completion edits cannot erase the server-owned assignment identity.
   assert a.expect(200,'/api/onboarding',batch)['tasks_created']==0
   a.expect(200,'/api/onboarding',{'action':'archive','template_id':tid})
   a.expect(400,'/api/onboarding',{**batch,'start_date':'2026-04-01'})
   assert len(worker.expect(200,'/api/records/tasks')['rows'])==2
   # Overdue progress is server-scoped; daily in-app reminders are atomic and idempotent.
   guest.expect(401,'/api/onboarding-progress');worker.expect(403,'/api/onboarding-progress')
   worker.expect(403,'/api/onboarding-progress',{'action':'remind','assignment_id':worker_assignment['id']})
   progress=manager.expect(200,'/api/onboarding-progress');assert len(progress['assignments'])==1 and progress['assignments'][0]['employee_id']==wid and progress['assignments'][0]['overdue']==1
   assert not b.expect(200,'/api/onboarding-progress?company_id='+str(ca['user']['company_id']))['assignments']
   peer_assignment=next(x for x in a.expect(200,'/api/onboarding-progress')['assignments'] if x['employee_id']==pid)
   manager.expect(404,'/api/onboarding-progress',{'action':'remind','assignment_id':peer_assignment['id']})
   b.expect(404,'/api/onboarding-progress',{'action':'remind','assignment_id':worker_assignment['id']})
   reminder={'action':'remind','assignment_id':worker_assignment['id']}
   manager.expect(403,'/api/onboarding-progress',reminder,origin='https://untrusted.example')
   before=len(worker.expect(200,'/api/notifications')['rows'])
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:sent=list(pool.map(lambda c:c.expect(200,'/api/onboarding-progress',reminder),[manager,a]))
   assert sum(x['sent'] for x in sent)==1 and len(worker.expect(200,'/api/notifications')['rows'])==before+1
   assert not manager.expect(200,'/api/onboarding-progress',reminder)['sent']
   # Reassignment immediately removes the previous manager's access.
   a.expect(200,'/api/employees',{'employee_id':wid,'manager_id':None},'PATCH')
   assert not manager.expect(200,'/api/onboarding-progress')['assignments']
   manager.expect(404,'/api/onboarding-progress',reminder)
   a.expect(200,'/api/employees',{'employee_id':wid,'manager_id':manager_account},'PATCH')
   # Today/future due dates and completed items must never trigger reminders.
   today=progress['today']
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE hr_records SET due=? WHERE kind='tasks' AND reference_id=? AND status='Open'",(today,peer_assignment['id']))
   assert not a.expect(200,'/api/onboarding-progress',{'action':'remind','assignment_id':peer_assignment['id']})['sent']
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE hr_records SET status='Done' WHERE kind='tasks' AND reference_id=?",(worker_assignment['id'],))
   assert manager.expect(200,'/api/onboarding-progress')['assignments'][0]['overdue']==0
   # The automatic worker is opt-in, company-scoped, restart-safe and shares manual keys.
   guest.expect(401,'/api/reminder-automation')
   for c in [worker,manager]:
    c.expect(403,'/api/reminder-automation');c.expect(403,'/api/reminder-automation',{'enabled':True,'hour':0})
   assert a.expect(200,'/api/reminder-automation')['settings']['enabled']==0
   a.expect(400,'/api/reminder-automation',{'enabled':True,'hour':24})
   a.expect(403,'/api/reminder-automation',{'enabled':True,'hour':0},origin='https://untrusted.example')
   def tick():
    result=subprocess.run(['node','scripts/onboarding-reminders.mjs','--once'],env={**os.environ,'HRIS_DATA_DIR':directory},capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr
   tick();assert not a.expect(200,'/api/reminder-automation')['runs']
   auto_template=a.expect(201,'/api/onboarding',{**onboarding,'title':'Automatic reminder test','items':[{'title':'Finish welcome pack','body':'Read the guide','days':0}]})['id']
   a.expect(200,'/api/onboarding',{'action':'assign','template_id':auto_template,'employee_ids':[wid,pid],'start_date':'2026-03-01'})
   auto_rows=a.expect(200,'/api/onboarding-progress')['assignments'];auto_worker=next(x for x in auto_rows if x['title']=='Automatic reminder test' and x['employee_id']==wid);auto_peer=next(x for x in auto_rows if x['title']=='Automatic reminder test' and x['employee_id']==pid)
   assert a.expect(200,'/api/onboarding-progress',{'action':'remind','assignment_id':auto_worker['id']})['sent']
   a.expect(200,'/api/reminder-automation',{'enabled':True,'hour':0})
   before_peer=len(peer.expect(200,'/api/notifications')['rows'])
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(lambda _:tick(),range(2)))
   monitor=a.expect(200,'/api/reminder-automation');assert monitor['worker']['healthy'] and len(monitor['runs'])==1 and monitor['runs'][0]['status']=='Completed' and monitor['runs'][0]['sent']==1
   assert {x['source'] for x in monitor['deliveries']}=={'manual','automatic'}
   assert len(peer.expect(200,'/api/notifications')['rows'])==before_peer+1
   assert not a.expect(200,'/api/onboarding-progress',{'action':'remind','assignment_id':auto_peer['id']})['sent']
   tick();assert len(peer.expect(200,'/api/notifications')['rows'])==before_peer+1
   assert not b.expect(200,'/api/reminder-automation')['runs'] and not b.expect(200,'/api/reminder-automation')['deliveries']
   notification=peer.expect(200,'/api/notifications')['rows'][0]['id'];peer.expect(200,'/api/notifications',{'id':notification},'PATCH')
   assert any(x['source']=='automatic' and x['read_at'] for x in a.expect(200,'/api/reminder-automation')['deliveries'])
   a.expect(200,'/api/reminder-automation',{'enabled':False,'hour':9})
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
   # Period inputs remain administrator-only and company-isolated, including reads.
   period_body={'action':'adjustment','employee_id':wid,'period':'2026-11','bonus':'50000','one_off_deduction':'5000','reviewed_paye':'12000','review_note':'Fixture PAYE review reference'}
   for c in [guest,worker,manager]:c.expect(401 if c is guest else 403,'/api/payroll',period_body)
   a.expect(403,'/api/payroll',period_body,origin='https://untrusted.example')
   b.expect(404,'/api/payroll',period_body)
   a.expect(400,'/api/payroll',{**period_body,'period':'2026-13'})
   a.expect(400,'/api/payroll',{**period_body,'review_note':''})
   a.expect(400,'/api/payroll',{**period_body,'pensionable_bonus':'50001'})
   a.expect(400,'/api/payroll',{**period_body,'period':'2026-10'})
   a.expect(400,'/api/payroll',{**period_body,'action':'clear_adjustment','period':'2026-10'})
   a.expect(200,'/api/people',{'employee_id':wid,'name':'Alpha Worker Renamed','role':'Engineer','joined':'2026-11-16','status':'Active'},'PATCH')
   login(worker,'alpha-worker@example.test')
   a.expect(400,'/api/payroll',{'action':'draft','period':'2026-11'})
   assert all(r['period']!='2026-11' for r in a.expect(200,'/api/payroll')['runs'])
   a.expect(200,'/api/payroll',period_body)
   assert not worker.expect(200,'/api/payroll')['adjustments'] and not manager.expect(200,'/api/payroll')['adjustments'] and not b.expect(200,'/api/payroll')['adjustments']
   assert a.expect(200,'/api/payroll')['adjustments'][0]['employee_id']==wid
   variable_cases=json.load(open('public/payroll-period-cases.json'))
   assert a.expect(200,'/api/payroll',{'action':'compare','cases':variable_cases})['all_passed']
   a.expect(200,'/api/payroll',{'action':'draft','period':'2026-11'})
   november=a.expect(200,'/api/payroll');novrun=next(r['id'] for r in november['runs'] if r['period']=='2026-11')
   a.expect(400,'/api/payroll',{**period_body,'bonus':'1'})
   a.expect(400,'/api/payroll',{**period_body,'action':'clear_adjustment'})
   a.expect(200,'/api/payroll',{'action':'discard','run_id':novrun})
   a.expect(200,'/api/payroll',{**period_body,'action':'clear_adjustment'})
   assert not a.expect(200,'/api/payroll')['adjustments']
   a.expect(200,'/api/payroll',period_body)
   a.expect(200,'/api/payroll',{'action':'draft','period':'2026-11'})
   november=a.expect(200,'/api/payroll');novrun=next(r['id'] for r in november['runs'] if r['period']=='2026-11')
   original=next(i['details'] for i in november['items'] if i['run_id']==novrun and i['employee_id']==wid);detail=json.loads(original)
   assert detail['proration']['paid_days']==15 and detail['proration']['days']==30 and detail['gross']==22500000 and detail['paye']==1200000
   assert detail['earnings']['bonus']==5000000 and detail['other_deductions']==500000 and detail['adjustment']['review_note']=='Fixture PAYE review reference'
   assert len(worker.expect(200,'/api/payroll')['items'])==1
   a.expect(200,'/api/payroll',{'action':'approve','run_id':novrun,'reviewed':True})
   a.expect(400,'/api/payroll',period_body)
   a.expect(400,'/api/payroll',{'action':'discard','run_id':novrun})
   a.expect(200,'/api/payroll',{'action':'salary','employee_id':wid,'basic':'999999'})
   assert next(i['details'] for i in worker.expect(200,'/api/payroll')['items'] if i['run_id']==novrun)==original
   exported=list(csv_module.DictReader(io.StringIO(a.expect(200,f'/api/reports?type=payroll&run_id={novrun}'))))
   assert next(r for r in exported if r['name']=='Alpha Worker Renamed')['gross_kobo']=='22500000'
   launch=a.expect(200,'/api/launch?period=2026-11');assert next(x for x in launch['steps'] if x['id']=='release')['complete'] and not next(x for x in launch['steps'] if x['id']=='review')['complete']
   a.expect(200,'/api/payroll',{'action':'record_review','run_id':novrun,'reviewed_by':'Test accountant','reference':'TEST-REVIEW','confirmed':True})
   assert next(x for x in a.expect(200,'/api/launch?period=2026-11')['steps'] if x['id']=='review')['complete']
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    original_hash=db.execute('SELECT snapshot_hash FROM payroll_reviews WHERE run_id=?',(novrun,)).fetchone()[0]
    db.execute("UPDATE payroll_reviews SET snapshot_hash='invalid' WHERE run_id=?",(novrun,))
   assert not next(x for x in a.expect(200,'/api/launch?period=2026-11')['steps'] if x['id']=='review')['complete']
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute('UPDATE payroll_reviews SET snapshot_hash=? WHERE run_id=?',(original_hash,novrun))
   analytics=a.expect(200,'/api/reports');assert 0<=analytics['first_payroll_hours']<24 and analytics['funnel'][0]['status']=='Interview';assert b.expect(200,'/api/reports')['first_payroll_hours'] is None
   audit=a.expect(200,'/api/reports?type=audit');assert any(x['action']=='Payroll approved' for x in audit['rows'])
   # Performance cycles preserve private drafts and atomically assign whole batches.
   guest.expect(401,'/api/performance')
   for client in [worker,manager]:
    client.expect(403,'/api/performance')
    client.expect(403,'/api/performance',{'action':'create'})
   cycle_body={'action':'create','title':'Year end cycle','start':'2026-10-01','due':'2026-12-31'}
   a.expect(400,'/api/performance',{**cycle_body,'start':'2026-02-30'})
   a.expect(400,'/api/performance',{**cycle_body,'due':'2026-01-01'})
   cycle=a.expect(200,'/api/performance',cycle_body)['id']
   batch={'action':'assign','cycle_id':cycle,'reviewer_id':mid,'employee_ids':[wid,pid]}
   b.expect(400,'/api/performance',batch)
   a.expect(400,'/api/performance',{**batch,'employee_ids':[wid,bid]})
   assert a.expect(200,'/api/performance')['cycles'][0]['assigned']==0
   a.expect(400,'/api/performance',{**batch,'employee_ids':[mid]})
   a.expect(400,'/api/performance',{**batch,'reviewer_id':bid})
   a.expect(400,'/api/performance',{**batch,'employee_ids':[]})
   result=a.expect(200,'/api/performance',batch);assert result['assigned']==2 and result['skipped']==0
   result=a.expect(200,'/api/performance',batch);assert result['assigned']==0 and result['skipped']==2
   assert not [r for r in worker.expect(200,'/api/records/reviews')['rows'] if r['title']=='Year end cycle']
   assert not [r for r in b.expect(200,'/api/records/reviews')['rows'] if r['title']=='Year end cycle']
   reminder={'action':'remind','cycle_id':cycle}
   guest.expect(401,'/api/performance',reminder)
   for client in [worker,manager]:client.expect(403,'/api/performance',reminder)
   b.expect(400,'/api/performance',reminder)
   a.expect(403,'/api/performance',reminder,origin='https://untrusted.example')
   future=a.expect(200,'/api/performance',{**cycle_body,'start':'2099-01-01','due':'2099-12-31'})['id']
   a.expect(400,'/api/performance',{'action':'remind','cycle_id':future})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    db.execute("UPDATE hr_records SET due='2000-01-01' WHERE id IN (SELECT record_id FROM performance_assignments WHERE cycle_id=?)",(cycle,))
    db.execute("CREATE TRIGGER reject_review_reminder BEFORE INSERT ON performance_reminders WHEN (SELECT COUNT(*) FROM performance_reminders)>0 BEGIN SELECT RAISE(ABORT,'fixture delivery failure'); END")
   cycle_data=next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==cycle)
   assert cycle_data['overdue']==2 and cycle_data['pending']==2 and all('body' not in row and 'rating' not in row for row in cycle_data['assignments'])
   before_manager=len(manager.expect(200,'/api/notifications')['rows']);before_worker=len(worker.expect(200,'/api/notifications')['rows'])
   a.expect(400,'/api/performance',reminder)
   assert len(manager.expect(200,'/api/notifications')['rows'])==before_manager
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT COUNT(*) FROM performance_reminders').fetchone()[0]==0
    db.execute('DROP TRIGGER reject_review_reminder')
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE employees SET status='Inactive' WHERE id=?",(mid,))
   assert a.expect(200,'/api/performance',reminder)['sent']==0
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    db.execute("UPDATE employees SET status='Active' WHERE id=?",(mid,))
    db.execute("UPDATE employees SET status='Inactive' WHERE id IN (?,?)",(wid,pid))
   assert a.expect(200,'/api/performance',reminder)['sent']==0
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE employees SET status='Active' WHERE id IN (?,?)",(wid,pid))
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:deliveries=list(pool.map(lambda _:a.expect(200,'/api/performance',reminder),range(2)))
   assert sum(d['sent'] for d in deliveries)==2 and sum(d['skipped'] for d in deliveries)==2
   assert len(manager.expect(200,'/api/notifications')['rows'])==before_manager+2
   assert len(worker.expect(200,'/api/notifications')['rows'])==before_worker
   assert a.expect(200,'/api/performance',reminder)['sent']==0
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT COUNT(*) FROM performance_reminders').fetchone()[0]==2
    db.execute("UPDATE performance_reminders SET day='2000-01-01'")
   first=cycle_data['assignments'][0]['id']
   manager.expect(200,'/api/records/reviews',{'id':first,'rating':4,'body':'Submitted before reminder','status':'Submitted'},'PATCH')
   assert a.expect(200,'/api/performance',reminder)['sent']==1
   cycle_data=next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==cycle)
   assert cycle_data['overdue']==1 and cycle_data['submitted']==1
   a.expect(400,'/api/performance',{'action':'close','cycle_id':cycle})
   assigned=[r for r in manager.expect(200,'/api/records/reviews')['rows'] if r['title']=='Year end cycle'];assert len(assigned)==2
   for row in assigned:
    manager.expect(400,'/api/records/reviews',{'id':row['id'],'rating':4,'body':'Cycle response','status':'Published'},'PATCH')
    manager.expect(200,'/api/records/reviews',{'id':row['id'],'rating':4,'body':'Cycle response','status':'Submitted'},'PATCH')
    a.expect(200,'/api/records/reviews',{'id':row['id'],'status':'Published'},'PATCH')
   assert next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==cycle)['published']==2
   a.expect(200,'/api/performance',{'action':'close','cycle_id':cycle})
   a.expect(400,'/api/performance',batch)
   a.expect(400,'/api/performance',reminder)
   for row in assigned:
    a.expect(400,'/api/records/reviews',{'id':row['id'],'body':'Overwrite final'},'PATCH')
   assert len([r for r in worker.expect(200,'/api/records/reviews')['rows'] if r['title']=='Year end cycle'])==1
   # Reviewer handoff preserves responses and revokes previous reviewer access.
   handoff=a.expect(200,'/api/performance',{**cycle_body,'title':'Reviewer handoff'})['id']
   a.expect(200,'/api/performance',{'action':'assign','cycle_id':handoff,'reviewer_id':mid,'employee_ids':[wid]})
   def handoff_row():return next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==handoff)['assignments'][0]
   initial=handoff_row();rid=initial['id']
   transfer={'action':'reassign','cycle_id':handoff,'record_id':rid,'reviewer_id':pid,'reason':'Reviewer changed teams','revision':initial['revision']}
   guest.expect(401,'/api/performance',transfer)
   for client in [worker,peer,manager]:client.expect(403,'/api/performance',transfer)
   b.expect(400,'/api/performance',transfer)
   a.expect(403,'/api/performance',transfer,origin='https://untrusted.example')
   manager.expect(200,'/api/records/reviews',{'id':rid,'body':'Preserve draft evidence','rating':3,'due':'2026-11-15'},'PATCH')
   a.expect(400,'/api/performance',transfer)
   transfer['revision']=handoff_row()['revision']
   for bad in [{'reason':''},{'reason':'x'*2001},{'reviewer_id':mid},{'reviewer_id':wid},{'reviewer_id':bid},{'record_id':review},{'revision':'stale'}]:a.expect(400,'/api/performance',{**transfer,**bad})
   no_account=next(p['id'] for p in a.expect(200,'/api/operations')['employees'] if p['email']=='imported-alpha@example.test')
   a.expect(400,'/api/performance',{**transfer,'reviewer_id':no_account})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE employees SET status='Inactive' WHERE id=?",(pid,))
   a.expect(400,'/api/performance',transfer)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    db.execute("UPDATE employees SET status='Active' WHERE id=?",(pid,))
    before=db.execute('SELECT * FROM hr_records WHERE id=?',(rid,)).fetchone()
    db.execute("CREATE TRIGGER reject_reassignment BEFORE INSERT ON performance_reassignments BEGIN SELECT RAISE(ABORT,'fixture history failure'); END")
   a.expect(400,'/api/performance',transfer)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM hr_records WHERE id=?',(rid,)).fetchone()==before
    assert db.execute('SELECT COUNT(*) FROM performance_reassignments WHERE record_id=?',(rid,)).fetchone()[0]==0
    db.execute('DROP TRIGGER reject_reassignment')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:handoffs=list(pool.map(lambda _:a.request('/api/performance',transfer),range(2)))
   assert sorted(status for status,_ in handoffs)==[200,400];checks+=2
   assert not any(r['id']==rid for r in manager.expect(200,'/api/records/reviews')['rows'])
   manager.expect(400,'/api/records/reviews',{'id':rid,'body':'Former reviewer overwrite'},'PATCH')
   replacement=next(r for r in peer.expect(200,'/api/records/reviews')['rows'] if r['id']==rid)
   assert replacement['body']=='Preserve draft evidence' and replacement['data']['rating']==3 and replacement['status']=='Draft' and replacement['due']=='2026-11-15'
   assert not any(r['id']==rid for r in worker.expect(200,'/api/records/reviews')['rows'])
   row=handoff_row();assert row['history'][0]['reason']==transfer['reason'] and json.loads(row['history'][0]['snapshot'])['body']=='Preserve draft evidence'
   assert a.expect(200,'/api/performance',{'action':'remind','cycle_id':handoff})['sent']==1
   peer.expect(200,'/api/records/reviews',{'id':rid,'body':'Replacement submitted response','rating':4,'status':'Submitted'},'PATCH')
   submitted_row=handoff_row()
   back={**transfer,'reviewer_id':mid,'reason':'Original reviewer returned','revision':submitted_row['revision']}
   a.expect(200,'/api/performance',back)
   assert not any(r['id']==rid for r in peer.expect(200,'/api/records/reviews')['rows'])
   peer.expect(400,'/api/records/reviews',{'id':rid,'body':'Former replacement overwrite'},'PATCH')
   returned=next(r for r in manager.expect(200,'/api/records/reviews')['rows'] if r['id']==rid)
   assert returned['status']=='Submitted' and returned['body']=='Replacement submitted response' and returned['data']['rating']==4
   assert len(handoff_row()['history'])==2
   a.expect(400,'/api/performance',{**transfer,'revision':initial['revision']})
   a.expect(200,'/api/records/reviews',{'id':rid,'status':'Published'},'PATCH')
   a.expect(400,'/api/performance',{**transfer,'revision':handoff_row()['revision']})
   assert next(r for r in worker.expect(200,'/api/records/reviews')['rows'] if r['id']==rid)['body']=='Replacement submitted response'
   a.expect(200,'/api/performance',{'action':'close','cycle_id':handoff})
   a.expect(400,'/api/performance',back)
   # Employee acknowledgment is a separate, immutable receipt of a published review.
   published=next(r for r in worker.expect(200,'/api/records/reviews')['rows'] if r['id']==review)
   receipt_body={'record_id':review,'review_hash':published['review_hash'],'confirmed':True}
   assert published['acknowledgment'] is None
   guest.expect(401,'/api/review-acknowledgments',receipt_body)
   for client in [a,b,manager,peer]:client.expect(400,'/api/review-acknowledgments',receipt_body)
   worker.expect(403,'/api/review-acknowledgments',receipt_body,origin='https://untrusted.example')
   for bad in [{'confirmed':False},{'confirmed':'true'},{'review_hash':'wrong'},{'review_hash':None},{'record_id':0},{'record_id':'1'},{'record_id':policy}]:worker.expect(400,'/api/review-acknowledgments',{**receipt_body,**bad})
   draft=records(a,'reviews',{'title':'Unpublished receipt protection','employee_id':wid,'reviewer_id':mid})
   worker.expect(400,'/api/review-acknowledgments',{**receipt_body,'record_id':draft})
   draft_row=next(r for r in manager.expect(200,'/api/records/reviews')['rows'] if r['id']==draft)
   assert 'review_hash' not in draft_row and 'acknowledgment' not in draft_row
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    review_before=db.execute('SELECT * FROM hr_records WHERE id=?',(review,)).fetchone()
    db.execute("CREATE TRIGGER reject_receipt_audit BEFORE INSERT ON audit_log WHEN NEW.action='Published review acknowledged' BEGIN SELECT RAISE(ABORT,'fixture receipt audit failure'); END")
   worker.expect(400,'/api/review-acknowledgments',receipt_body)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT COUNT(*) FROM review_acknowledgments').fetchone()[0]==0
    db.execute('DROP TRIGGER reject_receipt_audit')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:receipts=list(pool.map(lambda _:worker.expect(200,'/api/review-acknowledgments',{**receipt_body,'employee_id':pid,'actor_id':ca['user']['id']}),range(2)))
   assert sum(r['already_acknowledged'] for r in receipts)==1
   receipt=receipts[0]['acknowledgment'];assert receipt['employee_id']==wid
   replay=worker.expect(200,'/api/review-acknowledgments',receipt_body);assert replay['already_acknowledged'] and replay['acknowledgment']==receipt
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM hr_records WHERE id=?',(review,)).fetchone()==review_before
    assert db.execute("SELECT COUNT(*) FROM audit_log WHERE action='Published review acknowledged' AND target=?",(str(review),)).fetchone()[0]==1
    evidence=db.execute('SELECT snapshot,actor_id FROM review_acknowledgments WHERE record_id=?',(review,)).fetchone()
    assert json.loads(evidence[0])['body']=='Excellent' and evidence[1]==worker.expect(200,'/api/operations')['user']['id']
   for client in [worker,a,manager]:assert next(r for r in client.expect(200,'/api/records/reviews')['rows'] if r['id']==review)['acknowledgment']==receipt
   worker.expect(400,'/api/records/reviews',{'id':review,'body':'Overwrite acknowledged review'},'PATCH')
   a.expect(400,'/api/records/reviews',{'id':review,'body':'Overwrite acknowledged review'},'PATCH')
   closed_row=next(r for r in worker.expect(200,'/api/records/reviews')['rows'] if r['id']==rid)
   worker.expect(200,'/api/review-acknowledgments',{'record_id':rid,'review_hash':closed_row['review_hash'],'confirmed':True})
   handoff_counts=next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==handoff)
   assert handoff_counts['status']=='Closed' and handoff_counts['acknowledged']==1 and handoff_counts['awaiting_acknowledgment']==0 and handoff_counts['assignments'][0]['acknowledged_at']
   assert not any(r['id']==rid for r in peer.expect(200,'/api/records/reviews')['rows'])
   peer.expect(400,'/api/review-acknowledgments',{'record_id':rid,'review_hash':closed_row['review_hash'],'confirmed':True})
   # Closed cycles retain acknowledgment follow-up without reopening reviews.
   followup={'action':'remind_acknowledgments','cycle_id':cycle}
   guest.expect(401,'/api/performance',followup)
   for client in [worker,manager,peer]:client.expect(403,'/api/performance',followup)
   b.expect(400,'/api/performance',followup)
   a.expect(403,'/api/performance',followup,origin='https://untrusted.example')
   a.expect(400,'/api/performance',{**followup,'cycle_id':0})
   assert a.expect(200,'/api/performance',{'action':'remind_acknowledgments','cycle_id':handoff})['sent']==0
   assert a.expect(200,'/api/performance',{'action':'remind_acknowledgments','cycle_id':future})['sent']==0
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    original_reviews=db.execute('SELECT * FROM hr_records ORDER BY id').fetchall()
    db.execute("UPDATE employees SET status='Inactive' WHERE id IN (?,?)",(wid,pid))
   unavailable=a.expect(200,'/api/performance',followup);assert unavailable['sent']==0 and unavailable['unavailable']==2
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    db.execute("UPDATE employees SET status='Active' WHERE id IN (?,?)",(wid,pid))
    db.execute("CREATE TRIGGER reject_ack_reminder BEFORE INSERT ON acknowledgment_reminders WHEN (SELECT COUNT(*) FROM acknowledgment_reminders)>0 BEGIN SELECT RAISE(ABORT,'fixture delivery failure'); END")
   before_worker=len(worker.expect(200,'/api/notifications')['rows']);before_manager=len(manager.expect(200,'/api/notifications')['rows'])
   a.expect(400,'/api/performance',followup)
   assert len(worker.expect(200,'/api/notifications')['rows'])==before_worker
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT COUNT(*) FROM acknowledgment_reminders').fetchone()[0]==0
    db.execute('DROP TRIGGER reject_ack_reminder')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:followups=list(pool.map(lambda _:a.expect(200,'/api/performance',followup),range(2)))
   assert sum(r['sent'] for r in followups)==2 and sum(r['skipped'] for r in followups)==2
   assert len(worker.expect(200,'/api/notifications')['rows'])==before_worker+1
   assert len(manager.expect(200,'/api/notifications')['rows'])==before_manager
   receipt_target=next(r for r in worker.expect(200,'/api/records/reviews')['rows'] if r['title']=='Year end cycle')
   worker.expect(200,'/api/review-acknowledgments',{'record_id':receipt_target['id'],'review_hash':receipt_target['review_hash'],'confirmed':True})
   final_followup=a.expect(200,'/api/performance',followup);assert final_followup['sent']==0 and final_followup['skipped']==1
   followup_cycle=next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==cycle)
   assert followup_cycle['acknowledged']==1 and followup_cycle['awaiting_acknowledgment']==1 and all(r['acknowledgment_reminder_count']==1 and r['last_acknowledgment_reminder'] for r in followup_cycle['assignments'])
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:assert db.execute('SELECT * FROM hr_records ORDER BY id').fetchall()==original_reviews
   # Closed-cycle summaries freeze completion metadata and remain tenant-private.
   summary_body={'action':'summarize','cycle_id':cycle}
   guest.expect(401,'/api/performance',summary_body)
   guest.expect(401,'/api/performance-summaries?id=1')
   for client in [worker,manager,peer]:
    client.expect(403,'/api/performance',summary_body)
    client.expect(403,'/api/performance-summaries?id=1')
   b.expect(400,'/api/performance',summary_body)
   a.expect(403,'/api/performance',summary_body,origin='https://untrusted.example')
   a.expect(400,'/api/performance',{**summary_body,'cycle_id':0})
   a.expect(400,'/api/performance',{**summary_body,'cycle_id':future})
   for invalid in ['0','-1','1.2','1e2','bad','9007199254740992']:a.expect(400,'/api/performance-summaries?id='+invalid)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("CREATE TRIGGER reject_summary_audit BEFORE INSERT ON audit_log WHEN NEW.action='Performance completion summary saved' BEGIN SELECT RAISE(ABORT,'fixture summary audit failure'); END")
   a.expect(400,'/api/performance',summary_body)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT COUNT(*) FROM performance_summaries').fetchone()[0]==0
    db.execute('DROP TRIGGER reject_summary_audit')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:saved=list(pool.map(lambda _:a.expect(200,'/api/performance',summary_body),range(2)))
   assert len({s['summary_id'] for s in saved})==1 and sum(s['reused'] for s in saved)==1
   sid=saved[0]['summary_id'];frozen=a.expect(200,'/api/performance-summaries?id='+str(sid))
   b.expect(404,'/api/performance-summaries?id='+str(sid))
   a.expect(404,'/api/performance-summaries?id=999999')
   totals=frozen['snapshot']['totals'];assert totals['assigned']==2 and totals['acknowledged']==1 and totals['awaiting_acknowledgment']==1 and totals['acknowledgment_percent']==50
   assert not any(key in json.dumps(frozen) for key in ['"body"','"rating"','"password_hash"','"email"'])
   assert hashlib.sha256(json.dumps(frozen['snapshot'],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==frozen['content_hash']
   peer_review=next(r for r in peer.expect(200,'/api/records/reviews')['rows'] if r['title']=='Year end cycle')
   peer.expect(200,'/api/review-acknowledgments',{'record_id':peer_review['id'],'review_hash':peer_review['review_hash'],'confirmed':True})
   updated=a.expect(200,'/api/performance',summary_body);assert not updated['reused'] and updated['summary_id']!=sid
   assert a.expect(200,'/api/performance-summaries?id='+str(updated['summary_id']))['snapshot']['totals']['acknowledgment_percent']==100
   assert a.expect(200,'/api/performance-summaries?id='+str(sid))==frozen
   assert a.expect(200,'/api/performance',summary_body)['reused']
   a.expect(200,'/api/performance',{'action':'close','cycle_id':future})
   empty=a.expect(200,'/api/performance',{'action':'summarize','cycle_id':future})['summary_id']
   empty_summary=a.expect(200,'/api/performance-summaries?id='+str(empty))['snapshot']['totals'];assert empty_summary['assigned']==0 and empty_summary['acknowledgment_percent'] is None
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM hr_records ORDER BY id').fetchall()==original_reviews
    assert db.execute("SELECT COUNT(*) FROM audit_log WHERE action='Performance completion summary saved'").fetchone()[0]==3
   # Questions and final HR responses remain private and never rewrite reviews or receipts.
   question={'action':'request','record_id':review,'review_hash':published['review_hash'],'request_key':secrets.token_hex(16),'question':'Please explain the evidence supporting this rating.'}
   followup_url='/api/review-followups?record_id='+str(review)
   guest.expect(401,'/api/review-followups',question);guest.expect(401,followup_url)
   for client in [b,manager,peer]:
    client.expect(400,'/api/review-followups',question);client.expect(404,followup_url)
   a.expect(400,'/api/review-followups',question)
   worker.expect(403,'/api/review-followups',question,origin='https://untrusted.example')
   for bad in [{'question':''},{'question':None},{'question':'x'*4001},{'review_hash':'stale'},{'request_key':'short'},{'record_id':0},{'record_id':policy},{'record_id':draft}]:worker.expect(400,'/api/review-followups',{**question,**bad})
   worker.expect(400,'/api/review-followups?record_id=bad')
   before_requests=worker.expect(200,followup_url);assert before_requests['requests']==[]
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    original_receipts=db.execute('SELECT * FROM review_acknowledgments ORDER BY record_id').fetchall()
    db.execute("CREATE TRIGGER reject_followup_request BEFORE INSERT ON audit_log WHEN NEW.action='Review follow-up requested' BEGIN SELECT RAISE(ABORT,'fixture request failure'); END")
   worker.expect(400,'/api/review-followups',question)
   assert worker.expect(200,followup_url)['requests']==[]
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute('DROP TRIGGER reject_followup_request')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:questions=list(pool.map(lambda _:worker.expect(200,'/api/review-followups',question),range(2)))
   assert len({q['id'] for q in questions})==1 and sum(q['reused'] for q in questions)==1
   qid=questions[0]['id']
   worker.expect(400,'/api/review-followups',{**question,'question':'Alter original request'})
   worker.expect(400,'/api/review-followups',{**question,'request_key':secrets.token_hex(16)})
   assert a.expect(200,followup_url)['requests'][0]['question']==question['question']
   manager_view=next(r for r in manager.expect(200,'/api/records/reviews')['rows'] if r['id']==review);assert 'followups' not in manager_view
   assert next(r for r in worker.expect(200,'/api/records/reviews')['rows'] if r['id']==review)['followups'][0]['id']==qid
   resolution={'action':'resolve','request_id':qid,'note':'We discussed the evidence and recorded your question. The published review remains unchanged.'}
   for client in [worker,manager,peer]:client.expect(403,'/api/review-followups',resolution)
   b.expect(400,'/api/review-followups',resolution)
   a.expect(403,'/api/review-followups',resolution,origin='https://untrusted.example')
   for bad in [{'note':''},{'note':None},{'note':'x'*4001},{'request_id':0}]:a.expect(400,'/api/review-followups',{**resolution,**bad})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("CREATE TRIGGER reject_followup_resolution BEFORE INSERT ON audit_log WHEN NEW.action='Review follow-up resolved' BEGIN SELECT RAISE(ABORT,'fixture resolution failure'); END")
   a.expect(400,'/api/review-followups',resolution)
   assert worker.expect(200,followup_url)['requests'][0]['status']=='Open'
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT COUNT(*) FROM review_followup_resolutions').fetchone()[0]==0
    db.execute('DROP TRIGGER reject_followup_resolution')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:resolved=list(pool.map(lambda _:a.expect(200,'/api/review-followups',resolution),range(2)))
   assert sum(r['reused'] for r in resolved)==1
   a.expect(400,'/api/review-followups',{**resolution,'note':'Rewrite final HR response'})
   assert worker.expect(200,'/api/review-followups',question)['reused']
   assert len(worker.expect(200,followup_url)['requests'])==1
   answer=worker.expect(200,followup_url)['requests'][0];assert answer['status']=='Resolved' and answer['resolution_note']==resolution['note'] and answer['resolved_at'] and answer['resolved_by']
   second=worker.expect(200,'/api/review-followups',{**question,'record_id':rid,'review_hash':closed_row['review_hash'],'request_key':secrets.token_hex(16)})['id']
   assert next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==handoff)['open_followups']==1
   a.expect(200,'/api/review-followups',{**resolution,'request_id':second})
   assert next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==handoff)['open_followups']==0
   # Acknowledgment remains optional for asking HR a question.
   a.expect(200,'/api/records/reviews',{'id':draft,'rating':3,'body':'Pre-acknowledgment question fixture','status':'Published'},'PATCH')
   unacknowledged=next(r for r in worker.expect(200,'/api/records/reviews')['rows'] if r['id']==draft)
   worker.expect(200,'/api/review-followups',{**question,'record_id':draft,'review_hash':unacknowledged['review_hash'],'request_key':secrets.token_hex(16)})
   assert next(r for r in worker.expect(200,'/api/records/reviews')['rows'] if r['id']==draft)['acknowledgment'] is None
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM review_acknowledgments ORDER BY record_id').fetchall()==original_receipts
    assert db.execute('SELECT * FROM hr_records WHERE id<>? ORDER BY id',(draft,)).fetchall()==[row for row in original_reviews if row[0]!=draft]
    evidence=db.execute('SELECT snapshot,question FROM review_followups WHERE id=?',(qid,)).fetchone();assert json.loads(evidence[0])['body']=='Excellent' and evidence[1]==question['question']
    assert db.execute("SELECT COUNT(*) FROM audit_log WHERE action='Review follow-up requested'").fetchone()[0]==3
    assert db.execute("SELECT COUNT(*) FROM audit_log WHERE action='Review follow-up resolved'").fetchone()[0]==2
   # HR inbox ownership and due dates preserve request/review evidence.
   guest.expect(401,'/api/review-followup-inbox')
   for client in [worker,manager,peer]:client.expect(403,'/api/review-followup-inbox')
   inbox=a.expect(200,'/api/review-followup-inbox');open_request=next(r for r in inbox['requests'] if r['status']=='Open');inbox_id=open_request['id']
   assert open_request['version']==0 and open_request['owner_id'] is None and open_request['due']==''
   assert not b.expect(200,'/api/review-followup-inbox')['requests']
   assignment={'action':'assign','request_id':inbox_id,'expected_version':0,'owner_id':ca['user']['id'],'due':'2000-01-01','reason':'Assign to HR for a documented follow-up'}
   guest.expect(401,'/api/review-followups',assignment)
   for client in [worker,manager,peer]:client.expect(403,'/api/review-followups',assignment)
   b.expect(400,'/api/review-followups',assignment)
   a.expect(403,'/api/review-followups',assignment,origin='https://untrusted.example')
   escalation={'action':'escalate','request_id':inbox_id,'expected_version':0,'reason':'Arrange ownership for the unassigned question'}
   reminder_owner={'action':'remind_owner','request_id':inbox_id,'expected_version':0}
   guest.expect(401,'/api/review-followups',escalation)
   for client in [worker,manager,peer]:
    client.expect(403,'/api/review-followups',escalation);client.expect(403,'/api/review-followups',reminder_owner)
   b.expect(400,'/api/review-followups',escalation)
   a.expect(403,'/api/review-followups',escalation,origin='https://untrusted.example')
   a.expect(400,'/api/review-followups',reminder_owner)
   for bad in [{'reason':''},{'reason':'x'*2001},{'expected_version':1},{'request_id':0}]:a.expect(400,'/api/review-followups',{**escalation,**bad})
   before_alerts=len(a.expect(200,'/api/notifications')['rows'])
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("CREATE TRIGGER reject_followup_alert BEFORE INSERT ON audit_log WHEN NEW.action='Review follow-up escalated' BEGIN SELECT RAISE(ABORT,'fixture alert failure'); END")
   a.expect(400,'/api/review-followups',escalation)
   assert len(a.expect(200,'/api/notifications')['rows'])==before_alerts
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT COUNT(*) FROM review_followup_alerts').fetchone()[0]==0
    assert db.execute('SELECT COUNT(*) FROM review_followup_alert_deliveries').fetchone()[0]==0
    db.execute('DROP TRIGGER reject_followup_alert')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:escalations=list(pool.map(lambda _:a.expect(200,'/api/review-followups',escalation),range(2)))
   assert sum(e['sent'] for e in escalations)==1 and sum(e['already_sent'] for e in escalations)==1
   escalation_row=next(r for r in a.expect(200,'/api/review-followup-inbox')['requests'] if r['id']==inbox_id);assert escalation_row['needs_escalation']==1 and len(escalation_row['alerts'])==1
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:peer_account=db.execute('SELECT id FROM accounts WHERE employee_id=?',(pid,)).fetchone()[0]
   for bad in [{'request_id':0},{'expected_version':1},{'expected_version':'0'},{'owner_id':manager_account},{'owner_id':peer_account},{'owner_id':cb['user']['id']},{'owner_id':0},{'reason':''},{'reason':'x'*2001},{'due':'2026-02-30'},{'due':123},{'request_id':qid}]:a.expect(400,'/api/review-followups',{**assignment,**bad})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    requests_before=db.execute('SELECT * FROM review_followups ORDER BY id').fetchall()
    reviews_before=db.execute('SELECT * FROM hr_records ORDER BY id').fetchall()
    receipts_before=db.execute('SELECT * FROM review_acknowledgments ORDER BY record_id').fetchall()
    db.execute("CREATE TRIGGER reject_assignment_audit BEFORE INSERT ON audit_log WHEN NEW.action='Review follow-up assignment changed' BEGIN SELECT RAISE(ABORT,'fixture assignment failure'); END")
   a.expect(400,'/api/review-followups',assignment)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT COUNT(*) FROM review_followup_assignments').fetchone()[0]==0
    assert db.execute('SELECT COUNT(*) FROM review_followup_assignment_events').fetchone()[0]==0
    db.execute('DROP TRIGGER reject_assignment_audit')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:assigned_results=list(pool.map(lambda _:a.request('/api/review-followups',assignment),range(2)))
   assert sorted(status for status,_ in assigned_results)==[200,400];checks+=2
   row=next(r for r in a.expect(200,'/api/review-followup-inbox')['requests'] if r['id']==inbox_id);assert row['overdue']==1 and row['version']==1 and len(row['history'])==1
   assert a.expect(200,'/api/review-followups',{**assignment,'expected_version':1})['unchanged']
   a.expect(400,'/api/review-followups',reminder_owner)
   a.expect(400,'/api/review-followups',{**escalation,'expected_version':1})
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:owner_alerts=list(pool.map(lambda _:a.expect(200,'/api/review-followups',{**reminder_owner,'expected_version':1}),range(2)))
   assert sum(e['sent'] for e in owner_alerts)==1 and sum(e['already_sent'] for e in owner_alerts)==1
   assert len(a.expect(200,'/api/notifications')['rows'])==before_alerts+3

   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE accounts SET access='admin' WHERE id=?",(peer_account,))
   a.expect(200,'/api/review-followups',{**assignment,'expected_version':1,'owner_id':peer_account,'due':'2099-01-01','reason':'Transfer to the replacement HR owner'})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE accounts SET access='employee' WHERE id=?",(peer_account,))
   peer.expect(403,'/api/review-followup-inbox')
   row=next(r for r in a.expect(200,'/api/review-followup-inbox')['requests'] if r['id']==inbox_id);assert row['owner_unavailable']==1 and row['overdue']==0 and row['version']==2 and len(row['history'])==2
   unavailable_row=next(r for r in a.expect(200,'/api/review-followup-inbox')['requests'] if r['id']==inbox_id);assert unavailable_row['needs_escalation']==1
   a.expect(400,'/api/review-followups',{**reminder_owner,'expected_version':2})
   assert a.expect(200,'/api/review-followups',{**escalation,'expected_version':2})['already_sent']
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE review_followup_alerts SET day='2000-01-01' WHERE kind='escalation'")
   assert a.expect(200,'/api/review-followups',{**escalation,'expected_version':2})['sent']==1
   a.expect(400,'/api/review-followups',{**assignment,'expected_version':2,'owner_id':peer_account})
   a.expect(200,'/api/review-followups',{**assignment,'expected_version':2,'owner_id':None,'due':'','reason':'Clear ownership after HR role change'})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM review_followups ORDER BY id').fetchall()==requests_before
    assert db.execute('SELECT * FROM hr_records ORDER BY id').fetchall()==reviews_before
    assert db.execute('SELECT * FROM review_acknowledgments ORDER BY record_id').fetchall()==receipts_before
   a.expect(200,'/api/review-followups',{'action':'resolve','request_id':inbox_id,'note':'Inbox resolution fixture'})
   a.expect(400,'/api/review-followups',{**assignment,'expected_version':3})
   resolved_inbox=next(r for r in a.expect(200,'/api/review-followup-inbox')['requests'] if r['id']==inbox_id)
   a.expect(400,'/api/review-followups',{**reminder_owner,'expected_version':3})
   a.expect(400,'/api/review-followups',{**escalation,'expected_version':3})
   assert resolved_inbox['needs_escalation']==0 and len(resolved_inbox['alerts'])==3
   assert resolved_inbox['status']=='Resolved' and resolved_inbox['overdue']==0 and len(resolved_inbox['history'])==3 and resolved_inbox['resolution_note']=='Inbox resolution fixture'
   # Saved workload snapshots preserve counts while excluding private correspondence.
   workload_url='/api/review-followup-summaries'
   guest.expect(401,workload_url);guest.expect(401,workload_url,{})
   for client in [worker,manager,peer]:client.expect(403,workload_url);client.expect(403,workload_url,{})
   a.expect(403,workload_url,{},origin='https://untrusted.example')
   for invalid in ['','0','-1','bad','1.5','9007199254740992']:a.expect(400,workload_url+'?id='+invalid)
   assert a.expect(200,workload_url)['summaries']==[]
   workload_request=worker.expect(200,'/api/review-followups',{**question,'request_key':secrets.token_hex(16),'question':'Private workload fixture question'})['id']
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    before_workload_reviews=db.execute('SELECT * FROM hr_records ORDER BY id').fetchall()
    before_workload_receipts=db.execute('SELECT * FROM review_acknowledgments ORDER BY record_id').fetchall()
    db.execute("CREATE TRIGGER reject_workload_summary BEFORE INSERT ON audit_log WHEN NEW.action='HR follow-up workload summary saved' BEGIN SELECT RAISE(ABORT,'fixture summary failure'); END")
   a.expect(400,workload_url,{})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT COUNT(*) FROM review_followup_summaries').fetchone()[0]==0
    db.execute('DROP TRIGGER reject_workload_summary')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:workloads=list(pool.map(lambda _:a.expect(200,workload_url,{}),range(2)))
   assert len({r['id'] for r in workloads})==1 and sum(r['reused'] for r in workloads)==1
   workload_id=workloads[0]['id'];saved_workload=a.expect(200,workload_url+'?id='+str(workload_id))
   snapshot=saved_workload['snapshot'];totals=snapshot['totals']
   assert totals['total']==4 and totals['open']==1 and totals['resolved']==3 and totals['unassigned']==1 and totals['needs_hr_owner']==1 and totals['overdue']==0 and totals['without_due']==1
   assert snapshot['timezone']=='Africa/Lagos' and snapshot['scope']=='All company review follow-ups'
   assert sum(owner['open'] for owner in snapshot['by_owner'])==totals['open'] and sum(owner['resolved'] for owner in snapshot['by_owner'])==totals['resolved']
   assert hashlib.sha256(json.dumps(snapshot,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==saved_workload['content_hash']
   assert not any(key in json.dumps(saved_workload) for key in ['"question"','"resolution_note"','"note"','"reason"','"body"','"rating"','"email"','"password_hash"','Private workload fixture question'])
   b.expect(404,workload_url+'?id='+str(workload_id));a.expect(404,workload_url+'?id=999999')
   beta_workload=b.expect(200,workload_url,{})['id'];empty_workload=b.expect(200,workload_url+'?id='+str(beta_workload))['snapshot'];assert empty_workload['totals']['total']==0 and empty_workload['by_owner']==[]
   a.expect(404,workload_url+'?id='+str(beta_workload))
   a.expect(200,'/api/review-followups',{'action':'assign','request_id':workload_request,'expected_version':0,'owner_id':ca['user']['id'],'due':'2000-01-01','reason':'Workload ownership fixture'})
   assigned_workload=a.expect(200,workload_url,{});assert not assigned_workload['reused'] and assigned_workload['id']!=workload_id
   assigned_totals=a.expect(200,workload_url+'?id='+str(assigned_workload['id']))['snapshot']['totals'];assert assigned_totals['overdue']==1 and assigned_totals['needs_hr_owner']==0
   assert a.expect(200,workload_url+'?id='+str(workload_id))==saved_workload
   a.expect(200,'/api/review-followups',{'action':'resolve','request_id':workload_request,'note':'Private workload fixture response'})
   resolved_workload=a.expect(200,workload_url,{});assert not resolved_workload['reused']
   resolved_totals=a.expect(200,workload_url+'?id='+str(resolved_workload['id']))['snapshot']['totals'];assert resolved_totals['open']==0 and resolved_totals['resolved']==4 and resolved_totals['overdue']==0
   assert a.expect(200,workload_url,{})['reused'] and len(a.expect(200,workload_url)['summaries'])==3
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM hr_records ORDER BY id').fetchall()==before_workload_reviews
    assert db.execute('SELECT * FROM review_acknowledgments ORDER BY record_id').fetchall()==before_workload_receipts
    assert db.execute("SELECT COUNT(*) FROM audit_log WHERE company_id=? AND action='HR follow-up workload summary saved'",(ca['user']['company_id'],)).fetchone()[0]==3
   # Bulk assignments preview exact changes and atomically commit or roll back all requests.
   bulk_url='/api/review-followup-bulk'
   bulk_a=worker.expect(200,'/api/review-followups',{**question,'request_key':secrets.token_hex(16),'question':'First bulk fixture'})['id']
   bulk_b=worker.expect(200,'/api/review-followups',{**question,'record_id':rid,'review_hash':closed_row['review_hash'],'request_key':secrets.token_hex(16),'question':'Second bulk fixture'})['id']
   bulk={'action':'preview','requests':[{'request_id':bulk_a,'expected_version':0},{'request_id':bulk_b,'expected_version':0}],'owner_id':ca['user']['id'],'due':'2026-12-31','reason':'Reviewed bulk ownership fixture'}
   guest.expect(401,bulk_url,bulk)
   for client in [worker,manager,peer]:client.expect(403,bulk_url,bulk)
   b.expect(400,bulk_url,bulk)
   a.expect(403,bulk_url,bulk,origin='https://untrusted.example')
   for bad in [{'requests':[]},{'requests':bulk['requests']*101},{'requests':[bulk['requests'][0]]*2},{'requests':[{'request_id':bulk_a,'expected_version':1}]},{'requests':[{'request_id':qid,'expected_version':0}]},{'owner_id':manager_account},{'owner_id':cb['user']['id']},{'due':'2026-02-30'},{'reason':''},{'reason':'x'*2001}]:a.expect(400,bulk_url,{**bulk,**bad})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    before_bulk_assignments=db.execute('SELECT * FROM review_followup_assignments ORDER BY request_id').fetchall()
    before_bulk_events=db.execute('SELECT * FROM review_followup_assignment_events ORDER BY id').fetchall()
    before_bulk_reviews=db.execute('SELECT * FROM hr_records ORDER BY id').fetchall()
   preview=a.expect(200,bulk_url,bulk);assert preview['changed']==2 and preview['unchanged']==0 and len(preview['plan'])==2
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM review_followup_assignments ORDER BY request_id').fetchall()==before_bulk_assignments
    assert db.execute('SELECT * FROM review_followup_assignment_events ORDER BY id').fetchall()==before_bulk_events
   commit={**bulk,'action':'commit','preview_hash':preview['preview_hash']}
   a.expect(400,bulk_url,{**commit,'preview_hash':'bad'})
   a.expect(400,bulk_url,{**commit,'reason':'Changed reason after preview'})
   a.expect(400,bulk_url,{**commit,'due':'2027-01-01'})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("CREATE TRIGGER reject_bulk_save BEFORE INSERT ON audit_log WHEN NEW.action='Bulk review follow-up assignment completed' BEGIN SELECT RAISE(ABORT,'fixture batch failure'); END")
   a.expect(400,bulk_url,commit)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM review_followup_assignments ORDER BY request_id').fetchall()==before_bulk_assignments
    assert db.execute('SELECT * FROM review_followup_assignment_events ORDER BY id').fetchall()==before_bulk_events
    assert db.execute('SELECT COUNT(*) FROM review_followup_batches').fetchone()[0]==0
    db.execute('DROP TRIGGER reject_bulk_save')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:bulk_results=list(pool.map(lambda _:a.expect(200,bulk_url,commit),range(2)))
   assert len({r['batch_id'] for r in bulk_results})==1 and sum(r['reused'] for r in bulk_results)==1 and all(r['changed']==2 for r in bulk_results)
   a.expect(400,bulk_url,{**commit,'owner_id':None})
   assert a.expect(200,bulk_url,commit)['reused']
   rows={r['id']:r for r in a.expect(200,'/api/review-followup-inbox')['requests']};assert all(rows[rid]['version']==1 and rows[rid]['owner_id']==ca['user']['id'] for rid in [bulk_a,bulk_b])
   next_bulk={**bulk,'requests':[{'request_id':bulk_a,'expected_version':1},{'request_id':bulk_b,'expected_version':1}],'due':'2027-01-01'}
   next_preview=a.expect(200,bulk_url,next_bulk)
   a.expect(200,'/api/review-followups',{'action':'assign','request_id':bulk_b,'expected_version':1,'owner_id':ca['user']['id'],'due':'2027-02-01','reason':'Another HR edit after bulk preview'})
   a.expect(400,bulk_url,{**next_bulk,'action':'commit','preview_hash':next_preview['preview_hash']})
   rows={r['id']:r for r in a.expect(200,'/api/review-followup-inbox')['requests']};assert rows[bulk_a]['due']=='2026-12-31' and rows[bulk_a]['version']==1 and rows[bulk_b]['due']=='2027-02-01'
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM hr_records ORDER BY id').fetchall()==before_bulk_reviews
    assert db.execute('SELECT COUNT(*) FROM review_followup_batches').fetchone()[0]==1
   # Completed batch history remains private and frozen after later edits.
   batch_id=bulk_results[0]['batch_id'];batch_download=bulk_url+'?id='+str(batch_id)
   guest.expect(401,bulk_url);guest.expect(401,batch_download)
   for client in [worker,manager,peer]:client.expect(403,bulk_url);client.expect(403,batch_download)
   for invalid in ['','0','-1','bad','1.5','9007199254740992']:a.expect(400,bulk_url+'?id='+invalid)
   b.expect(404,batch_download);a.expect(404,bulk_url+'?id=999999')
   assert b.expect(200,bulk_url)['batches']==[]
   saved_batches=a.expect(200,bulk_url)['batches'];assert len(saved_batches)==1 and saved_batches[0]['changed']==2 and saved_batches[0]['selected']==2 and saved_batches[0]['reason']==bulk['reason']
   frozen_batch=a.expect(200,batch_download);batch_payload=frozen_batch['payload']
   assert batch_payload['batch']['actor_name']==ca['user']['name'] and batch_payload['batch']['actor_id']==ca['user']['id']
   assert batch_payload['result']['changed']==2 and len(batch_payload['plan'])==2 and all(r['new_due']=='2026-12-31' for r in batch_payload['plan'])
   assert hashlib.sha256(json.dumps(batch_payload,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==frozen_batch['content_hash']
   assert not any(key in json.dumps(frozen_batch) for key in ['"question"','"resolution_note"','"password_hash"','"body"','"rating"','"email"'])
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    before_batch_read=db.execute('SELECT * FROM review_followup_batches ORDER BY id').fetchall()
    before_batch_audit=db.execute('SELECT COUNT(*) FROM audit_log').fetchone()[0]
    db.execute("UPDATE employees SET name='Renamed HR profile' WHERE id=?",(aid,))
   assert a.expect(200,batch_download)==frozen_batch
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute('UPDATE employees SET name=? WHERE id=?',(ca['user']['name'],aid))
   assert a.expect(200,bulk_url,commit)['reused']
   a.expect(200,'/api/review-followups',{'action':'resolve','request_id':bulk_a,'note':'Resolution after completed batch'})
   assert a.expect(200,batch_download)==frozen_batch
   assert next(r for r in a.expect(200,'/api/review-followup-inbox')['batches'] if r['id']==batch_id)['changed']==2
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM review_followup_batches ORDER BY id').fetchall()==before_batch_read
    assert db.execute('SELECT COUNT(*) FROM audit_log').fetchone()[0]==before_batch_audit+1
    # A migrated pre-feature batch has an unknown historical display name, not a guessed name.
    db.execute("UPDATE review_followup_batches SET actor_name='' WHERE id=?",(batch_id,))
   assert a.expect(200,batch_download)['payload']['batch']['actor_name'] is None
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute('UPDATE review_followup_batches SET actor_name=? WHERE id=?',(ca['user']['name'],batch_id))
   # Saved filter views are private per administrator and version protected.
   views_url='/api/review-followup-views'
   guest.expect(401,views_url)
   for client in [worker,peer,manager]:client.expect(403,views_url);client.expect(403,views_url,{'action':'save'})
   settings={'status':'Open','ownership':'mine','overdue_only':True,'needs_hr_owner':False,'search':'private question search'}
   body={'action':'save','name':'My overdue questions','filters':settings}
   a.expect(403,views_url,body,origin='https://evil.example')
   for invalid in [{**settings,'status':'bad'},{**settings,'overdue_only':1},{**settings,'search':'x'*201},{**settings,'extra':'no'}]:a.expect(400,views_url,{**body,'filters':invalid})
   a.expect(400,views_url,{**body,'name':' '})
   a.expect(400,views_url,{**body,'action':['save']})
   a.expect(400,views_url,{**body,'filters':{**settings,'status':['Open']}})
   saved=a.expect(200,views_url,body);vid=saved['id']
   row=a.expect(200,views_url)['views'][0];assert row['filters']==settings and row['version']==1
   a.expect(400,views_url,{**body,'name':' MY OVERDUE QUESTIONS '})
   assert b.expect(200,views_url)['views']==[]
   b.expect(400,views_url,{**body,'id':vid,'expected_version':1})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE accounts SET access='admin' WHERE id=?",(peer_account,))
   assert peer.expect(200,views_url)['views']==[]
   peer.expect(400,views_url,{'action':'archive','id':vid,'expected_version':1})
   peer.expect(200,views_url,body)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE accounts SET access='employee' WHERE id=?",(peer_account,))
   edit={**body,'id':vid,'expected_version':1}
   assert a.expect(200,views_url,edit)['unchanged']
   assert a.expect(200,views_url)['views'][0]['version']==1
   changed={**edit,'name':'Updated view'}
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    outcomes=list(pool.map(lambda _:a.request(views_url,changed),range(2)))
   assert sorted(r[0] for r in outcomes)==[200,400]
   a.expect(400,views_url,edit)
   row=a.expect(200,views_url)['views'][0];assert row['version']==2 and row['name']=='Updated view'
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("CREATE TRIGGER reject_view_save BEFORE INSERT ON audit_log WHEN NEW.action='Archived private inbox view' BEGIN SELECT RAISE(ABORT,'fixture view failure'); END")
   archive={'action':'archive','id':vid,'expected_version':2}
   a.expect(400,views_url,archive)
   assert a.expect(200,views_url)['views'][0]['version']==2
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute('DROP TRIGGER reject_view_save')
   a.expect(200,views_url,archive);assert a.expect(200,views_url)['views']==[]
   a.expect(400,views_url,archive);a.expect(200,views_url,body)
   # Pinned views stay personal, ordered first, and use the same stale-write guard.
   row=a.expect(200,views_url)['views'][0];vid=row['id'];assert row['pinned']==0
   another=a.expect(200,views_url,{**body,'name':'A first alphabetically'})['id']
   pin={'action':'pin','id':vid,'expected_version':1,'pinned':True}
   for client,status in [(guest,401),(worker,403),(manager,403),(b,400)]:client.expect(status,views_url,pin)
   a.expect(403,views_url,pin,origin='https://evil.example')
   for bad in [None,1,'true',[]]:a.expect(400,views_url,{**pin,'pinned':bad})
   a.expect(400,views_url,{'action':'pin','pinned':True})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE accounts SET access='admin' WHERE id=?",(peer_account,))
   peer.expect(400,views_url,pin)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE accounts SET access='employee' WHERE id=?",(peer_account,))
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("CREATE TRIGGER reject_view_pin BEFORE INSERT ON audit_log WHEN NEW.action='Pinned private inbox view' BEGIN SELECT RAISE(ABORT,'fixture pin failure'); END")
   a.expect(400,views_url,pin)
   rows=a.expect(200,views_url)['views'];assert all(r['pinned']==0 and r['version']==1 for r in rows)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute('DROP TRIGGER reject_view_pin')
   a.expect(200,views_url,pin);a.expect(400,views_url,pin)
   rows=a.expect(200,views_url)['views'];assert rows[0]['id']==vid and rows[0]['version']==2 and rows[0]['pinned']==1 and rows[0]['filters']==settings
   assert a.expect(200,views_url,{**pin,'expected_version':2})['unchanged']
   assert a.expect(200,views_url)['views'][0]['version']==2
   a.expect(400,views_url,{**body,'id':vid,'expected_version':1,'name':'Stale after pin'})
   a.expect(200,views_url,{**body,'id':vid,'expected_version':2,'name':'Pinned renamed'})
   assert a.expect(200,views_url)['views'][0]['pinned']==1
   a.expect(200,views_url,{**pin,'expected_version':3,'pinned':False})
   rows=a.expect(200,views_url)['views'];assert rows[0]['id']==another and all(r['pinned']==0 for r in rows)
   a.expect(200,views_url,{**pin,'expected_version':4})
   a.expect(200,views_url,{'action':'archive','id':vid,'expected_version':5})
   a.expect(400,views_url,{**pin,'expected_version':6})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT pinned FROM review_followup_views WHERE id=?',(vid,)).fetchone()[0]==0
   # Archived views can be restored only by their owner, without replacing active views.
   archived=a.expect(200,views_url)['archived_views'];assert any(v['id']==vid and v['filters']==settings for v in archived)
   restore={'action':'restore','id':vid,'expected_version':6,'name':'Recovered view'}
   for client,status in [(guest,401),(worker,403),(manager,403),(b,400)]:client.expect(status,views_url,restore)
   assert b.expect(200,views_url)['archived_views']==[]
   a.expect(403,views_url,restore,origin='https://evil.example')
   for bad in ['', ' '*3, 'x'*101, None, 1]:a.expect(400,views_url,{**restore,'name':bad})
   for bad in [0,-1,1.2,'6',None]:a.expect(400,views_url,{**restore,'expected_version':bad})
   a.expect(400,views_url,{**restore,'expected_version':5})
   a.expect(400,views_url,{**restore,'id':another,'expected_version':1})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE accounts SET access='admin' WHERE id=?",(peer_account,))
   assert all(v['id']!=vid for v in peer.expect(200,views_url)['archived_views'])
   peer.expect(400,views_url,restore)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute("UPDATE accounts SET access='employee' WHERE id=?",(peer_account,))
   a.expect(400,views_url,{**restore,'name':' A FIRST ALPHABETICALLY '})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    before_restore=db.execute('SELECT * FROM review_followup_views ORDER BY id').fetchall()
    before_restore_audit=db.execute('SELECT COUNT(*) FROM audit_log').fetchone()[0]
    db.execute("CREATE TRIGGER reject_view_restore BEFORE INSERT ON audit_log WHEN NEW.action='Restored private inbox view' BEGIN SELECT RAISE(ABORT,'fixture restore failure'); END")
   a.expect(400,views_url,restore)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM review_followup_views ORDER BY id').fetchall()==before_restore
    assert db.execute('SELECT COUNT(*) FROM audit_log').fetchone()[0]==before_restore_audit
    db.execute('DROP TRIGGER reject_view_restore')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:restores=list(pool.map(lambda _:a.request(views_url,restore),range(2)))
   assert sorted(r[0] for r in restores)==[200,400]
   restored=next(v for v in a.expect(200,views_url)['views'] if v['id']==vid)
   assert restored['name']=='Recovered view' and restored['filters']==settings and restored['version']==7 and restored['pinned']==0
   assert all(v['id']!=vid for v in a.expect(200,views_url)['archived_views'])
   a.expect(400,views_url,restore)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:assert db.execute('SELECT COUNT(*) FROM audit_log').fetchone()[0]==before_restore_audit+1
   # Public readiness rejects incomplete migrations without leaking internal details or repairing them.
   assert guest.expect(200,'/api/health/ready')=={'status':'ready'}
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute('ALTER TABLE review_followup_views RENAME COLUMN pinned TO unavailable_pin_fixture')
   assert guest.expect(503,'/api/health/ready')=={'status':'unavailable'}
   assert guest.expect(200,'/api/health/live')=={'status':'ok'}
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert 'pinned' not in [r[1] for r in db.execute('PRAGMA table_info(review_followup_views)')]
    db.execute('ALTER TABLE review_followup_views RENAME COLUMN unavailable_pin_fixture TO pinned')
   assert guest.expect(200,'/api/health/ready')=={'status':'ready'}
   # Human pilot observations are private company-admin records, not payroll approval.
   guest.expect(401,'/api/pilot')
   pilot={'case_id':'staff','expected_version':0,'status':'Passed','tester':'Fictional HR tester','tester_role':'HR','revision':'pilot-fixture-v1','note':'Validated fictional import and duplicate protection.'}
   for client in [worker,peer,manager]:client.expect(403,'/api/pilot');client.expect(403,'/api/pilot',pilot)
   guest.expect(401,'/api/pilot',pilot)
   a.expect(403,'/api/pilot',pilot,origin='https://evil.example')
   initial=a.expect(200,'/api/pilot')['cases'];assert len(initial)==13 and all(c['latest'] is None and c['history']==[] for c in initial)
   empty_report=a.expect(200,'/api/pilot?download=1');assert empty_report['payload']['totals']=={'Pending':13,'Passed':0,'Failed':0,'Blocked':0}
   for change in [{'case_id':'foreign'},{'status':'Approved'},{'tester_role':'Owner'},{'expected_version':-1},{'expected_version':'0'},{'tester':''},{'revision':''},{'note':' '},{'note':'x'*2001}]:a.expect(400,'/api/pilot',{**pilot,**change})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    pilot_accounts=db.execute('SELECT * FROM accounts ORDER BY id').fetchall()
    pilot_reviews=db.execute('SELECT * FROM payroll_reviews ORDER BY id').fetchall()
    db.execute("CREATE TRIGGER reject_pilot BEFORE INSERT ON audit_log WHEN NEW.action='Recorded pilot result' BEGIN SELECT RAISE(ABORT,'fixture pilot failure'); END")
   a.expect(400,'/api/pilot',pilot)
   assert all(c['latest'] is None for c in a.expect(200,'/api/pilot')['cases'])
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute('DROP TRIGGER reject_pilot')
   assert a.expect(200,'/api/pilot',{**pilot,'company_id':cb['user']['company_id'],'actor_id':cb['user']['id']})['version']==1
   row=next(c for c in a.expect(200,'/api/pilot')['cases'] if c['id']=='staff');assert row['latest']['actor_id']==ca['user']['id'] and row['latest']['actor_name']==ca['user']['name'] and len(row['history'])==1
   first_pilot=row['latest'];assert all(c['latest'] is None for c in b.expect(200,'/api/pilot')['cases'])
   b.expect(200,'/api/pilot',{**pilot,'note':'Private Beta pilot evidence'})
   assert 'Private Beta pilot evidence' not in str(a.expect(200,'/api/pilot'))
   a.expect(400,'/api/pilot',pilot)
   assert a.expect(200,'/api/pilot',{**pilot,'expected_version':1})['unchanged']
   changed_pilot={**pilot,'expected_version':1,'status':'Failed','note':'Fictional second test found an import issue.'}
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:pilot_updates=list(pool.map(lambda _:a.request('/api/pilot',changed_pilot),range(2)))
   assert sorted(r[0] for r in pilot_updates)==[200,400]
   row=next(c for c in a.expect(200,'/api/pilot')['cases'] if c['id']=='staff');assert row['latest']['status']=='Failed' and row['latest']['version']==2 and row['history'][1]==first_pilot
   a.expect(200,'/api/pilot',{**pilot,'expected_version':2,'status':'Pending','note':'Reopened for a new app revision.'})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM accounts ORDER BY id').fetchall()==pilot_accounts
    assert db.execute('SELECT * FROM payroll_reviews ORDER BY id').fetchall()==pilot_reviews
   # A pilot export is a private read-only snapshot with current and historic evidence.
   export='/api/pilot?download=1'
   guest.expect(401,export)
   for client in [worker,peer,manager]:client.expect(403,export)
   for invalid in ['', '0', 'true', '-1']:a.expect(400,'/api/pilot?download='+invalid)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    before_export=db.execute('SELECT * FROM pilot_results ORDER BY id').fetchall()
    export_audit=db.execute('SELECT COUNT(*) FROM audit_log').fetchone()[0]
   report=a.expect(200,export);payload=report['payload'];assert payload['format']=='hris-pilot-report-v1' and payload['company']['id']==ca['user']['company_id'] and payload['company']['name']=='Alpha'
   assert payload['totals']=={'Pending':13,'Passed':0,'Failed':0,'Blocked':0}
   staff_case=next(c for c in payload['cases'] if c['id']=='staff');assert len(staff_case['history'])==3 and staff_case['latest']['status']=='Pending' and staff_case['history'][-1]['status']=='Passed'
   assert staff_case['latest']['recorded_by']=={'account_id':ca['user']['id'],'name':ca['user']['name']}
   assert hashlib.sha256(json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==report['content_hash']
   assert payload['payroll_approval']=='Not established by this report.' and payload['launch_authorization']=='Not established by this report.'
   assert not any(key in json.dumps(report) for key in ['password_hash','token_hash','Private Beta pilot evidence'])
   beta_report=b.expect(200,export+'&company_id='+str(ca['user']['company_id']));assert beta_report['payload']['company']['id']==cb['user']['company_id'] and beta_report['payload']['totals']['Passed']==1
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM pilot_results ORDER BY id').fetchall()==before_export
    assert db.execute('SELECT COUNT(*) FROM audit_log').fetchone()[0]==export_audit
   a.expect(400,'/api/people',{'employee_id':bid,'name':'Foreign','role':'No','joined':'2026-01-01','status':'Active'},'PATCH');a.expect(200,'/api/people',{'employee_id':pid,'name':'Alpha Peer','role':'Engineer','joined':'2026-10-16','status':'Inactive','access':'employee'},'PATCH');peer.expect(401,'/api/leaves',{});peer.expect(401,'/api/auth',{'email':'alpha-peer@example.test','password':password})
   assert all(x['employee_id']!=pid for x in a.expect(200,'/api/onboarding-progress')['assignments'])
   a.expect(404,'/api/onboarding-progress',{'action':'remind','assignment_id':peer_assignment['id']})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
   print(f'PASS: {checks} platform HTTP checks across two companies; import, private documents, attendance, payroll, payment records, recruiting, reviews, feedback, learning, onboarding, letters, policy search, analytics, audit and deactivation.')
  except Exception:
   log.seek(0);print(log.read()[-7000:]);raise
  finally:server.terminate();server.wait(timeout=10)
