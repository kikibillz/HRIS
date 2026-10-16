"""Recruiting permissions, immutable evidence, approval integrity and optional browser flow."""
import concurrent.futures,http.cookiejar,json,os,secrets,sqlite3,subprocess,sys,tempfile,time,urllib.request,urllib.error
browser_mode='--browser' in sys.argv
port=3111 if browser_mode else 3110
BASE=f'http://127.0.0.1:{port}';checks=0;password=secrets.token_urlsafe(24)
class Client:
 def __init__(self):
  self.jar=http.cookiejar.CookieJar();self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
 def call(self,status,path='/api/recruiting',body=None,method=None,origin=BASE):
  global checks
  req=urllib.request.Request(BASE+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Origin':origin,'Content-Type':'application/json'})
  try:r=self.http.open(req,timeout=15)
  except urllib.error.HTTPError as e:r=e
  with r:
   text=r.read();result=json.loads(text) if r.headers.get('Content-Type','').startswith('application/json') else text
   assert r.status==status,(path,r.status,result);checks+=1;return result
with tempfile.TemporaryDirectory(prefix='hris-recruiting-') as directory:
 with open(os.path.join(directory,'server.log'),'w+') as log:
  server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],env={**os.environ,'HRIS_DATA_DIR':directory},stdout=log,stderr=log)
  try:
   a,b,reviewer,manager,peer,guest=[Client() for _ in range(6)]
   for _ in range(100):
    try:
     guest.call(200,'/login');break
    except OSError:time.sleep(.2)
   for client,name in [(a,'Alpha'),(b,'Beta')]:client.call(201,'/api/companies',{'company':name,'name':name+' Admin','email':name.lower()+'@example.test','password':password})
   company=a.call(200,'/api/operations')['user']['company_id']
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:dept=db.execute('SELECT department_id FROM company_departments WHERE company_id=?',(company,)).fetchone()[0]
   for client,name,access in [(reviewer,'Interviewer','employee'),(manager,'Approver','manager'),(peer,'Peer','employee')]:
    a.call(201,'/api/employees',{'name':name,'email':name.lower()+'@example.test','role':name,'department_id':dept,'access':access,'password':password});client.call(200,'/api/auth',{'email':name.lower()+'@example.test','password':password})
   aid=a.call(200,'/api/operations')['user']['id'];rid=reviewer.call(200,'/api/operations')['user']['id'];mid=manager.call(200,'/api/operations')['user']['id'];bid=b.call(200,'/api/operations')['user']['id']
   job=a.call(201,'/api/records/jobs',{'title':'Engineer','body':'Role evidence','status':'Open'})['id']
   def applicant(name):return a.call(201,'/api/records/applicants',{'title':name,'email':'candidate@example.test','reference_id':job})['id']
   cid=applicant('Candidate One');hidden=applicant('Unassigned candidate')
   guest.call(401);guest.call(401,body={'action':'assign','applicant_id':cid,'interviewer_id':rid})
   for c in [reviewer,manager,peer]:
    assert not c.call(200)['candidates'];c.call(403,body={'action':'assign','applicant_id':cid,'interviewer_id':rid})
   a.call(403,body={'action':'assign','applicant_id':cid,'interviewer_id':rid},origin='https://untrusted.example')
   b.call(400,body={'action':'assign','applicant_id':cid,'interviewer_id':bid})
   a.call(400,body={'action':'assign','applicant_id':cid,'interviewer_id':bid})
   a.call(400,'/api/records/applicants',{'id':cid,'status':'Offer'},'PATCH')
   a.call(400,'/api/records/applicants',{'title':'Bypass','email':'bypass@example.test','reference_id':job,'status':'Hired'})
   a.call(200,body={'action':'assign','applicant_id':cid,'interviewer_id':rid})
   card=reviewer.call(200)['cards'][0]['id'];assert [x['id'] for x in reviewer.call(200)['candidates']]==[cid] and not reviewer.call(200)['approvals'] and not reviewer.call(200)['interviewers']
   a.call(400,body={'action':'assign','applicant_id':cid,'interviewer_id':rid})
   request={'action':'request','applicant_id':cid,'approver_id':mid,'note':'Compare all evidence before progressing.'}
   a.call(400,body=request)
   score={'action':'submit','card_id':card,'ratings':{'knowledge':4,'problem_solving':3,'communication':5},'notes':'Concrete examples from the technical discussion.','recommendation':'Hire'}
   for c in [a,peer,b,manager]:c.call(400,body=score)
   reviewer.call(400,body={**score,'ratings':{'knowledge':6,'problem_solving':3,'communication':5}})
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    # Separate authenticated openers, same identity, make a replay race explicit.
    duplicate=Client();duplicate.call(200,'/api/auth',{'email':'interviewer@example.test','password':password})
    def submit(c):
     req=urllib.request.Request(BASE+'/api/recruiting',data=json.dumps(score).encode(),headers={'Origin':BASE,'Content-Type':'application/json'})
     try:r=c.http.open(req,timeout=15)
     except urllib.error.HTTPError as e:r=e
     with r:return r.status
    assert sorted(pool.map(submit,[reviewer,duplicate]))==[200,400]
   reviewer.call(400,body=score)
   a.call(400,body={**request,'approver_id':aid});a.call(400,body={**request,'approver_id':rid});a.call(400,body={**request,'approver_id':bid})
   a.call(200,body=request);a.call(400,body=request)
   approval=manager.call(200)['approvals'][0]['id'];assert [x['id'] for x in manager.call(200)['candidates']]==[cid] and not peer.call(200)['approvals'] and not b.call(200)['approvals']
   decision={'action':'decide','approval_id':approval,'decision':'Approved','note':'Evidence reviewed; proceed.'}
   a.call(400,body=decision);peer.call(403,body=decision);b.call(400,body=decision)
   # Changing candidate evidence prevents approving a stale request.
   a.call(200,'/api/records/applicants',{'id':cid,'body':'Updated evidence'},'PATCH');manager.call(400,body=decision)
   manager.call(200,body={**decision,'decision':'Rejected','note':'Request a review of the updated evidence.'});manager.call(400,body=decision)
   a.call(200,body=request);approval=manager.call(200)['approvals'][0]['id'];decision['approval_id']=approval;manager.call(200,body=decision)
   # A combined evidence change + stage advance cannot bypass the reviewed snapshot.
   a.call(400,'/api/records/applicants',{'id':cid,'title':'Changed candidate','status':'Offer'},'PATCH')
   a.call(200,'/api/records/applicants',{'id':cid,'status':'Offer'},'PATCH')
   # Job edits invalidate approval for the subsequent Hired transition.
   a.call(200,'/api/records/jobs',{'id':job,'body':'Changed job requirements'},'PATCH')
   a.call(400,'/api/records/applicants',{'id':cid,'status':'Hired'},'PATCH')
   a.call(200,body=request);approval=manager.call(200)['approvals'][0]['id'];manager.call(200,body={**decision,'approval_id':approval})
   a.call(200,'/api/records/applicants',{'id':cid,'status':'Hired'},'PATCH')
   a.call(400,body={'action':'assign','applicant_id':cid,'interviewer_id':aid})
   a.call(200,'/api/records/applicants',{'id':cid,'body':'Post-hire record correction'},'PATCH')
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    before=db.execute('SELECT count(*) FROM employees').fetchone()[0]
    assert db.execute("SELECT count(*) FROM audit_log WHERE company_id=? AND action='Hiring approved'",(company,)).fetchone()[0]==2
   assert len(a.call(200,'/api/operations')['employees'])==4 # hiring never creates an employee automatically
   # Reviewed candidate handoff never creates accounts or overwrites existing employees.
   guest.call(401,'/api/recruiting-handoff')
   for client in [reviewer,manager,peer]:
    client.call(403,'/api/recruiting-handoff');client.call(403,'/api/recruiting-handoff',{'action':'preview','applicant_id':cid})
   template=a.call(201,'/api/onboarding',{'action':'create','title':'Handoff checklist','items':[{'title':'Prepare paperwork','body':'Welcome documents','days':-1},{'title':'Meet the team','body':'Introductions','days':2}]})['id']
   form={'applicant_id':cid,'mode':'create','work_email':'new-hire@example.test','role':'Engineer','department_id':dept,'start_date':'2026-03-01','template_id':template}
   def preview(form):return a.call(200,'/api/recruiting-handoff',{'action':'preview',**form})['preview']
   a.call(403,'/api/recruiting-handoff',{'action':'preview',**form},origin='https://untrusted.example')
   b.call(400,'/api/recruiting-handoff',{'action':'preview',**form})
   a.call(400,'/api/recruiting-handoff',{'action':'preview',**form,'applicant_id':hidden})
   a.call(400,'/api/recruiting-handoff',{'action':'preview',**form,'work_email':'INTERVIEWER@example.test'})
   a.call(400,'/api/recruiting-handoff',{'action':'preview',**form,'department_id':999999})
   a.call(400,'/api/recruiting-handoff',{'action':'preview',**form,'template_id':job})
   reviewed=preview(form);assert {t['due'] for t in reviewed['tasks']}=={'2026-02-28','2026-03-03'}
   a.call(200,'/api/records/applicants',{'id':cid,'body':'A correction after preview'},'PATCH')
   a.call(400,'/api/recruiting-handoff',{'action':'commit',**form,'confirmed':True,'preview_hash':reviewed['hash']})
   reviewed=preview(form);commit={'action':'commit',**form,'confirmed':True,'preview_hash':reviewed['hash']}
   a.call(400,'/api/recruiting-handoff',{**commit,'confirmed':False})
   a.call(400,'/api/recruiting-handoff',{**commit,'preview_hash':'0'*64})
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    profiles=db.execute('SELECT * FROM employees ORDER BY id').fetchall();credentials=db.execute('SELECT * FROM accounts ORDER BY id').fetchall()
    db.execute("CREATE TRIGGER abort_handoff_task BEFORE INSERT ON hr_records WHEN NEW.kind='tasks' BEGIN SELECT RAISE(ABORT,'test assignment failure'); END;")
   a.call(400,'/api/recruiting-handoff',commit)
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM employees ORDER BY id').fetchall()==profiles
    assert not db.execute('SELECT * FROM recruiting_handoffs').fetchall()
    db.execute('DROP TRIGGER abort_handoff_task')
   # Concurrent retries must return one mapping and one set of tasks.
   def commit_handoff(_):
    req=urllib.request.Request(BASE+'/api/recruiting-handoff',data=json.dumps(commit).encode(),headers={'Origin':BASE,'Content-Type':'application/json'})
    with a.http.open(req,timeout=15) as r:return r.status,json.loads(r.read())
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(commit_handoff,range(2)))
   assert sorted(status for status,result in results)==[200,201]
   assert len({result['employee_id'] for status,result in results})==1
   created=results[0][1];new_employee=created['employee_id']
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM accounts ORDER BY id').fetchall()==credentials
    assert db.execute('SELECT count(*) FROM employees').fetchone()[0]==len(profiles)+1
    assert db.execute("SELECT count(*) FROM hr_records WHERE kind='tasks' AND reference_id=?",(created['onboarding_assignment_id'],)).fetchone()[0]==2
   assert not b.call(200,'/api/recruiting-handoff')['handoffs']
   assert a.call(200,'/api/recruiting-handoff',commit)['already_completed']
   # Link another approved hire to an existing employee, keeping credentials and completed tasks.
   a.call(200,body={'action':'assign','applicant_id':hidden,'interviewer_id':aid})
   own_card=next(c for c in a.call(200)['cards'] if c['applicant_id']==hidden)
   a.call(200,body={**score,'card_id':own_card['id']})
   a.call(200,body={**request,'applicant_id':hidden})
   hidden_approval=manager.call(200)['approvals'][0]['id'];manager.call(200,body={**decision,'approval_id':hidden_approval})
   a.call(200,'/api/records/applicants',{'id':hidden,'status':'Hired'},'PATCH')
   existing_id=reviewer.call(200,'/api/operations')['user']['employee_id'];foreign_id=b.call(200,'/api/operations')['user']['employee_id']
   linked={'applicant_id':hidden,'mode':'link','employee_id':existing_id,'start_date':'2026-03-01','template_id':template}
   a.call(400,'/api/recruiting-handoff',{'action':'preview',**linked,'employee_id':foreign_id})
   assigned=a.call(200,'/api/onboarding',{'action':'assign','template_id':template,'employee_ids':[existing_id],'start_date':'2026-03-01'})['assignment_ids'][0]
   task=reviewer.call(200,'/api/records/tasks')['rows'][0];reviewer.call(200,'/api/records/tasks',{'id':task['id'],'status':'Done'},'PATCH')
   reviewed=preview(linked);assert reviewed['existing_assignment_id']==assigned and any(t['status']=='Done' for t in reviewed['tasks'])
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:linked_profiles=db.execute('SELECT * FROM employees ORDER BY id').fetchall();task_count=db.execute("SELECT count(*) FROM hr_records WHERE kind='tasks'").fetchone()[0]
   result=a.call(201,'/api/recruiting-handoff',{'action':'commit',**linked,'confirmed':True,'preview_hash':reviewed['hash'],'access':'admin','role':'Changed role'})
   assert result['employee_id']==existing_id and result['onboarding_assignment_id']==assigned
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT * FROM accounts ORDER BY id').fetchall()==credentials
    assert db.execute('SELECT * FROM employees ORDER BY id').fetchall()==linked_profiles
    assert db.execute("SELECT count(*) FROM hr_records WHERE kind='tasks'").fetchone()[0]==task_count
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
   # Private offer links disclose only the frozen letter and allow one final response.
   oid=applicant('Offer candidate')
   a.call(200,body={'action':'assign','applicant_id':oid,'interviewer_id':aid});offer_card=next(c for c in a.call(200)['cards'] if c['applicant_id']==oid);a.call(200,body={**score,'card_id':offer_card['id']})
   a.call(200,body={**request,'applicant_id':oid});offer_approval=manager.call(200)['approvals'][0]['id'];manager.call(200,body={**decision,'approval_id':offer_approval});a.call(200,'/api/records/applicants',{'id':oid,'status':'Offer'},'PATCH')
   letter_template=a.call(201,'/api/records/templates',{'title':'Candidate offer','body':'Dear {{candidate_name}}, welcome to {{company_name}} as {{role}} on {{start_date}}.\n{{offer_terms}}'})['id']
   issue={'action':'issue','applicant_id':oid,'template_id':letter_template,'start_date':'2026-11-01','expires_days':7,'terms':'Monthly gross NGN 350,000. Full details agreed with HR.','confirmed':True}
   guest.call(401,'/api/offers')
   for c in [reviewer,manager]:c.call(403,'/api/offers');c.call(403,'/api/offers',issue)
   b.call(400,'/api/offers',issue);a.call(403,'/api/offers',issue,origin='https://untrusted.example')
   a.call(400,'/api/offers',{**issue,'confirmed':False})
   offered=a.call(201,'/api/offers',issue);offer_id=offered['id'];raw_token=offered['path'].split('#token=')[1]
   a.call(400,'/api/offers',issue)
   assert not b.call(200,'/api/offers')['offers']
   guest.call(405,'/api/offer-response');guest.call(404,'/api/offer-response',{'action':'view','token':'0'*64})
   guest.call(403,'/api/offer-response',{'action':'view','token':raw_token},origin='https://untrusted.example')
   viewed=guest.call(200,'/api/offer-response',{'action':'view','token':raw_token})['offer'];assert 'Offer candidate' in viewed['letter'] and 'NGN 350,000' in viewed['letter'] and '{{' not in viewed['letter'] and 'email' not in viewed
   assert raw_token not in json.dumps(a.call(200,'/api/offers'))
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT token_hash FROM recruiting_offer_links WHERE offer_id=?',(offer_id,)).fetchone()[0]!=raw_token
   a.call(400,'/api/records/applicants',{'id':oid,'status':'Hired'},'PATCH')
   rotated=a.call(200,'/api/offers',{'action':'rotate','offer_id':offer_id});new_token=rotated['path'].split('#token=')[1]
   guest.call(404,'/api/offer-response',{'action':'view','token':raw_token})
   a.call(200,'/api/offers',{'action':'revoke','offer_id':offer_id});guest.call(404,'/api/offer-response',{'action':'view','token':new_token})
   declined=a.call(201,'/api/offers',issue);declined_token=declined['path'].split('#token=')[1]
   guest.call(200,'/api/offer-response',{'action':'respond','token':declined_token,'decision':'Declined','name':'Candidate Example','confirmed':True})
   a.call(400,'/api/records/applicants',{'id':oid,'status':'Hired'},'PATCH')
   rejected=a.call(201,'/api/offers',issue);rejected_token=rejected['path'].split('#token=')[1]
   a.call(200,'/api/records/applicants',{'id':oid,'status':'Rejected'},'PATCH');guest.call(404,'/api/offer-response',{'action':'view','token':rejected_token})
   a.call(200,'/api/records/applicants',{'id':oid,'status':'Interview'},'PATCH')
   a.call(400,'/api/records/applicants',{'id':oid,'status':'Offer'},'PATCH')
   a.call(200,body={**request,'applicant_id':oid});reopened=manager.call(200)['approvals'][0]['id'];manager.call(200,body={**decision,'approval_id':reopened});a.call(200,'/api/records/applicants',{'id':oid,'status':'Offer'},'PATCH')
   offered=a.call(201,'/api/offers',issue);expired_token=offered['path'].split('#token=')[1]
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:db.execute('UPDATE recruiting_offers SET expires=0 WHERE id=?',(offered['id'],))
   guest.call(404,'/api/offer-response',{'action':'view','token':expired_token})
   offered=a.call(201,'/api/offers',issue);raw_token=offered['path'].split('#token=')[1]
   response={'action':'respond','token':raw_token,'decision':'Accepted','name':'Candidate Example','confirmed':True}
   guest.call(400,'/api/offer-response',{**response,'confirmed':False});guest.call(400,'/api/offer-response',{**response,'name':''})
   def respond(_):
    req=urllib.request.Request(BASE+'/api/offer-response',data=json.dumps(response).encode(),headers={'Origin':BASE,'Content-Type':'application/json'})
    try:r=urllib.request.urlopen(req,timeout=15)
    except urllib.error.HTTPError as e:r=e
    with r:return r.status
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(respond,range(2)))==[200,400]
   guest.call(400,'/api/offer-response',{**response,'decision':'Declined'})
   assert guest.call(200,'/api/offer-response',{'action':'view','token':raw_token})['offer']['status']=='Accepted'
   # A new approval for changed evidence cannot reuse an old accepted offer.
   a.call(200,'/api/records/applicants',{'id':oid,'body':'Changed role evidence'},'PATCH');a.call(200,body={**request,'applicant_id':oid});approval_new=manager.call(200)['approvals'][0]['id'];manager.call(200,body={**decision,'approval_id':approval_new})
   a.call(400,'/api/records/applicants',{'id':oid,'status':'Hired'},'PATCH')
   revised=a.call(201,'/api/offers',{**issue,'terms':'Revised terms reviewed with candidate.'});revised_token=revised['path'].split('#token=')[1]
   guest.call(200,'/api/offer-response',{**response,'token':revised_token});a.call(200,'/api/records/applicants',{'id':oid,'status':'Hired'},'PATCH')
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:assert db.execute('SELECT * FROM accounts ORDER BY id').fetchall()==credentials
   # Withdraw and reassign preserve evidence; former approvers lose access immediately.
   replacement=Client()
   a.call(201,'/api/employees',{'name':'Replacement Manager','email':'replacement@example.test','role':'Manager','department_id':dept,'access':'manager','password':password});replacement.call(200,'/api/auth',{'email':'replacement@example.test','password':password})
   replacement_user=replacement.call(200,'/api/operations')['user'];replacement_id=replacement_user['id']
   control=applicant('Approval controls candidate');a.call(200,body={'action':'assign','applicant_id':control,'interviewer_id':aid});control_card=next(c for c in a.call(200)['cards'] if c['applicant_id']==control);a.call(200,body={**score,'card_id':control_card['id']});a.call(200,body={**request,'applicant_id':control})
   pending=next(v for v in a.call(200)['approvals'] if v['applicant_id']==control)
   reassign={'action':'reassign','approval_id':pending['id'],'approver_id':replacement_id,'note':'The original approver is unavailable.'}
   guest.call(401,body=reassign)
   for c in [reviewer,manager,replacement]:c.call(403,body=reassign)
   b.call(400,body=reassign);a.call(403,body=reassign,origin='https://untrusted.example')
   a.call(400,body={**reassign,'note':''})
   for target in [aid,mid,rid,bid]:a.call(400,body={**reassign,'approver_id':target})
   reassigned=a.call(200,body=reassign)['replacement_id'];history=a.call(200)['approvals'];old=next(v for v in history if v['id']==pending['id']);new_request=next(v for v in history if v['id']==reassigned)
   assert old['display_status']=='Reassigned' and old['status']=='Pending' and old['decision_note']=='' and old['decided'] is None
   assert (new_request['snapshot'],new_request['snapshot_hash'],new_request['requested_by'],new_request['request_note'])==(pending['snapshot'],pending['snapshot_hash'],pending['requested_by'],pending['request_note'])
   assert not any(v['id']==pending['id'] for v in manager.call(200)['approvals']) and not any(c['id']==control for c in manager.call(200)['candidates'])
   manager.call(400,body={**decision,'approval_id':pending['id']})
   replacement.call(200,body={**decision,'approval_id':reassigned})
   a.call(400,body={'action':'withdraw','approval_id':reassigned,'note':'Cannot erase a decision.'});a.call(400,body={**reassign,'approval_id':reassigned,'approver_id':mid})
   # Closing a newer request must not fall back to an older approval.
   a.call(200,body={**request,'applicant_id':control});pending2=next(v for v in a.call(200)['approvals'] if v['applicant_id']==control)
   a.call(200,body={'action':'withdraw','approval_id':pending2['id'],'note':'Candidate review needs to restart.'})
   closed=next(v for v in a.call(200)['approvals'] if v['id']==pending2['id']);assert closed['display_status']=='Withdrawn' and closed['snapshot']==pending2['snapshot']
   a.call(400,'/api/records/applicants',{'id':control,'status':'Offer'},'PATCH')
   a.call(200,body={**request,'applicant_id':control});pending3=next(v for v in a.call(200)['approvals'] if v['applicant_id']==control)
   a.call(200,'/api/records/applicants',{'id':control,'body':'Changed evidence after the request'},'PATCH')
   stale=a.call(200,body={**reassign,'approval_id':pending3['id']})['replacement_id'];replacement.call(400,body={**decision,'approval_id':stale})
   a.call(200,body={'action':'withdraw','approval_id':stale,'note':'Fresh evidence requires a fresh request.'})
   a.call(200,body={**request,'applicant_id':control});racing=next(v for v in a.call(200)['approvals'] if v['applicant_id']==control)
   actions=[{'action':'withdraw','approval_id':racing['id'],'note':'Close this request.'},{**reassign,'approval_id':racing['id']}]
   def manage(body):
    req=urllib.request.Request(BASE+'/api/recruiting',data=json.dumps(body).encode(),headers={'Origin':BASE,'Content-Type':'application/json'})
    try:r=a.http.open(req,timeout=15)
    except urllib.error.HTTPError as e:r=e
    with r:return r.status
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(manage,actions))==[200,400]
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    assert db.execute('SELECT count(*) FROM recruiting_approval_closures WHERE approval_id=?',(racing['id'],)).fetchone()[0]==1
    assert db.execute("SELECT count(*) FROM recruiting_approvals WHERE applicant_id=? AND status='Pending' AND closed_state=''",(control,)).fetchone()[0]<=1
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
   if browser_mode:
    from playwright.sync_api import sync_playwright,expect
    new=applicant('Browser candidate')
    with sync_playwright() as p:
     browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox']);errors=[]
     def page(client):
      context=browser.new_context(viewport={'width':1440,'height':1000});context.add_cookies([{'name':c.name,'value':c.value,'url':BASE} for c in client.jar]);pg=context.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(BASE+'/operations?tab=interviews');expect(pg.get_by_role('heading',name='Interview evidence and hiring decisions',exact=True)).to_be_visible();return pg
     hr=page(a);hr.get_by_label('Interview candidate',exact=True).select_option(str(new));hr.get_by_label('Interview assignee',exact=True).select_option(str(aid));hr.get_by_role('button',name='Assign interview',exact=True).click();expect(hr.get_by_role('status')).to_contain_text('saved')
     for label in ['Role knowledge (1–5)','Problem solving (1–5)','Communication (1–5)']:hr.get_by_label(label,exact=True).fill('4')
     hr.get_by_label('Interview recommendation',exact=True).select_option('Hire');hr.get_by_label('Interview evidence',exact=True).fill('Browser evidence: demonstrated relevant experience.');hr.get_by_role('button',name='Submit final scorecard',exact=True).click();expect(hr.get_by_text('Recommendation: Hire',exact=True)).to_be_visible()
     hr.get_by_label('Hiring approver',exact=True).select_option(str(mid));hr.get_by_label('Hiring rationale',exact=True).fill('Please review the submitted interview evidence.');hr.get_by_role('button',name='Request hiring approval',exact=True).click();expect(hr.get_by_role('heading',name='Pending',exact=False)).to_be_visible()
     browser_request=next(v for v in a.call(200)['approvals'] if v['applicant_id']==new)
     hr.get_by_text(f"Manage unanswered request #{browser_request['id']}",exact=True).click();hr.get_by_label(f"Withdrawal reason for request {browser_request['id']}",exact=True).fill('Restart with the designated reviewer.');hr.get_by_role('button',name=f"Withdraw hiring request #{browser_request['id']}",exact=True).click();expect(hr.get_by_role('heading',name='Withdrawn',exact=False)).to_be_visible()
     hr.get_by_role('button',name='Request hiring approval',exact=True).click();expect(hr.get_by_role('heading',name='Pending',exact=False)).to_be_visible();browser_request=next(v for v in a.call(200)['approvals'] if v['applicant_id']==new)
     hr.get_by_text(f"Manage unanswered request #{browser_request['id']}",exact=True).click();hr.get_by_label(f"Replacement approver for request {browser_request['id']}",exact=True).select_option(str(replacement_id));hr.get_by_label(f"Reassignment reason for request {browser_request['id']}",exact=True).fill('Assign the replacement manager.');hr.get_by_role('button',name=f"Reassign hiring request #{browser_request['id']}",exact=True).click();expect(hr.get_by_role('heading',name='Reassigned',exact=False)).to_be_visible()
     approver=page(replacement);approver.get_by_label('Interview candidate',exact=True).select_option(str(new));approver.get_by_text('Frozen evidence for this request',exact=True).click();expect(approver.get_by_text('Browser evidence: demonstrated relevant experience.',exact=True)).to_be_visible();approver.get_by_label('Hiring decision',exact=True).select_option('Approved');approver.get_by_label('Decision rationale',exact=True).fill('Reviewed the evidence and recommend proceeding.');approver.get_by_role('button',name='Record hiring decision',exact=True).click();expect(approver.get_by_role('heading',name='Approved',exact=False)).to_be_visible()
     approver.set_viewport_size({'width':390,'height':844});assert approver.evaluate('document.documentElement.scrollWidth <= innerWidth')
     a.call(200,'/api/records/applicants',{'id':new,'status':'Offer'},'PATCH')
     hr.goto(BASE+'/operations?tab=offers');hr.get_by_label('Offer candidate',exact=True).select_option(str(new));hr.get_by_label('Offer letter template',exact=True).select_option(str(letter_template));hr.get_by_label('Proposed start date',exact=True).fill('2026-11-01');hr.get_by_label('Offer terms',exact=True).fill('Browser offer terms, as discussed with HR.');hr.get_by_label('I reviewed the template and terms and authorize issuing this letter',exact=True).check();hr.get_by_role('button',name='Issue offer and private link',exact=True).click()
     private_link=hr.get_by_label('Private candidate offer link',exact=True).input_value();candidate_page=browser.new_context(viewport={'width':390,'height':844}).new_page();candidate_page.on('pageerror',lambda e:errors.append(str(e)));candidate_page.goto(private_link)
     expect(candidate_page.get_by_role('heading',name='Offer from Alpha',exact=True)).to_be_visible();assert '#token=' not in candidate_page.url;expect(candidate_page.get_by_text('Browser offer terms, as discussed with HR.',exact=False)).to_be_visible();assert candidate_page.evaluate('document.documentElement.scrollWidth <= innerWidth')
     candidate_page.get_by_label('Your full name',exact=True).fill('Browser Candidate');candidate_page.get_by_label('Your offer response',exact=True).select_option('Accepted');candidate_page.get_by_label('I confirm this is my response to the offer shown above',exact=True).check();candidate_page.get_by_role('button',name='Record my response',exact=True).click();expect(candidate_page.get_by_role('status')).to_contain_text('Accepted')
     a.call(200,'/api/records/applicants',{'id':new,'status':'Hired'},'PATCH')
     hr.goto(BASE+'/operations?tab=recruiting-handoff');expect(hr.get_by_role('heading',name='Review a hired candidate’s handoff',exact=True)).to_be_visible()
     hr.get_by_label('Handoff candidate',exact=True).select_option(str(new));hr.get_by_label('Work email',exact=True).fill('browser-handoff@example.test');hr.get_by_label('Employee department',exact=True).select_option(str(dept));hr.get_by_label('Handoff start date',exact=True).fill('2026-11-01');hr.get_by_label('Handoff onboarding template',exact=True).select_option(str(template))
     hr.get_by_role('button',name='Preview employee handoff',exact=True).click();expect(hr.get_by_role('heading',name='Confirm reviewed handoff',exact=True)).to_be_visible();expect(hr.get_by_text('Meet the team · Due 2026-11-03',exact=False)).to_be_visible()
     hr.get_by_label('I reviewed the employee details and onboarding dates',exact=True).check();hr.get_by_role('button',name='Complete employee handoff',exact=True).click();expect(hr.get_by_role('status')).to_contain_text('Employee handoff completed')
     hr.set_viewport_size({'width':390,'height':844});assert hr.evaluate('document.documentElement.scrollWidth <= innerWidth')
     outsider=page(peer);expect(outsider.get_by_text('No candidates available to your account.',exact=True)).to_be_visible()
     assert not errors,errors;browser.close();print('PASS: recruiting browser assignment, scorecard, delegated approval, private evidence and mobile layout.')
   print(f'PASS: {checks} recruiting HTTP checks; company/interviewer isolation, immutable scores, approval ownership, snapshot invalidation, pipeline bypass prevention and preserved accounts.')
  except Exception:
   log.seek(0);print(log.read()[-5000:]);raise
  finally:server.terminate();server.wait(timeout=10)
