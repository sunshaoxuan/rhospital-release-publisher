const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:stable(value)).digest('hex');
function receiptStore(root) {
  const keyFile=path.join(root,'receipt.key');
  const target=id=>path.join(root,hash(id)+'.json');
  const regular=file=>fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink();
  const sign=(record,key)=>crypto.createHmac('sha256',key).update(stable(record)).digest('hex');
  return {
    read(identity) {
      try {
        const file=target(identity);
        if(!regular(file)||!regular(keyFile)||fs.statSync(file).size>8*1024*1024)return null;
        const {signature,...record}=JSON.parse(fs.readFileSync(file,'utf8')),key=fs.readFileSync(keyFile);
        if(key.length!==32||!/^[a-f0-9]{64}$/.test(signature||'')
          ||!crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(record,key),'hex'))
          ||stable(record.identity)!==stable(identity)||record.result?.state!=='PASS')return null;
        return record.result;
      }catch{return null;}
    },
    write(identity,result) {
      if(result?.state!=='PASS')throw new Error('Cannot cache incomplete validation');
      fs.mkdirSync(root,{recursive:true});
      if(!fs.existsSync(keyFile))try{fs.writeFileSync(keyFile,crypto.randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
      if(!regular(keyFile))throw new Error('Unsafe receipt key');
      const key=fs.readFileSync(keyFile);if(key.length!==32)throw new Error('Invalid receipt key');
      const record={identity,result,completedAt:new Date().toISOString()},file=target(identity),temp=file+'.'+crypto.randomUUID()+'.tmp';
      try {
        fs.writeFileSync(temp,JSON.stringify({...record,signature:sign(record,key)}),{flag:'wx',mode:0o600});
        fs.renameSync(temp,file);
      }finally{fs.rmSync(temp,{force:true});}
    }
  };
}
module.exports={stable,hash,receiptStore};
