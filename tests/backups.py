"""Encrypted tenant archives and full SQLite operator recovery; disposable DBs only."""
import base64,hashlib,http.cookiejar,io,json,os,secrets,sqlite3,subprocess,tempfile,time,urllib.error,urllib.request
BASE='http://127.0.0.1:3108';checks=0;password=secrets.token_urlsafe(24);passphrase=secrets.token_urlsafe(32)
class Client:
 def __init__(self,base=BASE):self.base=base;self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def expect(self,status,path,body=None,method=None,origin=None,raw=None,content='application/json'):
  global checks
  req=urllib.request.Request(self.base+path,data=raw if raw is not None else None if body is None else json.dumps(body).encode(),method=method,headers={'Origin':origin or self.base,'Content-Type':content})
  try:r=self.http.open(req,timeout=30)
  except urllib.error.HTTPError as e:r=e
  with r:
   data=r.read();value=json.loads(data) if r.headers.get('Content-Type','').startswith('application/json') else data
  assert r.status==status,(path,status,r.status,str(value)[:300]);checks+=1;return value
 def document(self,employee):
  boundary='fixture-'+secrets.token_hex(8)
  raw=f'--{boundary}\r\nContent-Disposition: form-data; name="employee_id"\r\n\r\n{employee}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="backup-proof.txt"\r\nContent-Type: text/plain\r\n\r\nCompany A private document\r\n--{boundary}--\r\n'.encode()
  return self.expect(201,'/api/documents',raw=raw,content='multipart/form-data; boundary='+boundary)
def start(directory,port,log):return subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',str(port)],env={**os.environ,'HRIS_DATA_DIR':directory},stdout=log,stderr=log)
def ready(base):
 for _ in range(100):
  try:
   if urllib.request.urlopen(base+'/login',timeout=3).status==200:return
  except OSError:pass
  time.sleep(.2)
 raise AssertionError('Server failed to start')
def crypto(action,payload):
 source="import {encryptBackup,decryptBackup} from './lib/backup-format.ts';import {readFileSync} from 'node:fs';const b=JSON.parse(readFileSync(0,'utf8'));const plain=b.archive?decryptBackup(Buffer.from(b.archive,'base64'),b.passphrase,'company'):Buffer.from(JSON.stringify(b.value));if(b.action==='decrypt')process.stdout.write(plain);else process.stdout.write(encryptBackup(plain,'company',b.passphrase).toString('base64'));"
 run=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',source],input=json.dumps({'action':action,'passphrase':passphrase,**payload}),text=True,capture_output=True,check=True)
 return json.loads(run.stdout) if action=='decrypt' else run.stdout
with tempfile.TemporaryDirectory(prefix='hris-backups-') as directory:
 live=os.path.join(directory,'live');os.mkdir(live);restored=os.path.join(directory,'recovered');archive_path=os.path.join(directory,'operator.hrisbackup')
 env={**os.environ,'HRIS_DATA_DIR':live,'HRIS_BACKUP_PASSPHRASE':passphrase}
 def operator(command,*args,success=True,extra=None):
  run=subprocess.run(['node','scripts/backup.mjs',command,*args],env={**env,**(extra or {})},capture_output=True,text=True,timeout=60)
  if success:
   assert run.returncode==0,run.stderr;return json.loads(run.stdout)
  assert run.returncode!=0,run.stdout;return run.stderr
 with open(os.path.join(directory,'server.log'),'w+') as log:
  server=start(live,3108,log);recovery_server=None
  try:
   ready(BASE);guest,a,b,employee,manager=Client(),Client(),Client(),Client(),Client()
   for c,name,email in [(a,'Backup Alpha','backup-a@example.test'),(b,'Backup Beta','backup-b@example.test')]:c.expect(201,'/api/companies',{'company':name,'name':name+' Admin','email':email,'password':password})
   context=a.expect(200,'/api/operations');company=context['user']['company_id'];aid=context['user']['employee_id']
   beta=b.expect(200,'/api/operations')['user']['company_id']
   a.expect(200,'/api/import',{'action':'commit','csv':'name,email,role,department,joined,basic\nBackup Employee,backup-employee@example.test,Engineer,General,2026-10-01,100000\nBackup Manager,backup-manager@example.test,Lead,General,2026-10-01,100000\n'})
   people=a.expect(200,'/api/operations')['employees'];wid=next(p['id'] for p in people if p['email']=='backup-employee@example.test');mid=next(p['id'] for p in people if p['email']=='backup-manager@example.test')
   for c,eid,email,role in [(employee,wid,'backup-employee@example.test','employee'),(manager,mid,'backup-manager@example.test','manager')]:
    link=a.expect(200,'/api/account-links',{'employee_id':eid,'access':role})['path'];token=link.split('#token=')[1];c.expect(200,'/api/account-links/redeem',{'token':token,'password':password});c.expect(200,'/api/auth',{'email':email,'password':password})
   a.expect(200,'/api/payroll',{'action':'salary','employee_id':aid,'basic':'200000'});a.expect(200,'/api/payroll',{'action':'salary','employee_id':mid,'basic':'0','excluded':True})
   a.expect(200,'/api/payroll',{'action':'draft','period':'2026-11'});run=a.expect(200,'/api/payroll')['runs'][0]['id'];a.expect(200,'/api/payroll',{'action':'approve','run_id':run,'reviewed':True})
   cycle=a.expect(200,'/api/performance',{'action':'create','title':'Recovery cycle','start':'2026-10-01','due':'2026-12-31'})['id']
   a.expect(200,'/api/performance',{'action':'assign','cycle_id':cycle,'reviewer_id':mid,'employee_ids':[wid]})
   assert a.expect(200,'/api/performance',{'action':'remind','cycle_id':cycle})['sent']==1
   assignment=next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==cycle)['assignments'][0]
   manager.expect(200,'/api/records/reviews',{'id':assignment['id'],'body':'Recovery handoff evidence','rating':4},method='PATCH')
   assignment=next(c for c in a.expect(200,'/api/performance')['cycles'] if c['id']==cycle)['assignments'][0]
   a.expect(200,'/api/performance',{'action':'reassign','cycle_id':cycle,'record_id':assignment['id'],'revision':assignment['revision'],'reviewer_id':aid,'reason':'Recovery reassignment fixture'})
   a.expect(200,'/api/records/reviews',{'id':assignment['id'],'status':'Published'},method='PATCH')
   published=next(r for r in employee.expect(200,'/api/records/reviews')['rows'] if r['id']==assignment['id'])
   receipt_body={'record_id':published['id'],'review_hash':published['review_hash'],'confirmed':True}
   assert a.expect(200,'/api/performance',{'action':'remind_acknowledgments','cycle_id':cycle})['sent']==1
   original_receipt=employee.expect(200,'/api/review-acknowledgments',receipt_body)['acknowledgment']
   a.expect(200,'/api/performance',{'action':'close','cycle_id':cycle})
   summary_id=a.expect(200,'/api/performance',{'action':'summarize','cycle_id':cycle})['summary_id']
   frozen_summary=a.expect(200,'/api/performance-summaries?id='+str(summary_id))
   followup_body={'action':'request','record_id':published['id'],'review_hash':published['review_hash'],'request_key':secrets.token_hex(16),'question':'Recovery follow-up question'}
   followup_id=employee.expect(200,'/api/review-followups',followup_body)['id']
   resolution_body={'action':'resolve','request_id':followup_id,'note':'Recovery HR response'}
   a.expect(200,'/api/review-followups',{'action':'escalate','request_id':followup_id,'expected_version':0,'reason':'Recovery escalation evidence'})
   a.expect(200,'/api/review-followups',{'action':'assign','request_id':followup_id,'expected_version':0,'owner_id':context['user']['id'],'due':'2000-01-01','reason':'Recovery ownership evidence'})
   a.expect(200,'/api/review-followups',{'action':'remind_owner','request_id':followup_id,'expected_version':1})
   a.expect(200,'/api/review-followups',resolution_body)
   workload_id=a.expect(200,'/api/review-followup-summaries',{})['id']
   saved_workload=a.expect(200,'/api/review-followup-summaries?id='+str(workload_id))
   a.document(wid)
   # A synthetic frozen offer proves archives preserve letters while excluding/revoking links.
   with sqlite3.connect(os.path.join(live,'hris.sqlite')) as db:
    candidate=db.execute("INSERT INTO hr_records(company_id,kind,title,status,created_by) VALUES (?,'applicants','Recovery fixture','Offer',?)",(company,context['user']['id'])).lastrowid
    offer=db.execute("INSERT INTO recruiting_offers(company_id,applicant_id,approval_hash,snapshot,document_hash,letter,expires,created_by) VALUES (?,?,'fixture','{}','fixture','Preserved frozen offer',?,?)",(company,candidate,int(time.time()*1000)+86400000,context['user']['id'])).lastrowid
    db.execute('INSERT INTO recruiting_offer_links VALUES (?,?,?)',(hashlib.sha256(b'fixture-private-link').hexdigest(),offer,int(time.time()*1000)+86400000))

   create={'action':'create','passphrase':passphrase,'confirmed':True}
   guest.expect(401,'/api/backups');guest.expect(401,'/api/backups',create)
   for c in [employee,manager]:c.expect(403,'/api/backups');c.expect(403,'/api/backups',create);c.expect(403,'/api/backups',{'action':'preview'})
   a.expect(403,'/api/backups',create,origin='https://untrusted.example');a.expect(400,'/api/backups',{**create,'passphrase':'short'});a.expect(400,'/api/backups',{**create,'confirmed':False})
   encrypted=a.expect(200,'/api/backups',create);assert encrypted.startswith(b'HRISBK01') and b'Company A private document' not in encrypted and b'backup-employee@example.test' not in encrypted
   encoded=base64.b64encode(encrypted).decode();plain=crypto('decrypt',{'archive':encoded})
   assert plain['company_id']==company and plain['format']=='hris-company-v1'
   assert all('password_hash' not in account for account in plain['tables']['accounts'])
   for name in ['sessions','account_links','login_attempts','password_attempts','recruiting_offer_links']:assert name not in plain['tables']
   assert plain['tables']['recruiting_offers'][0]['letter']=='Preserved frozen offer'
   assert plain['tables']['performance_cycles'][0]['title']=='Recovery cycle'
   assert plain['tables']['performance_assignments'][0]['employee_id']==wid
   assert plain['tables']['performance_reminders'][0]['reviewer_id']==mid
   assert plain['tables']['review_acknowledgments'][0]['review_hash']==published['review_hash']
   assert plain['tables']['acknowledgment_reminders'][0]['employee_id']==wid
   assert plain['tables']['performance_summaries'][0]['content_hash']==frozen_summary['content_hash']
   assert plain['tables']['review_followups'][0]['question']=='Recovery follow-up question'
   assert plain['tables']['review_followup_resolutions'][0]['note']=='Recovery HR response'
   assert plain['tables']['review_followup_assignments'][0]['due']=='2000-01-01'
   assert plain['tables']['review_followup_assignment_events'][0]['reason']=='Recovery ownership evidence'
   assert len(plain['tables']['review_followup_alerts'])==2 and len(plain['tables']['review_followup_alert_deliveries'])==2
   assert plain['tables']['review_followup_summaries'][0]['content_hash']==saved_workload['content_hash']
   assert json.loads(plain['tables']['review_acknowledgments'][0]['snapshot'])['body']=='Recovery handoff evidence'
   assert json.loads(plain['tables']['performance_reassignments'][0]['snapshot'])['body']=='Recovery handoff evidence'
   text=json.dumps(plain);assert 'backup-b@example.test' not in text and 'Backup Beta' not in text
   assert base64.b64decode(plain['tables']['documents'][0]['bytes']['data'])==b'Company A private document'
   preview=a.expect(200,'/api/backups',{'action':'preview','passphrase':passphrase,'archive':encoded});assert preview['restore_supported'] is False
   assert not next(r for r in preview['comparison'] if r['table']=='employees')['changed']
   b.expect(400,'/api/backups',{'action':'preview','passphrase':passphrase,'archive':encoded})
   forged={**plain,'company_id':beta};b.expect(400,'/api/backups',{'action':'preview','passphrase':passphrase,'archive':crypto('encrypt',{'value':forged})})
   a.expect(400,'/api/backups',{'action':'preview','passphrase':'wrong-secret-123456','archive':encoded})
   tampered=bytearray(encrypted);tampered[-1]^=1;a.expect(400,'/api/backups',{'action':'preview','passphrase':passphrase,'archive':base64.b64encode(tampered).decode()})
   beta_archive=b.expect(200,'/api/backups',create);assert crypto('decrypt',{'archive':base64.b64encode(beta_archive).decode()})['company_id']==beta
   # Leave an unused recovery token in the full backup, then prove recovery revokes it.
   a.expect(200,'/api/account-links',{'employee_id':wid})
   with sqlite3.connect(os.path.join(live,'hris.sqlite')) as db:
    hashes=db.execute('SELECT id,password_hash FROM accounts ORDER BY id').fetchall();frozen=db.execute('SELECT * FROM payroll_items ORDER BY id').fetchall();docs=db.execute('SELECT * FROM documents ORDER BY id').fetchall();assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]>0
   report=operator('create','--output',archive_path);assert report['integrity']=='ok' and report['counts']['accounts']>=4
   assert os.stat(archive_path).st_mode&0o777==0o600
   original_bytes=open(archive_path,'rb').read();assert original_bytes.startswith(b'HRISBK01') and b'Company A private document' not in original_bytes
   operator('create','--output',archive_path,success=False);assert open(archive_path,'rb').read()==original_bytes
   # Web preview cannot inspect a full, cross-company operator backup.
   a.expect(400,'/api/backups',{'action':'preview','passphrase':passphrase,'archive':base64.b64encode(original_bytes).decode()})
   before=operator('preview','--input',archive_path);assert not before['live_data_changed'] and before['differences']==[]
   person=next(p for p in people if p['id']==wid)
   a.expect(200,'/api/people',{'employee_id':wid,'name':person['name'],'role':'Changed after backup','joined':person['joined'],'status':'Active'},method='PATCH')
   comparison=a.expect(200,'/api/backups',{'action':'preview','passphrase':passphrase,'archive':encoded});assert next(r for r in comparison['comparison'] if r['table']=='employees')['changed']
   preview=operator('preview','--input',archive_path);assert any(r['table']=='employees' and r['backup']==r['current'] and r['content_changed'] for r in preview['differences'])
   operator('restore','--input',archive_path,'--output',live,success=False)
   wrong=os.path.join(directory,'wrong-key');operator('restore','--input',archive_path,'--output',wrong,success=False,extra={'HRIS_BACKUP_PASSPHRASE':'wrong-secret-123456'});assert not os.path.exists(wrong)
   damaged=os.path.join(directory,'damaged.hrisbackup');changed=bytearray(original_bytes);changed[-1]^=1;open(damaged,'wb').write(changed);operator('restore','--input',damaged,'--output',wrong,success=False);assert not os.path.exists(wrong)
   corrupt_live=os.path.join(directory,'corrupt-live');os.mkdir(corrupt_live);open(os.path.join(corrupt_live,'hris.sqlite'),'wb').write(b'broken-database')
   valid_preview=operator('preview','--input',archive_path,extra={'HRIS_DATA_DIR':corrupt_live});assert valid_preview['integrity']=='ok' and valid_preview['current_error'] and valid_preview['current_counts'] is None
   assert open(os.path.join(corrupt_live,'hris.sqlite'),'rb').read()==b'broken-database'
   recovered=operator('restore','--input',archive_path,'--output',restored);assert not recovered['live_data_changed'] and recovered['revoked_sessions']>0 and recovered['revoked_unused_links']>0 and recovered['revoked_offer_links']==1
   with sqlite3.connect(os.path.join(restored,'hris.sqlite')) as db:
    assert db.execute('SELECT id,password_hash FROM accounts ORDER BY id').fetchall()==hashes
    assert db.execute('SELECT * FROM payroll_items ORDER BY id').fetchall()==frozen and db.execute('SELECT * FROM documents ORDER BY id').fetchall()==docs
    assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]==0 and db.execute('SELECT COUNT(*) FROM account_links WHERE used_at IS NULL').fetchone()[0]==0
    assert db.execute('SELECT role FROM employees WHERE id=?',(wid,)).fetchone()[0]=='Engineer'
    assert db.execute('SELECT COUNT(*) FROM recruiting_offer_links').fetchone()[0]==0
    assert db.execute('SELECT letter FROM recruiting_offers WHERE id=?',(offer,)).fetchone()[0]=='Preserved frozen offer'
    assert db.execute('SELECT title FROM performance_cycles WHERE id=?',(cycle,)).fetchone()[0]=='Recovery cycle'
    assert db.execute('SELECT employee_id FROM performance_assignments WHERE cycle_id=?',(cycle,)).fetchone()[0]==wid
    assert db.execute('SELECT reviewer_id FROM performance_reminders').fetchone()[0]==mid
    assert db.execute('SELECT review_hash FROM review_acknowledgments').fetchone()[0]==published['review_hash']
    assert db.execute('SELECT employee_id FROM acknowledgment_reminders').fetchone()[0]==wid
    assert db.execute('SELECT content_hash FROM performance_summaries').fetchone()[0]==frozen_summary['content_hash']
    assert db.execute('SELECT question FROM review_followups').fetchone()[0]=='Recovery follow-up question'
    assert db.execute('SELECT note FROM review_followup_resolutions').fetchone()[0]=='Recovery HR response'
    assert db.execute('SELECT due FROM review_followup_assignments').fetchone()[0]=='2000-01-01'
    assert db.execute('SELECT reason FROM review_followup_assignment_events').fetchone()[0]=='Recovery ownership evidence'
    assert db.execute('SELECT COUNT(*) FROM review_followup_alerts').fetchone()[0]==2
    assert db.execute('SELECT COUNT(*) FROM review_followup_alert_deliveries').fetchone()[0]==2
    assert db.execute('SELECT content_hash FROM review_followup_summaries').fetchone()[0]==saved_workload['content_hash']
    assert json.loads(db.execute('SELECT snapshot FROM performance_reassignments').fetchone()[0])['body']=='Recovery handoff evidence'
   with sqlite3.connect(os.path.join(live,'hris.sqlite')) as db:assert db.execute('SELECT role FROM employees WHERE id=?',(wid,)).fetchone()[0]=='Changed after backup'
   recovery_server=start(restored,3109,log);ready('http://127.0.0.1:3109');recovered_client=Client('http://127.0.0.1:3109');recovered_client.expect(200,'/api/auth',{'email':'backup-a@example.test','password':password});assert recovered_client.expect(200,'/api/operations')['company']['name']=='Backup Alpha';assert len(recovered_client.expect(200,'/api/payroll')['items'])==2
   replay=recovered_client.expect(200,'/api/performance',{'action':'remind_acknowledgments','cycle_id':cycle});assert replay['sent']==0 and replay['skipped']==0
   assert recovered_client.expect(200,'/api/performance-summaries?id='+str(summary_id))==frozen_summary
   recovered_employee=Client('http://127.0.0.1:3109');recovered_employee.expect(200,'/api/auth',{'email':'backup-employee@example.test','password':password})
   recovered_receipt=recovered_employee.expect(200,'/api/review-acknowledgments',receipt_body);assert recovered_receipt['already_acknowledged'] and recovered_receipt['acknowledgment']==original_receipt
   assert recovered_employee.expect(200,'/api/review-followups',followup_body)['reused']
   assert recovered_client.expect(200,'/api/review-followups',resolution_body)['reused']
   recovered_inbox=recovered_client.expect(200,'/api/review-followup-inbox')['requests'][0];assert recovered_inbox['due']=='2000-01-01' and recovered_inbox['history'][0]['reason']=='Recovery ownership evidence'
   assert recovered_client.expect(200,'/api/review-followup-summaries?id='+str(workload_id))==saved_workload
   assert recovered_client.expect(200,'/api/review-followup-summaries',{})['reused']
   with sqlite3.connect(os.path.join(live,'hris.sqlite')) as db:assert not db.execute('PRAGMA foreign_key_check').fetchall()
   print(f'PASS: {checks} backup HTTP checks; company isolation, credential exclusion, authenticated encryption, tamper/wrong-key rejection, document preservation, same-count content comparison; consistent operator backup, no overwrite, credential revocation in recovered copy, unchanged live data and original-password login after recovery.')
  except Exception:
   log.seek(0);print(log.read()[-6000:]);raise
  finally:
   if recovery_server:recovery_server.terminate();recovery_server.wait(timeout=10)
   server.terminate();server.wait(timeout=10)
