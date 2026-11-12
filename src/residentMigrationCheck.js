const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const MIGRATION='scripts/migration/20261108_add_resident_reward_ledger.sql';
function docker(...args){return execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000}).trim();}
function dockerIdentity(images) {
  for(const k of Object.keys(process.env))if(/^DOCKER_(?:HOST|CONTEXT|TLS_VERIFY|CERT_PATH)$/i.test(k)&&process.env[k])throw new Error('Docker override rejected for local migration check');
  const context=docker('context','show'),info=JSON.parse(docker('context','inspect',context));
  if(info.length!==1||!/^(?:npipe:\/{4}\.\/pipe\/|unix:\/\/\/)/.test(info[0].Endpoints?.docker?.Host||''))throw new Error('Local Docker endpoint required');
  const engine=JSON.parse(docker('info','--format','{{json .}}'));
  if(engine.OSType!=='linux')throw new Error('Linux Docker engine required');
  return {context,server:engine.ServerVersion,images:Object.fromEntries(images.map(i=>[i,docker('image','inspect',i,'--format','{{.Id}}')]))};
}
async function runResident(root,images) {
  const migration=fs.readFileSync(path.join(root,MIGRATION),'utf8'),pre=fs.readFileSync(path.join(root,'scripts/validation/resident-reward/schema-preflight-readonly.sql'),'utf8'),audit=fs.readFileSync(path.join(root,'scripts/validation/resident-reward/schema-readonly.sql'),'utf8');
  const block=s=>s.match(/do \$resident_precondition\$[\s\S]*?end \$resident_precondition\$;/)?.[0];
  if(!block(migration)||block(migration)!==block(pre)||block(migration)!==block(audit))throw new Error('Migration/pre/post admission differs');
  const versions=[];let cases=0;
  for(const [n,image] of images.entries()) {
    const name='r34-schema-check-'+crypto.randomUUID(),version=n===0?'18.6':'16.';
    const mount=n===0?'/var/lib/postgresql:rw':'/var/lib/postgresql/data:rw';let created=false;
    const pg=(sql,ok=true)=>{
      const r=spawnSync('docker',['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
      if(r.error||r.signal||(ok&&r.status!==0))throw new Error('Isolated SQL check failed: '+(r.error?.message||r.stderr));
      return r;
    };
    try {
      docker('run','--rm','--detach','--name',name,'--label','rhospital.task=impact-validation','--network','none','--tmpfs',mount,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image);created=true;
      let ready=false;
      for(let i=0;i<30;i++){
        if(spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{windowsHide:true,stdio:'ignore',timeout:5000}).status===0){ready=true;break;}
        await new Promise(r=>setTimeout(r,200));
      }
      if(!ready)throw new Error('Isolated PostgreSQL not ready');
      const actual=pg('show server_version;').stdout.trim();if(!actual.startsWith(version))throw new Error('Unexpected test engine version');versions.push(actual);
      const reset=()=>pg('drop schema public cascade; create schema public; create table t_hospitals(id bigint primary key);');
      const state=()=>pg("select md5(string_agg(c.relname||con.conname||pg_get_constraintdef(con.oid,true),',' order by c.relname,con.conname)) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';").stdout;
      reset();pg(pre);pg(migration);pg(audit);const initial=state();pg(migration);pg(audit);if(state()!==initial)throw new Error('Migration not idempotent');cases+=3;
      const mutations=[
        ['alter table t_resident_reward_account add constraint bad_check check(ordinary_issued>=0);','Unexpected resident constraint'],
        ['alter table t_resident_reward_account add constraint bad_fk foreign key(hospital_id) references t_hospitals(id);','Unexpected resident constraint'],
        ['create unique index bad_unique on t_resident_reward_receipt(fingerprint);','Unexpected resident constraint'],
        ['alter table t_resident_reward_day drop constraint uk_resident_reward_day;','primary/unique index conflict'],
        ['alter table t_resident_reward_account alter column version_id drop not null;','shape conflict'],
        ['alter table t_resident_reward_receipt add column unexpected text;','shape conflict'],
        ["alter table t_resident_reward_receipt drop column result_json; alter table t_resident_reward_receipt add column result_json text generated always as ('bad') stored not null;",'shape conflict']
      ];
      for(const [mutate,expected] of mutations){
        reset();pg(migration);pg(mutate);const before=state(),bad=pg(migration,false);
        if(!bad.status||!bad.stderr.includes(expected)||state()!==before||!pg(audit,false).status)throw new Error('Corrupt schema acceptance/rollback failed');cases++;
      }
      reset();pg('create table t_resident_reward_receipt(id text);');
      if(!pg(migration,false).status||pg("select count(*) from pg_class where relname in ('t_resident_reward_account','t_resident_reward_day');").stdout.trim()!=='0')throw new Error('Partial DDL was not rolled back');cases++;
      const wrong=pg('create schema wrong; set search_path=wrong;\n'+pre,false);
      if(!wrong.status||!wrong.stderr.includes('public schema'))throw new Error('Wrong schema accepted');cases++;
    } finally {
      if(created){docker('stop',name);if(spawnSync('docker',['inspect',name],{windowsHide:true,stdio:'ignore'}).status===0)throw new Error('SQL helper cleanup failed');}
    }
  }
  return {state:'PASS',protocol:'resident-schema/v1',versions,cases,production:false,helpersRemoved:true};
}
module.exports={runResident,dockerIdentity};
