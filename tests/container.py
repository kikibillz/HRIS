"""Disposable production container integration checks; no existing volumes touched."""
import json, secrets, subprocess, sys, time, urllib.request, urllib.error
image = sys.argv[1] if len(sys.argv)>1 else 'hris:test'
name = 'hris-test-' + secrets.token_hex(6)
volume = name + '-data'
docker = ['env','-u','DOCKER_HOST','-u','DOCKER_CONTEXT','-u','DOCKER_TLS','-u','DOCKER_TLS_VERIFY','-u','DOCKER_CERT_PATH','docker','--host=unix:///var/run/docker.sock']
def run(*args): return subprocess.check_output(docker+list(args), text=True).strip()
def request(path, body=None, origin='https://hris.example.com', cookie=None):
    headers={'Origin':origin,'Content-Type':'application/json'}
    if cookie: headers['Cookie']=cookie
    req=urllib.request.Request(base+path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try: response=urllib.request.urlopen(req,timeout=10)
    except urllib.error.HTTPError as e: response=e
    return response.status, response.headers, response.read()
def wait():
    for _ in range(90):
        if run('inspect','--format','{{.State.Running}}',name) != 'true':
            raise AssertionError('Container exited before readiness')
        try:
            if request('/api/health/ready')[0]==200:return
        except (OSError,TimeoutError): pass
        time.sleep(1)
    raise AssertionError('Container did not become ready')
try:
    run('volume','create',volume)
    run('run','-d','--name',name,'--read-only','--tmpfs','/tmp','--tmpfs','/mnt/test-backup:uid=1000,gid=1000,mode=0700','--tmpfs','/app/.next/cache:uid=1000,gid=1000','--cap-drop=ALL','--security-opt=no-new-privileges:true','-p','127.0.0.1::3000','-v',volume+':/var/lib/hris','-e','HRIS_PUBLIC_ORIGIN=https://hris.example.com',image)
    port=run('port',name,'3000/tcp').rsplit(':',1)[1]
    base='http://127.0.0.1:'+port
    wait()
    heartbeat="const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync('/var/lib/hris/hris.sqlite',{readOnly:true}); console.log(JSON.stringify(d.prepare('SELECT last_tick FROM onboarding_worker_state WHERE id=1').get()));"
    for _ in range(30):
        if run('exec',name,'node','-e',heartbeat):break
        time.sleep(1)
    assert json.loads(run('exec',name,'node','-e',heartbeat))['last_tick']
    assert request('/api/health/live')[2]==b'{"status":"ok"}'
    body={'company':'Production test','name':'Owner','email':'owner@example.com','password':secrets.token_urlsafe(24)}
    assert request('/api/companies',body,origin='https://evil.example.com')[0]==403
    assert request('/api/companies',body,origin=base)[0]==403
    status,headers,_=request('/api/companies',body)
    assert status==201,status
    assert '; Secure' in headers['Set-Cookie']
    cookie=headers['Set-Cookie'].split(';')[0]
    # Read stored counts directly: production must contain only the new owner.
    query="const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync('/var/lib/hris/hris.sqlite',{readOnly:true}); console.log(JSON.stringify(d.prepare('SELECT count(*) AS n FROM employees').get()));"
    assert json.loads(run('exec',name,'node','-e',query))['n']==1
    before=run('exec',name,'node','-e',"const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync('/var/lib/hris/hris.sqlite',{readOnly:true}); console.log(JSON.stringify(d.prepare('SELECT email,password_hash FROM accounts').all()));")
    # Exercise shipped automation against a separate mounted filesystem in this disposable container.
    setup="const fs=require('node:fs');const crypto=require('node:crypto');const p=fs.mkdtempSync('/tmp/hris-ops-');fs.chmodSync(p,0o700);fs.writeFileSync(p+'/key',crypto.randomBytes(32).toString('base64url'),{mode:0o600});fs.mkdirSync('/mnt/test-backup/archives',{mode:0o700});console.log(p);"
    ops_root=run('exec',name,'node','-e',setup)
    ops_env=['-e','HRIS_BACKUP_DIR=/mnt/test-backup/archives','-e','HRIS_BACKUP_MOUNT=/mnt/test-backup','-e','HRIS_BACKUP_KEY_FILE='+ops_root+'/key','-e','HRIS_MIN_FREE_BYTES=1','-e','HRIS_MONITOR_ORIGIN=http://127.0.0.1:3000']
    backup_report=json.loads(run('exec',*ops_env,name,'node','scripts/backup-maintenance.mjs'))
    assert backup_report['restore_drill'] and backup_report['destination_kind']=='mounted-destination'
    monitor_report=json.loads(run('exec',*ops_env,name,'node','scripts/operations-check.mjs'))
    assert monitor_report['status']=='ok' and monitor_report['checks']['http']['ok']
    run('restart',name)
    port=run('port',name,'3000/tcp').rsplit(':',1)[1]
    base='http://127.0.0.1:'+port
    wait()
    after=run('exec',name,'node','-e',"const {DatabaseSync}=require('node:sqlite'); const d=new DatabaseSync('/var/lib/hris/hris.sqlite',{readOnly:true}); console.log(JSON.stringify(d.prepare('SELECT email,password_hash FROM accounts').all()));")
    assert before==after
    assert request('/api/companies',body)[0]==400
    assert request('/api/health/ready')[1]['Cache-Control']=='no-store'
    print('Production container passed: health, origin protection, Secure cookie, no demo seed, mounted encrypted backup/restore drill, read-only operations checks, persistent account/password hash after restart.')
except Exception:
    subprocess.run(docker+['logs',name],check=False)
    raise
finally:
    subprocess.run(docker+['rm','-f',name],stdout=subprocess.DEVNULL,check=False)
    subprocess.run(docker+['volume','rm',volume],stdout=subprocess.DEVNULL,check=False)
