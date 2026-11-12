import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {gate}=createRequire(import.meta.url)('../src/changeValidationGit.js');
try {await gate(root,{repository:'publisher',phase:process.argv[2]==='--push'?'push':'commit',commit:process.argv[3],remote:process.argv[4]});}
catch(error){console.error('CHANGE_GATE_BLOCKED: '+error.message);process.exitCode=1;}
