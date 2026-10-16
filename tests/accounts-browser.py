"""Browser account lifecycle: invitations, password changes, and recovery."""
import os
import secrets
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

base='http://127.0.0.1:3104'
password=secrets.token_urlsafe(24)
changed=secrets.token_urlsafe(24)
recovered=secrets.token_urlsafe(24)
with tempfile.TemporaryDirectory(prefix='hris-accounts-browser-') as directory:
    with open(os.path.join(directory,'server.log'),'w+') as log:
        server=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3104'],env={**os.environ,'HRIS_DATA_DIR':directory,'HRIS_ALLOW_SETUP':'1'},stdout=log,stderr=log)
        try:
            for _ in range(80):
                try:
                    if urllib.request.urlopen(base+'/login',timeout=3).status==200:break
                except OSError:pass
                time.sleep(.25)
            else:raise AssertionError('Server unavailable')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
                errors=[]
                def new_page():
                    page=browser.new_context(viewport={'width':1440,'height':1000}).new_page()
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    return page
                admin=new_page();staff=new_page();other_session=new_page()
                admin.goto(base)
                admin.get_by_label('Your name').fill('Account Admin')
                admin.get_by_label('Work email').fill('admin@example.test')
                admin.locator('input[name="password"]').fill(password)
                admin.get_by_role('button',name='Create workspace').click()
                expect(admin.get_by_role('heading',name='A good day starts with your people.')).to_be_visible()
                admin.get_by_role('button',name='Add employee',exact=True).click()
                admin.get_by_label('Full name').fill('Invited Employee')
                admin.get_by_label('Work email').fill('invited@example.test')
                admin.get_by_label('Job title').fill('Engineer')
                admin.get_by_label('Account setup',exact=True).select_option('invite')
                expect(admin.get_by_label('Initial password')).to_have_count(0)
                admin.get_by_role('dialog').get_by_role('button',name='Add employee',exact=True).click()
                expect(admin.get_by_role('heading',name='Share account link')).to_be_visible()
                invitation=admin.get_by_label('Secure account link').input_value()
                assert invitation.startswith(base+'/activate#token=')
                admin.get_by_role('button',name='Done',exact=True).click()
                def set_password(page,link,secret):
                    page.goto(link)
                    expect(page.get_by_role('heading',name='Set your password',exact=True)).to_be_visible()
                    page.get_by_label('New password',exact=True).fill(secret)
                    page.get_by_label('Confirm new password',exact=True).fill(secret)
                    page.get_by_role('button',name='Save password',exact=True).click()
                    expect(page.get_by_role('heading',name='Your password is ready.')).to_be_visible()
                    assert page.evaluate('window.location.hash')==''
                def login(page,secret):
                    page.goto(base+'/login')
                    page.get_by_label('Work email').fill('invited@example.test')
                    page.locator('input[name="password"]').fill(secret)
                    page.get_by_role('button',name='Sign in',exact=True).click()
                    expect(page.locator('.profile-details')).to_contain_text('invited@example.test')
                set_password(staff,invitation,password)
                login(staff,password);login(other_session,password)
                staff.get_by_role('button',name='Account security',exact=True).click()
                staff.get_by_label('Current password',exact=True).fill(password)
                staff.get_by_label('New password',exact=True).fill(changed)
                staff.get_by_label('Confirm new password',exact=True).fill(password)
                staff.get_by_role('button',name='Change password and sign out',exact=True).click()
                expect(staff.locator('p.error[role=alert]')).to_contain_text('do not match')
                staff.get_by_label('Confirm new password',exact=True).fill(changed)
                staff.get_by_role('button',name='Change password and sign out',exact=True).click()
                expect(staff.get_by_role('heading',name='Welcome back.')).to_be_visible()
                other_session.goto(base)
                expect(other_session.get_by_role('heading',name='Welcome back.')).to_be_visible()
                login(staff,changed)
                admin.get_by_role('button',name='Employees',exact=True).click()
                admin.get_by_role('button',name='Account access for Invited Employee',exact=True).click()
                admin.get_by_role('button',name='Create recovery link',exact=True).click()
                expect(admin.get_by_role('heading',name='Share account link')).to_be_visible()
                recovery=admin.get_by_label('Secure account link').input_value()
                admin.get_by_role('button',name='Done',exact=True).click()
                set_password(other_session,recovery,recovered)
                staff.goto(base)
                expect(staff.get_by_role('heading',name='Welcome back.')).to_be_visible()
                staff.get_by_role('button',name='Forgot password?',exact=True).click()
                expect(staff.get_by_role('status')).to_contain_text('workspace administrator')
                login(staff,recovered)
                other_session.goto(recovery)
                other_session.get_by_label('New password',exact=True).fill(password)
                other_session.get_by_label('Confirm new password',exact=True).fill(password)
                other_session.get_by_role('button',name='Save password',exact=True).click()
                expect(other_session.locator('p.error[role=alert]')).to_contain_text('already used')
                staff.set_viewport_size({'width':390,'height':844})
                staff.get_by_role('button',name='Toggle navigation').click()
                staff.get_by_role('button',name='Account security',exact=True).click()
                expect(staff.get_by_role('heading',name='Change password',exact=True)).to_be_visible()
                assert staff.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                assert not errors,errors
                browser.close()
                print('PASS: browser invitation, password confirmation/change, session revocation, admin recovery, link replay error, mobile account security; no browser errors.')
        except Exception:
            log.seek(0);print(log.read()[-5000:]);raise
        finally:
            server.terminate();server.wait(timeout=10)
