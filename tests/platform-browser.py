"""Browser acceptance: signup -> import -> payroll -> mobile employee self-service."""
import datetime, json, os, secrets, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright, expect
base='http://127.0.0.1:3106';password=secrets.token_urlsafe(24)
with tempfile.TemporaryDirectory(prefix='hris-platform-browser-') as directory:
 with open(os.path.join(directory,'server.log'),'w+') as log:
  server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3106'],env={**os.environ,'HRIS_DATA_DIR':directory},stdout=log,stderr=log)
  try:
   for _ in range(80):
    try:
     if urllib.request.urlopen(base+'/login',timeout=3).status==200:break
    except OSError:pass
    time.sleep(.25)
   with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
    admin=browser.new_page(viewport={'width':1440,'height':1000});errors=[];admin.on('pageerror',lambda e:errors.append(str(e)))
    admin.goto(base+'/signup');admin.get_by_label('Company name').fill('Browser Company');admin.get_by_label('Your name').fill('Browser Admin');admin.get_by_label('Work email').fill('browser-admin@example.test');admin.get_by_label('Password',exact=True).fill(password);admin.get_by_role('button',name='Create company',exact=True).click()
    expect(admin.get_by_role('heading',name='Company launch',exact=True)).to_be_visible()
    admin.get_by_role('button',name='Staff import',exact=True).click()
    csv='name,email,role,department,joined,basic,housing,transport,annual_rent,pension,nhf\nBrowser Worker,browser-worker@example.test,Engineer,Engineering,2026-10-01,200000,100000,50000,1200000,true,true\n'
    admin.get_by_label('Staff CSV').set_input_files({'name':'staff.csv','mimeType':'text/csv','buffer':csv.encode()})
    admin.get_by_role('button',name='Preview and validate').click();expect(admin.get_by_text('1 staff rows · 0 errors')).to_be_visible();admin.get_by_role('button',name='Import validated staff').click();expect(admin.get_by_role('heading',name='Staff import',exact=True)).to_be_visible()
    admin.get_by_role('button',name='Payroll & payslips',exact=True).click();expect(admin.get_by_role('heading',name='Payroll readiness',exact=True)).to_be_visible()
    comp=admin.locator('details').filter(has=admin.locator('summary',has_text='Compensation & payroll exclusions'))
    comp.locator('summary').click();comp.get_by_label('Employee',exact=True).select_option(label='Browser Admin');comp.get_by_label('Exclude from payroll',exact=True).select_option('true');comp.get_by_role('button',name='Save compensation').click();expect(admin.get_by_text('2 employee compensation records configured.',exact=False)).to_be_visible()
    admin.get_by_role('button',name='Calculate draft payroll',exact=True).click();expect(admin.get_by_role('heading',name='2026-10 payroll')).to_be_visible();admin.get_by_label('I have reviewed the employee inputs',exact=False).check();admin.get_by_role('button',name='Approve and release payslips',exact=True).click();expect(admin.get_by_text('Approved',exact=True)).to_be_visible()
    admin.get_by_role('button',name='View payslip',exact=True).click();expect(admin.locator('.payslip')).to_contain_text('Browser Worker');admin.locator('.payslip').get_by_role('button',name='Close payslip').click()
    os.makedirs('/tmp/hris-suite-review',exist_ok=True);admin.screenshot(path='/tmp/hris-suite-review/payroll-desktop.png',full_page=True)
    admin.goto(base);admin.get_by_role('button',name='Employees',exact=True).click();admin.get_by_role('button',name='Account access for Browser Worker',exact=True).click();admin.get_by_role('button',name='Create invitation link',exact=True).click();expect(admin.get_by_role('heading',name='Share account link')).to_be_visible();invitation=admin.get_by_label('Secure account link').input_value();admin.get_by_role('button',name='Done',exact=True).click()
    staff=browser.new_context(viewport={'width':390,'height':844}).new_page();staff.on('pageerror',lambda e:errors.append(str(e)))
    staff.goto(invitation);staff.get_by_label('New password',exact=True).fill(password);staff.get_by_label('Confirm new password',exact=True).fill(password);staff.get_by_role('button',name='Save password',exact=True).click();expect(staff.get_by_role('heading',name='Your password is ready.')).to_be_visible();staff.get_by_role('link',name='Continue to sign in').click();staff.get_by_label('Work email').fill('browser-worker@example.test');staff.locator('input[name="password"]').fill(password);staff.get_by_role('button',name='Sign in',exact=True).click();expect(staff.locator('.profile-details')).to_contain_text('Browser Worker')
    staff.get_by_role('button',name='Toggle navigation').click();staff.get_by_role('link',name='HR operations & self-service',exact=False).click();expect(staff.get_by_role('heading',name='Attendance',exact=True)).to_be_visible();staff.get_by_role('button',name='Clock in',exact=True).click();expect(staff.get_by_text('You are currently clocked in.')).to_be_visible();staff.get_by_role('button',name='Clock out',exact=True).click();expect(staff.get_by_text('You are currently clocked out.')).to_be_visible()
    def mobile_tab(name):staff.get_by_role('button',name='Menu',exact=True).click();staff.get_by_role('button',name=name,exact=True).click()
    mobile_tab('Payroll & payslips');staff.get_by_role('button',name='View payslip',exact=True).click();expect(staff.locator('.payslip')).to_contain_text('Browser Worker');assert staff.evaluate('document.documentElement.scrollWidth <= innerWidth');staff.screenshot(path='/tmp/hris-suite-review/payslip-mobile.png',full_page=True)
    staff.goto(base);staff.get_by_role('button',name='Toggle navigation').click();staff.get_by_role('button',name='Leave requests',exact=True).click();staff.get_by_role('button',name='Request leave',exact=True).click();date=datetime.date(2027,1,4)
    while date.weekday()!=0:date+=datetime.timedelta(days=1)
    staff.get_by_label('Start date').fill(str(date));staff.get_by_label('End date').fill(str(date));staff.get_by_label('Reason',exact=True).fill('Mobile leave request');staff.get_by_role('button',name='Submit request').click();expect(staff.get_by_role('dialog')).to_have_count(0);staff.get_by_label('Balance year').select_option('2027');expect(staff.locator('.balance-grid > div').filter(has_text='Annual leave')).to_contain_text('1 pending')
    admin.goto(base+'/operations?tab=courses');admin.get_by_role('button',name='Add record',exact=True).click();admin.get_by_label('Title',exact=True).fill('Browser induction');admin.get_by_label('Details',exact=True).fill('Always protect company data.');admin.get_by_label('Knowledge-check question',exact=True).fill('What must you protect?');admin.get_by_label('Accepted answer (HR only)',exact=True).fill('company data');admin.get_by_role('button',name='Save record',exact=True).click();expect(admin.get_by_role('heading',name='Browser induction',exact=True)).to_be_visible()
    staff.goto(base+'/operations?tab=enrollments');expect(staff.get_by_role('heading',name='My learning',exact=True)).to_be_visible();staff.get_by_role('button',name='Add record',exact=True).click();staff.get_by_label('Title',exact=True).fill('Complete induction');staff.get_by_label('Course',exact=True).select_option(label='Browser induction');staff.get_by_label('Knowledge-check answer',exact=True).fill('company data');staff.get_by_label('Status',exact=True).select_option('Completed');staff.get_by_role('button',name='Save record',exact=True).click();expect(staff.get_by_role('heading',name='Complete induction',exact=True)).to_be_visible();expect(staff.get_by_text('Completed',exact=True)).to_be_visible();assert staff.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors,errors;browser.close();print('PASS: browser company signup, validated staff import, payroll calculation/approval, invitations, mobile payslips, clock in/out, leave request, and learning knowledge check; no browser errors.')
  except Exception:
   log.seek(0);print(log.read()[-6000:]);raise
  finally:server.terminate();server.wait(timeout=10)
