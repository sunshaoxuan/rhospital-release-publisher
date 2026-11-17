import {createRequire} from 'node:module';
const {runApplicationNodeCheck}=createRequire(import.meta.url)('../src/applicationNodeCheck');
const keys=new Map([['--root','root'],['--candidate','candidate'],['--check','id'],['--policy-hash','expectedPolicy'],['--timeout','timeoutSeconds'],['--entry-hint','entryHint']]);
try{
 const options={},argv=process.argv.slice(2);let index=0;
 for(;index<argv.length&&argv[index]!=='--';index+=2){const key=keys.get(argv[index]);if(!key||Object.hasOwn(options,key)||!argv[index+1])throw Error('Invalid application check arguments');options[key]=argv[index+1];}
 options.args=argv.slice(index+1);if(options.timeoutSeconds)options.timeoutSeconds=Number(options.timeoutSeconds);
 if(!Number.isInteger(options.timeoutSeconds)||options.timeoutSeconds<1||options.timeoutSeconds>3600)throw Error('Invalid application check timeout');
 const result=runApplicationNodeCheck(options);if(result.marker)console.log(result.marker);console.log(JSON.stringify(result));
}catch(error){console.error(error.message);process.exitCode=1;}
