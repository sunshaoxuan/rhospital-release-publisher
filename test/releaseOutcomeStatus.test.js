const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');
const {spawnSync}=require('node:child_process');
const {validateSnapshot,readSupplemental,createOutcomeReader}=require('../src/releaseOutcomeStatus');
const view=require('../public/release-status');
const now=Date.parse('2026-10-27T06:00:00Z');
const imageId='sha256:'+'a'.repeat(64),container='b'.repeat(64),commit='c'.repeat(40);
function snapshot(){return {schemaVersion:1,host:'92.113.124.185',service:'hospital_stack_hospital-backend',sampledAt:new Date(now).toISOString(),image:'hospital-backend:fixture@'+imageId,replicas:1,version:10,updateState:'completed',containers:[{id:container,imageId,image:'hospital-backend:fixture@'+imageId,running:true,health:'healthy'}]};}
function evidence(root){
 const h={id:'history',releaseTarget:'game',status:'RECOVERY_REQUIRED',appTag:'fixture',imageTag:'hospital-backend:fixture',gitCommit:commit,releaseCommit:commit,projectRoot:'C:\\removed\\123-abc'};
 const r={schemaVersion:1,kind:'SUPPLEMENTAL_VERIFICATION',runId:'123-abc',originalHistoryId:h.id,originalStatus:h.status,candidateCommit:commit,candidateTree:'d'.repeat(40),publisherCommit:'e'.repeat(40),imageId,
   historyEvidenceHash:crypto.createHash('sha256').update(JSON.stringify(h)).digest('hex'),baseline:{container,imageId,image:h.imageTag+'@'+imageId,version:10},startedAt:new Date(now-20000).toISOString(),finishedAt:new Date(now-10000).toISOString(),result:'PARTIAL',
   checks:['game-prd2-runtime-contract','verify-game-static-delivery','verify-relations-release'].map(key=>({key,result:'PASS',durationMs:1,outputHash:'f'.repeat(64)})),
   deferredChecks:[{key:'verify-tradepool-release',reason:'container_temporary_compilation_requires_explicit_scope_confirmation'}]};
 const dir=path.join(root,'.supplemental-verifications');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'123-abc-123.json');
 fs.writeFileSync(file,JSON.stringify(r));return {h,r,file};
}
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-status-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

test('read-only status API survives restart without active jobs and preserves original failed history',async t=>{
 const root=temporary(t),{h}=evidence(root),original=JSON.stringify(h);let samples=0;
 const reader=createOutcomeReader(root,{now:()=>now,sample:async()=>{samples++;return snapshot();}});
 const server=http.createServer(async(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await reader([h],{busy:false,job:null})));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await(await fetch('http://127.0.0.1:'+server.address().port+'/api/release-status')).json();
 assert.equal(response.activity.busy,false);assert.equal(response.latestHistory.status,'RECOVERY_REQUIRED');assert.equal(response.deployment.healthy,true);
 assert.equal(response.supplemental.records[0].result,'PARTIAL');assert.equal(response.supplemental.records[0].applicability,'MATCHED');assert.equal(JSON.stringify(h),original);
 const restarted=createOutcomeReader(root,{now:()=>now+1000,sample:async()=>{throw Error('must reuse verified snapshot');}});
 assert.equal((await restarted([h],{busy:false})).deployment.freshness,'CURRENT');assert.equal(samples,1);
 assert.doesNotMatch(JSON.stringify(response),/command|keyPath|Env|password/);
});

test('sampling failure and elapsed snapshots never report current healthy acceptance',async t=>{
 const root=temporary(t),{h}=evidence(root);let time=now;
 const read=createOutcomeReader(root,{now:()=>time,sample:async()=>{if(time!==now)throw Error('private failure');return snapshot();}});
 await read([h],{});time+=121000;const result=await read([h],{});
 assert.equal(result.deployment.freshness,'UNAVAILABLE');assert.equal(result.supplemental.records[0].applicability,'UNKNOWN');
 const html=view.markup(result,time);assert.match(html,/旧快照，当前健康未确认/);assert.match(html,/当前部署身份尚未核实/);assert.doesNotMatch(html,/private failure/);
 const delayed=view.markup({...result,deployment:{...result.deployment,freshness:'CURRENT'}},time);assert.match(delayed,/采样已过期/);
});

test('status cache coalesces refresh requests and rejects malformed or changed runtime identity',async t=>{
 const root=temporary(t);let count=0;const read=createOutcomeReader(root,{now:()=>now,sample:async()=>{count++;await new Promise(r=>setTimeout(r,10));return snapshot();}});
 await Promise.all([read([],{}),read([],{busy:true,job:{id:'active'}})]);assert.equal(count,1);
 for(const change of [s=>s.host='other',s=>s.sampledAt=new Date(now+60000).toISOString(),s=>s.containers.push(s.containers[0])]){const s=snapshot();change(s);assert.throws(()=>validateSnapshot(s,now));}
 const unhealthy=snapshot();unhealthy.containers[0].imageId='sha256:'+'f'.repeat(64);assert.equal(validateSnapshot(unhealthy,now).healthy,false);
});

test('supplemental receipts reject mismatched history, missing gates, duplicate gates and false PASS',t=>{
 const root=temporary(t),{h,r,file}=evidence(root);
 for(const change of [v=>v.historyEvidenceHash='0'.repeat(64),v=>v.checks.pop(),v=>v.checks[1]=v.checks[0],v=>v.result='PASS',v=>v.baseline.imageId='wrong',v=>v.deferredChecks[0].reason='approved',v=>v.finishedAt='invalid']){
   const bad=structuredClone(r);change(bad);fs.writeFileSync(file,JSON.stringify(bad));const result=readSupplemental(root,[h],validateSnapshot(snapshot(),now),now);assert.equal(result.records.length,0);assert.equal(result.invalidCount,1);
 }
 fs.writeFileSync(file,JSON.stringify(r));const changed=snapshot();changed.version++;
 assert.equal(readSupplemental(root,[h],validateSnapshot(changed,now),now).records[0].applicability,'DEPLOYMENT_CHANGED');
 assert.equal(readSupplemental(root,[h],validateSnapshot(snapshot(),now+86400001),now+86400001).records[0].applicability,'STALE');
});

test('UI separates idle plan history deployment and partial acceptance and escapes receipt text',()=>{
 const r={historyId:'h',result:'PARTIAL',applicability:'MATCHED',finishedAt:new Date(now).toISOString(),checks:[{label:'登录',result:'PASS'}],deferred:[{label:'交易池',reason:'待批准 <script>bad</script>'}],receiptFile:'safe.json'};
 const data={activity:{busy:false},deployment:validateSnapshot(snapshot(),now),latestHistory:{id:'h',appTag:'fixture',status:'RECOVERY_REQUIRED'},supplemental:{records:[r]}};data.deployment.freshness='CURRENT';
 const html=view.markup(data,now);assert.match(html,/发布器空闲/);assert.match(html,/下一份计划，未自动执行/);assert.match(html,/RECOVERY_REQUIRED/);assert.match(html,/PARTIAL · 验收尚未闭合/);assert.match(html,/交易池：待批准，未执行/);assert.match(html,/健康快照不等于整体验收通过/);assert.doesNotMatch(html,/<script>/);
 assert.match(view.markup({...data,activity:{busy:true}},now),/发布器有活动任务/);
 assert.match(view.markup({activity:{busy:false},deployment:{freshness:'UNKNOWN'}},now),/尚无已验证健康快照/);
 assert.match(view.supplemental(r,now+86400001),/验收证据已超过24小时/);
});

test('compact UI keeps full identities copyable and warnings visible with closed details',()=>{
 const r={historyId:'history-long',result:'PARTIAL',applicability:'MATCHED',finishedAt:new Date(now).toISOString(),checks:[{label:'运行合同',result:'PASS'}],deferred:[{label:'交易池',reason:'独立临时目录编译 <img src=x onerror=bad>'}],receiptFile:'receipt-'+ 'a'.repeat(180)+'.json'};
 const deployment={...validateSnapshot(snapshot(),now),freshness:'CURRENT'};
 const data={activity:{busy:false},deployment,latestHistory:{id:r.historyId,appTag:'fixture',status:'RECOVERY_REQUIRED'},supplemental:{records:[r]}};
 const html=view.markup(data,now);
 assert.match(html,/value="hospital-backend:fixture@sha256:a{64}"/);
 assert.match(html,/value="receipt-a{180}\.json"/);
 assert.match(html,/aria-label="完整镜像，可选中复制"/);
 assert.match(html,/RECOVERY_REQUIRED/);assert.match(html,/PARTIAL · 验收尚未闭合/);
 assert.match(html,/交易池：待批准，未执行/);assert.match(html,/独立临时目录编译 &lt;img/);
 assert.doesNotMatch(html,/<details[^>]*\sopen\b|<img/);
 assert.match(view.markup({...data,deployment:{...deployment,healthy:false}},now),/健康快照未达标/);
 assert.match(view.markup({...data,deployment:{...deployment,freshness:'UNAVAILABLE'}},now),/本次采样失败/);
 assert.match(view.markup({...data,latestHistory:null,supplemental:{records:[],invalidCount:1}},now),/暂无游戏执行历史/);
 assert.match(view.markup({...data,latestHistory:null,supplemental:{records:[],invalidCount:1}},now),/有无法验证的补验收文件/);
 for(const applicability of ['STALE','DEPLOYMENT_CHANGED','UNKNOWN'])assert.match(view.supplemental({...r,applicability},now),/PASS（历史结果）/);
});

test('status repaint preserves only disclosures for the same evidence identity',()=>{
 const detail=key=>({open:false,getAttribute:()=>key});
 const old=detail('acceptance:history:receipt');old.open=true;
 const same=detail('acceptance:history:receipt'),changed=detail('acceptance:history:other');
 const container={innerHTML:'',querySelectorAll:selector=>selector.endsWith('[open]')?[old]:[same,changed]};
 view.render(container,{activity:{busy:false},deployment:{freshness:'UNKNOWN'}},now);
 assert.equal(same.open,true);assert.equal(changed.open,false);
 assert.match(container.innerHTML,/尚无已验证健康快照/);
});

test('actual runtime sampler reads only selected Docker metadata and rejects concurrent changes',()=>{
 const source=fs.readFileSync(require.resolve('../scripts/read-game-runtime-status.py'),'utf8');
 function run(changed){
   const s=snapshot();const service={version:s.version,image:s.image,replicas:s.replicas,updateState:s.updateState};
   const harness='import json,sys\nfrom unittest.mock import patch\nf=json.load(sys.stdin)\ncalls=0\n'+String.raw`
def read(args,**kw):
    global calls
    assert args[0]=='docker' and args[1] in ('service','ps','inspect')
    assert not any('Env' in a or 'Secret' in a for a in args)
    if args[1]=='service':
        calls+=1
        value=dict(f['service'])
        if calls>1 and f['changed']:value['version']+=1
        return json.dumps(value)
    if args[1]=='ps':return f['container']['id']
    return json.dumps(f['container'])
with patch('subprocess.check_output',side_effect=read):
`+'    exec('+JSON.stringify(source)+')\n';
   return spawnSync(process.platform==='win32'?'python':'python3',['-c',harness],{encoding:'utf8',input:JSON.stringify({service,container:s.containers[0],changed}),timeout:30000,windowsHide:true});
 }
 const good=run(false);assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).containers[0].health,'healthy');
 const bad=run(true);assert.notEqual(bad.status,0);assert.equal(bad.stdout.trim(),'');
});
