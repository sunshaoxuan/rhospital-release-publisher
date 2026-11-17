const fs=require('node:fs'),path=require('node:path');
const links=text=>[...text.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1].replace(/^<|>$/g,''));
function validateDocuments(root,files,{baseFile=()=>'',exists=file=>fs.existsSync(path.resolve(root,file))}={}) {
  for(const file of files) {
    if(!fs.existsSync(path.join(root,file)))continue;
    if(file.endsWith('.png')) {
      const bytes=fs.readFileSync(path.join(root,file));
      if(bytes.length<45||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'
        ||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND')throw new Error('Invalid evidence PNG: '+file);
      continue;
    }
    if(/\.jpe?g$/.test(file)) {
      const bytes=fs.readFileSync(path.join(root,file));
      if(bytes.length<4||bytes.subarray(0,3).toString('hex')!=='ffd8ff'||bytes.subarray(-2).toString('hex')!=='ffd9')throw new Error('Invalid evidence JPEG: '+file);
      continue;
    }
    const text=fs.readFileSync(path.join(root,file),'utf8');
    if(text.includes('\uFFFD')||text.includes('\0'))throw new Error('Invalid document encoding: '+file);
    if(file.endsWith('.json')){JSON.parse(text);continue;}
    const before=new Set(links(baseFile(file)));
    for(const link of links(text)) {
      if(before.has(link)||/^(?:[a-z]+:|#|\/)/i.test(link))continue;
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURI(link.split('#')[0])));
      if(target.startsWith('../')||!exists(target))throw new Error('Broken new document link: '+file+' -> '+target);
    }
  }
  return {state:'PASS',protocol:'documents/v1',files:files.length};
}
module.exports={validateDocuments};
