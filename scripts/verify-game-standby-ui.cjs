const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const [playwrightModule, chromeExecutable, outputDirectory] = process.argv.slice(2);
  const {chromium} = require(playwrightModule);
  const base = 'http://127.0.0.1:18789';
  // A dedicated fixture endpoint prevents this harness from executing a live release.
  const baseline = await (await fetch(`${base}/__test/status`)).json();
  assert.ok(Number.isInteger(baseline.executions) && typeof baseline.finished === 'boolean');
  await fetch(`${base}/__test/finish`, {method: 'POST'});
  fs.mkdirSync(outputDirectory, {recursive: true});
  const browser = await chromium.launch({executablePath: chromeExecutable, headless: true});
  const consoleErrors = [];
  const networkErrors = [];
  const results = [];
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}});
    const page = await context.newPage();
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('requestfailed', request => networkErrors.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) networkErrors.push(response.url()); });
    await page.goto(base);
    await page.locator('#pipeline').getByText('备用接管版本验收', {exact: true}).waitFor();
    for (const [name, width, height] of [['desktop', 1440, 1100], ['mobile', 390, 844]]) {
      await page.setViewportSize({width, height});
      const bounds = await page.evaluate(() => ({width: window.innerWidth, document: document.documentElement.scrollWidth,
        text: document.getElementById('pipeline').innerText}));
      assert.ok(bounds.document <= bounds.width, `${name}: horizontal overflow`);
      assert.ok(bounds.text.indexOf('全链路观察') < bounds.text.indexOf('备用接管版本验收'));
      await page.locator('#pipeline').screenshot({path: path.join(outputDirectory, `${name}.png`)});
      results.push({name, width, height, horizontalOverflow: false, standbyPhaseVisible: true});
    }
    await page.setViewportSize({width: 1440, height: 1100});
    await page.locator('#execute-btn').click();
    await page.waitForFunction(() => document.getElementById('execute-btn').disabled);
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('全量预检发布候选'));
    await page.locator('#pipeline').screenshot({path: path.join(outputDirectory, 'running.png')});
    const active = await (await fetch(`${base}/__test/status`)).json();
    assert.equal(active.executions, baseline.executions + 1);
    await fetch(`${base}/__test/finish`, {method: 'POST'});
    await page.waitForFunction(() => !document.getElementById('execute-btn').disabled);
    await page.locator('#pipeline').screenshot({path: path.join(outputDirectory, 'finished.png')});
    assert.match(await page.locator('#pipeline').innerText(), /备用接管版本验收/);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(networkErrors, []);
    const receipt = {fixture: base, productionOperations: 0, results,
      executionLockedWhileRunning: true, finishedExecutionUnlocked: true,
      consoleErrors, networkErrors, status: 'PASS'};
    fs.writeFileSync(path.join(outputDirectory, 'browser.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
