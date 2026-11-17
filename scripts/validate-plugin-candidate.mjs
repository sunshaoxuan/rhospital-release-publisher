import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {validatePluginCandidate}=require('../src/releasePluginCandidate');
const fields=new Map([['repository-root','repositoryRoot'],['phase','phase'],['baseline','baseline'],['commit','commit'],['remote','remote'],
  ['target','target'],['manifest','manifestPath'],['workspace','workspaceRoot'],['receipts','receiptsDirectory'],
  ['dependencies-root','dependencyRoot'],['artifact-root','artifactRoot'],['context-file','contextFile']]);
try {
  const options={};
  for(let i=2;i<process.argv.length;i+=2) {
    const name=process.argv[i].replace(/^--/,''),key=fields.get(name),value=process.argv[i+1];
    if(!key||!process.argv[i].startsWith('--')||!value||Object.hasOwn(options,key))throw new Error('Unknown, missing or duplicate plugin argument');
    options[key]=value;
  }
  if(!options.repositoryRoot||!path.isAbsolute(options.repositoryRoot)||!options.target)throw new Error('Explicit repository root and target required');
  const root=options.repositoryRoot;delete options.repositoryRoot;
  options.contextFile=options.contextFile||process.env.RHOSPITAL_RELEASE_PLUGIN_CONTEXT_FILE;
  if(options.contextFile) {
    if(!path.isAbsolute(options.contextFile))throw new Error('Absolute trusted host context file required');
    options.contextOptions=JSON.parse(fs.readFileSync(options.contextFile,'utf8'));delete options.contextFile;
  }
  options.manifestPath=options.manifestPath||'release/publisher/'+options.target+'.json';
  options.environment=process.env;
  options.write=entry=>process.stderr.write(JSON.stringify(entry)+'\n');
  const result=await validatePluginCandidate(root,options);
  process.stdout.write(JSON.stringify(result)+'\n');
} catch(error) {process.stderr.write('PLUGIN_CANDIDATE_BLOCKED: '+error.message+'\n');process.exitCode=1;}
