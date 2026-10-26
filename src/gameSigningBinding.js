const fs=require('node:fs');
const path=require('node:path');

function readGameSigningApproval(env=process.env) {
  const file=env.RELEASE_PUBLISHER_CONFIG || path.resolve(__dirname,'../release-publisher.config.json');
  const approval=JSON.parse(fs.readFileSync(file,'utf8')).gameStartup?.signingSecret || null;
  if (!approval) return null;
  if (Object.keys(approval).sort().join(',')!=='gid,mode,secretName,source,target,uid' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(approval.secretName) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(approval.target) || !/^[A-Za-z0-9_]{1,128}$/.test(approval.source) || approval.uid!=='0' || approval.gid!=='0' || approval.mode!==256) throw new Error('Invalid publisher-owned signing reference approval');
  return {...approval};
}

const SIGNING_BINDING_SCRIPT=String.raw`
import copy, json, re

def signing_normalized(root, live, approval):
    root, live = copy.deepcopy(root), copy.deepcopy(live)
    service = root['services']['hospital-backend']
    environment = service.get('environment', {})
    entries = live.get('Env', [])
    actual = dict(item.split('=',1) for item in entries)
    if len(actual)!=len(entries):
        raise ValueError('duplicate_live_environment')
    candidate_file = environment.get('AUTH_TOKEN_SECRET_FILE')
    live_file = actual.get('AUTH_TOKEN_SECRET_FILE')
    if candidate_file is None and live_file is None:
        return root, live, None
    if not approval or set(approval)!={'secretName','target','source','uid','gid','mode'}:
        raise ValueError('signing_reference_not_approved')
    if any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}',approval[key]) for key in ('secretName','target')):
        raise ValueError('invalid_signing_reference_approval')
    if not re.fullmatch(r'[A-Za-z0-9_]{1,128}',approval['source']) or approval['uid']!='0' or approval['gid']!='0' or approval['mode']!=256:
        raise ValueError('invalid_signing_permission_approval')
    expected_path='/run/secrets/'+approval['target']
    if candidate_file!=expected_path or live_file not in (None,expected_path) or 'AUTH_TOKEN_SECRET' in environment or 'AUTH_TOKEN_SECRET' in actual:
        raise ValueError('signing_source_conflict_or_unapproved_path')
    def name(item):
        return root.get('secrets',{}).get(item['source'],{}).get('name',item['source'])
    matches=[item for item in service.get('secrets',[]) if item.get('target')==approval['target'] or name(item)==approval['secretName']]
    if len(matches)!=1 or matches[0].get('source')!=approval['source'] or matches[0].get('target')!=approval['target'] or name(matches[0])!=approval['secretName']:
        raise ValueError('signing_secret_mapping_missing_extra_or_duplicate')
    mapping=matches[0]
    if root.get('secrets',{}).get(mapping['source'],{}).get('external') is not True or mapping.get('mode')!=approval['mode'] or str(mapping.get('uid','0'))!=approval['uid'] or str(mapping.get('gid','0'))!=approval['gid']:
        raise ValueError('signing_secret_must_be_existing_and_read_only')
    live_matches=[item for item in live.get('Secrets',[]) if item.get('File',{}).get('Name')==approval['target'] or item.get('SecretName')==approval['secretName']]
    if live_file is not None:
        if len(live_matches)!=1 or live_matches[0].get('SecretName')!=approval['secretName'] or live_matches[0].get('File',{}).get('Name')!=approval['target']:
            raise ValueError('live_signing_mapping_mismatch')
        actual_file=live_matches[0]['File']
        if str(actual_file.get('UID','0'))!=approval['uid'] or str(actual_file.get('GID','0'))!=approval['gid'] or actual_file.get('Mode')!=approval['mode']:
            raise ValueError('live_signing_permission_mismatch')
    elif live_matches:
        raise ValueError('live_signing_source_ambiguous')
    service['environment'].pop('AUTH_TOKEN_SECRET_FILE')
    service['secrets']=[item for item in service.get('secrets',[]) if item is not mapping]
    live['Env']=[item for item in entries if not item.startswith('AUTH_TOKEN_SECRET_FILE=')]
    live['Secrets']=[item for item in live.get('Secrets',[]) if item not in live_matches]
    return root, live, mapping

def candidate_signing_container(root, live, approval, read):
    normalized, baseline, mapping=signing_normalized(root,live,approval)
    service=normalized['services']['hospital-backend']
    expected={key:str(value) for key,value in service.get('environment',{}).items() if key!='IMAGE_TAG'}
    actual=dict(item.split('=',1) for item in baseline.get('Env',[]) if not item.startswith('IMAGE_TAG='))
    if expected!=actual:
        raise ValueError('candidate_environment_drift')
    expected_secrets=sorted((normalized.get('secrets',{}).get(item['source'],{}).get('name',item['source']),item['target']) for item in service.get('secrets',[]))
    actual_secrets=sorted((item['SecretName'],item['File']['Name']) for item in baseline.get('Secrets',[]))
    if expected_secrets!=actual_secrets:
        raise ValueError('candidate_unrelated_secret_drift')
    container=copy.deepcopy(live)
    container['Env']=[key+'='+str(value) for key,value in root['services']['hospital-backend'].get('environment',{}).items()]
    if mapping:
        secret=read('secret','inspect',approval['secretName'])[0]
        if secret.get('Spec',{}).get('Name')!=approval['secretName'] or not secret.get('ID'):
            raise ValueError('approved_signing_secret_unavailable')
        container['Secrets']=[item for item in container.get('Secrets',[]) if item.get('SecretName')!=approval['secretName']]
        container['Secrets'].append({'SecretID':secret['ID'],'SecretName':approval['secretName'],'File':{'Name':approval['target'],'UID':str(mapping.get('uid','0')),'GID':str(mapping.get('gid','0')),'Mode':mapping.get('mode',292)}})
    return container
`;

function signingPrelude(approval=readGameSigningApproval()) {
  return SIGNING_BINDING_SCRIPT+'\nAPPROVED_SIGNING='+JSON.stringify(approval).replace(/^null$/,'None')+'\n';
}

function gameSigningValidationViewCommands(approval=readGameSigningApproval()) {
  const script=signingPrelude(approval)+String.raw`
import subprocess, sys
try:
    with open(sys.argv[1],encoding='utf-8') as source:
        root=json.load(source)
    live=json.loads(subprocess.check_output(['docker','service','inspect',sys.argv[3]],timeout=15))[0]['Spec']['TaskTemplate']['ContainerSpec']
    normalized, _, mapping=signing_normalized(root,live,APPROVED_SIGNING)
    if mapping:
        secret=json.loads(subprocess.check_output(['docker','secret','inspect',APPROVED_SIGNING['secretName']],timeout=15))[0]
        if secret.get('Spec',{}).get('Name')!=APPROVED_SIGNING['secretName']:
            raise ValueError()
    with open(sys.argv[2],'w',encoding='utf-8') as target:
        json.dump(normalized,target)
except Exception:
    print('game_signing_binding=FAIL action=verify_publisher_approved_reference_and_candidate_mapping')
    sys.exit(1)
`;
  return [`printf %s "${Buffer.from(script).toString('base64')}" | base64 -d | python3 - "$compose_contract_file" "$compose_contract_view" "$service_name"`];
}
module.exports={readGameSigningApproval,signingPrelude,gameSigningValidationViewCommands,SIGNING_BINDING_SCRIPT};
