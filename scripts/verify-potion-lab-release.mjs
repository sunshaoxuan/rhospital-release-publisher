import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SOURCES = [
  'src/main/java/com/zly/hospital/controller/api/HospitalController.java',
  'src/main/java/com/zly/hospital/dto/PotionSynthesisFailurePageDto.java',
  'src/main/java/com/zly/hospital/model/PotionSynthesisFailure.java',
  'src/main/java/com/zly/hospital/repository/PotionSynthesisFailureRepository.java',
  'src/main/java/com/zly/hospital/service/HospitalService.java',
  'src/main/java/com/zly/hospital/service/PotionSynthesisFailureService.java',
  'src/main/java/com/zly/hospital/service/catalog/PotionRecipeCatalogService.java',
  'src/main/resources/static/js/scenes/BasementUIScene.js',
  'src/main/resources/static/js/scenes/utils/PotionLabPopup.js',
  'src/main/resources/static/js/scenes/utils/PotionLabEditorView.js',
  'src/main/resources/static/js/scenes/utils/PotionRecipeEditor.mjs',
  'src/main/resources/static/js/scenes/utils/PotionSynthesisHistoryPopup.js',
  'src/main/resources/static/js/service/userService.js',
  'src/main/resources/static/img/game/ui/popInfo/pop-yaojishiyanshi-sm.png',
  'scripts/migration/20260911_add_potion_synthesis_failure.sql',
  'src/test/js/potionRecipeEditor.test.mjs'
];
export const CHECKS = ['editor', 'failureHistory', 'postgres', 'regression', 'visual', 'finalIntent'];
// Git may check text out as CRLF on Windows and LF in the release container.
export const sha256 = (bytes, filename = '') => crypto.createHash('sha256').update(
  /\.(png|jpe?g|webp|gif)$/i.test(filename) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))
).digest('hex');

function checkedFile(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')) throw new Error('Invalid evidence path');
  const absolute = path.resolve(root, relative);
  const resolvedRoot = fs.realpathSync(root);
  const actual = fs.realpathSync(absolute);
  const inside = path.relative(resolvedRoot, actual);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || !fs.statSync(actual).isFile()) {
    throw new Error('Evidence path escapes project');
  }
  return fs.readFileSync(actual);
}

export function verifyEvidence(root, run = spawnSync) {
  const receipt = JSON.parse(checkedFile(root, 'release/potion-lab-readiness.json').toString('utf8').replace(/^\uFEFF/, ''));
  if (receipt.schemaVersion !== 1 || receipt.result !== 'PASS') throw new Error('Potion lab acceptance is incomplete');
  for (const source of SOURCES) {
    if (receipt.sources?.[source] !== sha256(checkedFile(root, source), source)) throw new Error(`Untested source: ${source}`);
  }
  for (const check of CHECKS) {
    const result = receipt.checks?.[check];
    if (result?.result !== 'PASS' || !Array.isArray(result.evidence) || !result.evidence.length) throw new Error(`Missing acceptance: ${check}`);
    for (const evidence of result.evidence) {
      if (evidence.sha256 !== sha256(checkedFile(root, evidence.path), evidence.path)) throw new Error(`Changed evidence: ${check}`);
    }
  }
  const result = run(process.execPath, ['--test', 'src/test/js/potionRecipeEditor.test.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true
  });
  if (result.error || result.status !== 0) throw new Error('Potion editor state tests failed');
  return { result: 'PASS', sourceCount: SOURCES.length, checkCount: CHECKS.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const index = process.argv.indexOf('--project-root');
  if (index < 0 || !process.argv[index + 1]) throw new Error('--project-root is required');
  console.log(JSON.stringify(verifyEvidence(path.resolve(process.argv[index + 1]))));
}
