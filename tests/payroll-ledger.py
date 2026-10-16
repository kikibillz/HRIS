"""Disposable-database integration tests for opening balances, YTD and review evidence."""
import csv, hashlib, zipfile, http.cookiejar, io, json, os, secrets, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request
BASE='http://127.0.0.1:3107';password=secrets.token_urlsafe(24);checks=0
class Client:
 def __init__(self):self.http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 def expect(self,status,path,body=None,origin=BASE):
  global checks
  req=urllib.request.Request(BASE+path,data=None if body is None else json.dumps(body).encode(),headers={'Origin':origin,'Content-Type':'application/json'})
  try:r=self.http.open(req,timeout=15)
  except urllib.error.HTTPError as e:r=e
  with r:
   raw=r.read();data=json.loads(raw) if r.headers.get('Content-Type','').startswith('application/json') else raw if r.headers.get('Content-Type','').startswith('application/zip') else raw.decode(errors='replace')
  assert r.status==status,(path,status,r.status,str(data)[:500]);checks+=1;return data
 def payroll(self,status,**body):return self.expect(status,'/api/payroll',body)
 def opening(self,status,**body):return self.expect(status,'/api/payroll-ledger',body)
with tempfile.TemporaryDirectory(prefix='hris-ytd-') as directory:
 with open(os.path.join(directory,'server.log'),'w+') as log:
  env={**os.environ,'HRIS_DATA_DIR':directory}
  def start():return subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3107'],env=env,stdout=log,stderr=log)
  def wait():
   for _ in range(80):
    try:
     if urllib.request.urlopen(BASE+'/login',timeout=3).status==200:return
    except OSError:pass
    time.sleep(.25)
   raise AssertionError('Test server did not start')
  server=start()
  try:
   wait();guest,admin,other,worker,manager=Client(),Client(),Client(),Client(),Client()
   for c,name,email in [(admin,'YTD Company','admin@ytd.test'),(other,'Other Company','admin@other.test')]:c.expect(201,'/api/companies',{'company':name,'name':name+' Admin','email':email,'password':password})
   context=admin.expect(200,'/api/operations');company=context['user']['company_id'];aid=context['user']['employee_id'];oid=other.expect(200,'/api/operations')['user']['employee_id']
   imported=admin.expect(200,'/api/import',{'action':'commit','csv':'name,email,role,department,joined,basic,pension\nYTD Worker,worker@ytd.test,Engineer,Payroll,2026-10-01,200000,true\nYTD Manager,manager@ytd.test,Lead,Payroll,2026-10-01,200000,true\n'})
   people=admin.expect(200,'/api/operations')['employees'];wid=next(p['id'] for p in people if p['email']=='worker@ytd.test');mid=next(p['id'] for p in people if p['email']=='manager@ytd.test')
   # Invitations use real lifecycle routes and sessions; no account/password mutation in SQLite.
   for c,eid,email,role in [(worker,wid,'worker@ytd.test','employee'),(manager,mid,'manager@ytd.test','manager')]:
    link=admin.expect(200,'/api/account-links',{'employee_id':eid,'purpose':'invite','access':role})
    from urllib.parse import urlparse
    token=urlparse(link['path']).fragment
    # Invitation URL fragments carry the token; the redemption endpoint expects it directly.
    if token.startswith('token='):token=token[6:]
    c.expect(200,'/api/account-links/redeem',{'token':token,'password':password})
    c.expect(200,'/api/auth',{'email':email,'password':password})
   admin.payroll(200,action='salary',employee_id=aid,basic='0',excluded=True)
   admin.payroll(200,action='salary',employee_id=mid,basic='0',excluded=True)
   opening={'action':'opening','employee_id':wid,'through_period':'2026-09','gross':'1800000','paye':'90000','pension':'144000','employer_pension':'180000','nhf':'0','nhis':'0','other_deductions':'0','employer_ecs':'18000','employer_itf':'0','reviewed_by':'Fictional Reviewer','reference':'Fixture source payroll Jan–Sep','confirmed':True}
   guest.expect(401,'/api/payroll-ledger');guest.opening(401,**opening)
   for c in [worker,manager]:
    c.opening(403,**opening);c.expect(403,'/api/payroll-ledger?format=csv');c.expect(404,f'/api/payroll-ledger?employee_id={aid}');assert len(c.expect(200,'/api/payroll-ledger')['rows'])==1
   other.opening(404,**opening);admin.opening(404,**{**opening,'employee_id':oid})
   admin.expect(403,'/api/payroll-ledger',opening,origin='https://untrusted.example')
   for override in [{'confirmed':False},{'reviewed_by':''},{'reference':''},{'through_period':'2025-12'},{'through_period':'2026-12'},{'through_period':'2026-00'},{'gross':'1'},{'gross':'-1'},{'paye':'1.001'}]:admin.opening(400,**{**opening,**override})
   admin.expect(400,'/api/payroll-ledger?period=2027-01');admin.expect(404,'/api/payroll-ledger?employee_id=bad')
   admin.opening(200,**opening)
   assert len(admin.expect(200,'/api/payroll-ledger')['events'])==1
   own=worker.expect(200,'/api/payroll-ledger?period=2026-09');assert not own['openings'] and not own['events'];assert 'reference' not in own['rows'][0]['opening'];assert own['rows'][0]['totals']['gross']==180000000 and own['rows'][0]['totals']['paye']==9000000
   assert admin.expect(200,f'/api/payroll-ledger?period=2026-08&employee_id={wid}')['rows'][0]['totals']['gross']==0
   admin.opening(200,action='clear_opening',employee_id=wid);admin.opening(200,**opening);assert len(admin.expect(200,'/api/payroll-ledger')['events'])==3
   admin.payroll(400,action='draft',period='2026-09');assert not admin.expect(200,'/api/payroll')['runs']
   admin.payroll(200,action='draft',period='2026-10');draft=admin.expect(200,'/api/payroll');run=draft['runs'][0]['id'];item=next(i for i in draft['items'] if i['employee_id']==wid);frozen=json.loads(item['details'])
   assert frozen['ytd_before']['totals']['gross']==180000000 and frozen['ytd_after']['gross']==200000000
   assert frozen['ytd_after']['paye']==9000000+frozen['paye'];assert 'reference' not in frozen['ytd_before']['opening']
   assert worker.expect(200,'/api/payroll-ledger?period=2026-10')['rows'][0]['totals']['gross']==180000000
   admin.opening(400,**opening);admin.opening(400,action='clear_opening',employee_id=wid)
   admin.payroll(400,action='draft',period='2026-11')
   admin.payroll(400,action='record_review',run_id=run,reviewed_by='Fictional Reviewer',reference='External evidence',confirmed=True)
   admin.payroll(200,action='discard',run_id=run);admin.opening(200,**opening)
   admin.payroll(200,action='draft',period='2026-10');draft=admin.expect(200,'/api/payroll');run=draft['runs'][0]['id'];frozen=json.loads(next(i['details'] for i in draft['items'] if i['employee_id']==wid))
   admin.payroll(200,action='approve',run_id=run,reviewed=True)
   admin.opening(400,**opening);admin.opening(400,action='clear_opening',employee_id=wid)
   row=worker.expect(200,'/api/payroll-ledger?period=2026-10')['rows'][0];assert row['totals']['gross']==200000000 and row['unrecorded_periods']==[] and len(row['entries'])==1
   assert row['totals']['net']+row['totals']['total_deductions']==row['totals']['gross']
   admin.payroll(200,action='record_payment',run_id=run,reference='BANK-FIXTURE')
   assert worker.expect(200,'/api/payroll-ledger?period=2026-10')['rows'][0]['totals']==row['totals']
   evidence={'action':'record_review','run_id':run,'reviewed_by':'Fictional External Accountant','reference':'TEST-EVIDENCE-ONLY','notes':'Not a real accountant approval.','confirmed':True}
   for c in [worker,manager]:c.payroll(403,**evidence)
   other.payroll(400,**evidence);admin.payroll(400,**{**evidence,'confirmed':False});admin.payroll(400,**{**evidence,'reference':''})
   admin.payroll(200,**evidence);admin.payroll(400,**evidence)
   reviews=admin.expect(200,'/api/payroll')['reviews'];assert len(reviews)==1 and reviews[0]['reference']=='TEST-EVIDENCE-ONLY' and len(reviews[0]['snapshot_hash'])==64
   assert not worker.expect(200,'/api/payroll')['reviews'] and not other.expect(200,'/api/payroll')['reviews']
   # Validate the fingerprint directly against the persisted policy and item snapshots.
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:
    policy=db.execute('SELECT period,policy FROM payroll_runs WHERE id=?',(run,)).fetchone();items=db.execute('SELECT employee_id,details FROM payroll_items WHERE run_id=? ORDER BY employee_id',(run,)).fetchall()
    content={'run':dict(zip(['period','policy'],policy)),'items':[dict(zip(['employee_id','details'],i)) for i in items]}
    assert hashlib.sha256(json.dumps(content,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==reviews[0]['snapshot_hash']
   admin.payroll(200,action='draft',period='2026-11');nov=next(r['id'] for r in admin.expect(200,'/api/payroll')['runs'] if r['period']=='2026-11')
   assert worker.expect(200,'/api/payroll-ledger?period=2026-11')['rows'][0]['totals']['gross']==200000000
   admin.payroll(200,action='approve',run_id=nov,reviewed=True)
   latest=worker.expect(200,'/api/payroll-ledger?period=2026-11')['rows'][0];assert latest['totals']['gross']==220000000
   assert next(i for i in worker.expect(200,'/api/payroll')['items'] if i['run_id']==run)['details']==next(i for i in draft['items'] if i['employee_id']==wid)['details']
   export=list(csv.DictReader(io.StringIO(admin.expect(200,'/api/payroll-ledger?period=2026-11&format=csv'))));assert next(r for r in export if r['employee_id']==str(wid))['gross_kobo']=='220000000'
   assert 'worker@ytd.test' not in other.expect(200,'/api/payroll-ledger?format=csv')
   admin.payroll(400,action='draft',period='2026-08')
   # Export packs block missing identifiers, preserve leading zeros, and freeze sources.
   for c in [guest,worker,manager]:
    c.expect(401 if c is guest else 403,f'/api/payroll-exports?run_id={nov}')
    c.expect(401 if c is guest else 403,'/api/payroll-exports',{'action':'create','run_id':nov,'kind':'bank','confirmed':True})
   other.expect(400,f'/api/payroll-exports?run_id={nov}')
   readiness=admin.expect(200,f'/api/payroll-exports?run_id={nov}');assert readiness['errors']
   admin.expect(400,'/api/payroll-exports',{'action':'create','run_id':nov,'kind':'bank','confirmed':True})
   profile={'action':'profile','run_id':nov,'employee_id':wid,'bank':'Fixture Bank','bank_account':'0123456789','bank_code':'011','tax_id':'TAX-FIXTURE','pension_id':'PIN-FIXTURE','nhf_id':'','tax_authority':'Lagos','reference':'Reviewed fixture identifiers','confirmed':True}
   admin.expect(403,'/api/payroll-exports',profile,origin='https://untrusted.example')
   admin.expect(400,'/api/payroll-exports',{**profile,'employee_id':oid});other.expect(400,'/api/payroll-exports',profile)
   admin.expect(400,'/api/payroll-exports',{**profile,'bank_account':'123'});admin.expect(400,'/api/payroll-exports',{**profile,'confirmed':False})
   admin.expect(200,'/api/payroll-exports',profile)
   settings=readiness['settings'];settings['columns']=[{'header':'Payee','field':'beneficiary'},{'header':'Account','field':'account_number'},{'header':'Amount','field':'amount'},{'header':'Code','field':'bank_code'}]
   settings['employer'].update(tax_id='EMPLOYER-TAX',pension_reference='EMPLOYER-PENSION',ecs_reference='EMPLOYER-ECS')
   admin.expect(400,'/api/payroll-exports',{'action':'settings',**{**settings,'columns':[{'header':'oops','field':'amount'}]}})
   badcols=[{**c,'header':' =HYPERLINK("x")'} if i==0 else c for i,c in enumerate(settings['columns'])]
   admin.expect(400,'/api/payroll-exports',{'action':'settings',**{**settings,'columns':badcols}})
   admin.expect(200,'/api/payroll-exports',{'action':'settings',**settings})
   bank_artifact=admin.expect(200,'/api/payroll-exports',{'action':'create','run_id':nov,'kind':'bank','confirmed':True})['id']
   bank_bytes=admin.expect(200,f'/api/payroll-exports?artifact_id={bank_artifact}')
   with zipfile.ZipFile(io.BytesIO(bank_bytes)) as archive:
    assert archive.testzip() is None
    bank_csv=archive.read('bank-schedule.csv').decode();rows=list(csv.DictReader(io.StringIO(bank_csv)))
    assert list(rows[0])==['Payee','Account','Amount','Code'] and rows[0]['Account']=='0123456789' and rows[0]['Code']=='011' and rows[0]['Amount']=='166400.00'
    manifest=json.loads(archive.read('manifest.json'));assert hashlib.sha256(archive.read('bank-schedule.csv')).hexdigest()==manifest['file_sha256']['bank-schedule.csv']
   other.expect(404,f'/api/payroll-exports?artifact_id={bank_artifact}');worker.expect(403,f'/api/payroll-exports?artifact_id={bank_artifact}')
   admin.expect(200,'/api/payroll-exports',{**profile,'bank_account':'9999999999','reference':'Second reviewed fixture'})
   assert admin.expect(200,f'/api/payroll-exports?artifact_id={bank_artifact}')==bank_bytes
   statutory_artifact=admin.expect(200,'/api/payroll-exports',{'action':'create','run_id':nov,'kind':'statutory','confirmed':True})['id']
   with zipfile.ZipFile(io.BytesIO(admin.expect(200,f'/api/payroll-exports?artifact_id={statutory_artifact}'))) as archive:
    assert archive.testzip() is None and 'contributions.csv' in archive.namelist()
    assert list(csv.DictReader(io.StringIO(archive.read('paye.csv').decode())))[0]['paye_ngn']=='17600.00'
    assert 'not certified' in archive.read('README.txt').decode()
   # External salary and statutory receipts use frozen payroll obligations.
   receipt={'action':'record','run_id':nov,'obligation':'salary','employee_id':wid,'amount':'100000','reference':'SALARY-ALLOCATION-1','paid_on':'2026-10-16','note':'Fixture bank evidence','confirmed':True}
   for c in [guest,worker,manager]:
    c.expect(401 if c is guest else 403,f'/api/payroll-settlements?run_id={nov}')
    c.expect(401 if c is guest else 403,'/api/payroll-settlements',receipt)
   other.expect(400,f'/api/payroll-settlements?run_id={nov}');other.expect(400,'/api/payroll-settlements',receipt)
   admin.expect(403,'/api/payroll-settlements',receipt,origin='https://untrusted.example')
   for change in [{'confirmed':False},{'amount':'0'},{'amount':'-1'},{'amount':'184000.01'},{'amount':'1.001'},{'reference':''},{'paid_on':'2099-01-01'},{'paid_on':'2026-02-30'},{'employee_id':oid},{'obligation':'unknown'}]:admin.expect(400,'/api/payroll-settlements',{**receipt,**change})
   original_slip=next(i['details'] for i in worker.expect(200,'/api/payroll')['items'] if i['run_id']==nov)
   initial=admin.expect(200,f'/api/payroll-settlements?run_id={nov}');assert initial['salary_outstanding']==16640000
   # Record a partial salary, then protect its outstanding balance and whole-batch path.
   admin.expect(200,'/api/payroll-settlements',receipt)
   admin.expect(400,'/api/payroll-settlements',receipt)
   admin.payroll(400,action='record_payment',run_id=nov,reference='WHOLE-BATCH-DUPLICATE')
   admin.expect(400,'/api/payroll-settlements',{**receipt,'reference':'OVERPAY','amount':'100000'})
   admin.expect(200,'/api/payroll-settlements',{**receipt,'reference':'SALARY-ALLOCATION-2','amount':'66400'})
   assert next(r for r in admin.expect(200,'/api/payroll')['runs'] if r['id']==nov)['status']=='Paid'
   summary=admin.expect(200,f'/api/payroll-settlements?run_id={nov}');assert summary['salary_outstanding']==0
   assert next(o for o in summary['obligations'] if o['key']=='pension')['due']==3600000
   statutory={**receipt,'obligation':'paye','employee_id':None,'amount':'5000','reference':'PAYE-RECEIPT-1'}
   admin.expect(200,'/api/payroll-settlements',statutory)
   summary=admin.expect(200,f'/api/payroll-settlements?run_id={nov}');assert next(o for o in summary['obligations'] if o['key']=='paye')['outstanding']==1260000
   first=next(r for r in summary['records'] if r['reference']=='SALARY-ALLOCATION-1')
   correction={'action':'void','run_id':nov,'settlement_id':first['id'],'reason':'Fixture correction; no bank refund','confirmed':True}
   admin.expect(400,'/api/payroll-settlements',{**correction,'reason':''});other.expect(400,'/api/payroll-settlements',correction)
   admin.expect(200,'/api/payroll-settlements',correction);admin.expect(400,'/api/payroll-settlements',correction)
   assert next(r for r in admin.expect(200,'/api/payroll')['runs'] if r['id']==nov)['status']=='Approved'
   admin.expect(400,'/api/payroll-settlements',receipt)
   admin.expect(200,'/api/payroll-settlements',{**receipt,'reference':'SALARY-CORRECTED-3'})
   assert next(i['details'] for i in worker.expect(200,'/api/payroll')['items'] if i['run_id']==nov)==original_slip
   exported=list(csv.DictReader(io.StringIO(admin.expect(200,f'/api/payroll-settlements?run_id={nov}&format=csv'))));assert next(r for r in exported if r['obligation']=='salary')['outstanding_kobo']=='0'
   legacy=admin.expect(200,f'/api/payroll-settlements?run_id={run}');assert legacy['legacy']['reference']=='BANK-FIXTURE' and legacy['salary_outstanding']==0
   admin.expect(400,'/api/payroll-settlements',{**receipt,'run_id':run,'reference':'LEGACY-DOUBLE'})
   admin.expect(400,'/api/payroll-settlements',{**statutory,'run_id':run,'reference':'BANK-FIXTURE'})
   assert any(r['voided_at'] for r in admin.expect(200,f'/api/payroll-settlements?run_id={nov}')['records'])
   assert admin.expect(200,f'/api/payroll-exports?artifact_id={bank_artifact}')==bank_bytes
   assert 'No outstanding salary' in ' '.join(admin.expect(200,f'/api/payroll-exports?run_id={nov}')['errors'])
   admin.expect(400,'/api/payroll-exports',{'action':'create','run_id':nov,'kind':'bank','confirmed':True})
   # Opt-in cumulative PAYE uses server-owned opening/released totals, not client priors.
   cumulative={'action':'preview_cumulative','employee_id':wid,'period':'2026-12','paye_method':'cumulative','history_confirmed':True,'review_note':'TEST cumulative calendar-month method evidence'}
   for c in [guest,worker,manager]:c.payroll(401 if c is guest else 403,**cumulative)
   other.payroll(404,**cumulative)
   admin.expect(403,'/api/payroll',cumulative,origin='https://untrusted.example')
   admin.payroll(400,**{**cumulative,'history_confirmed':False});admin.payroll(400,**{**cumulative,'reviewed_paye':'0'})
   calculated=admin.payroll(200,**{**cumulative,'prior':{'totals':{'gross':1,'paye':0}}})
   assert calculated['ready_for_draft'] and calculated['paye']==8600000 and calculated['working']['previous_paye']==12520000
   assert calculated['working']['cumulative_tax']==21120000
   saved_input={**cumulative,'action':'adjustment'}
   admin.payroll(200,**saved_input)
   admin.payroll(200,action='draft',period='2026-12');dec=next(r['id'] for r in admin.expect(200,'/api/payroll')['runs'] if r['period']=='2026-12')
   decitem=next(i for i in admin.expect(200,'/api/payroll')['items'] if i['run_id']==dec and i['employee_id']==wid);decdata=json.loads(decitem['details'])
   assert decdata['paye']==calculated['paye'] and decdata['cumulative']['previous_paye']==12520000
   assert decdata['ytd_after']['paye']==21120000 and decdata['adjustment']['paye_method']=='cumulative'
   admin.payroll(400,**{**saved_input,'bonus':'1'})
   assert len(worker.expect(200,'/api/payroll')['items'])==2
   admin.payroll(200,action='approve',run_id=dec,reviewed=True)
   assert json.loads(next(i['details'] for i in worker.expect(200,'/api/payroll')['items'] if i['run_id']==dec))['cumulative']['cumulative_tax']==21120000
   compare=json.load(open('public/payroll-cumulative-cases.json'));assert admin.payroll(200,action='compare',cases=compare)['all_passed']
   # A company without reviewed prior-month coverage cannot infer zero income.
   other.payroll(200,action='salary',employee_id=oid,basic='200000')
   foreign_preview={**cumulative,'employee_id':oid}
   assert 'complete prior-month history' in other.payroll(400,**foreign_preview)['error']
   # Missing history also blocks an actual draft; the transaction leaves no partial run.
   other.payroll(200,**{**foreign_preview,'action':'adjustment'})
   other.payroll(400,action='draft',period='2026-12');assert not other.expect(200,'/api/payroll')['runs']
   # Refunds and excessive catch-up deductions are review blockers, not automatic payments.
   refund_opening={**opening,'employee_id':oid,'through_period':'2026-11','gross':'2200000','pension':'176000','paye':'300000'}
   other.opening(200,**refund_opening)
   refund=other.payroll(200,**foreign_preview);assert not refund['ready_for_draft'] and refund['working']['refund_due']==8880000
   other.payroll(400,action='draft',period='2026-12');assert not other.expect(200,'/api/payroll')['runs']
   other.opening(200,**{**refund_opening,'gross':'10000000','pension':'0','paye':'0'})
   excessive=other.payroll(200,**foreign_preview);assert not excessive['ready_for_draft'] and excessive['net']<0
   other.payroll(400,action='draft',period='2026-12');assert not other.expect(200,'/api/payroll')['runs']
   # Restart against the same disposable DB to verify ledger and review persistence.
   server.terminate();server.wait(timeout=10);server=start();wait()
   assert worker.expect(200,'/api/payroll-ledger?period=2026-11')['rows'][0]['totals']==latest['totals']
   assert admin.expect(200,'/api/payroll')['reviews']==reviews
   with sqlite3.connect(os.path.join(directory,'hris.sqlite')) as db:assert not db.execute('PRAGMA foreign_key_check').fetchall()
   print(f'PASS: {checks} ledger HTTP checks; opening validation, role/company isolation, overlap prevention, draft exclusion, chronology, immutable YTD snapshots, exact exports, review fingerprints and persistence.')
  except Exception:
   log.seek(0);print(log.read()[-6000:]);raise
  finally:server.terminate();server.wait(timeout=10)
