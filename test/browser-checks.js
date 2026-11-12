// Run against the running sample with Playwright CLI:
// playwright-cli open http://127.0.0.1:4317
// playwright-cli run-code --filename test/browser-checks.js
async page => {
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  const search = page.getByRole('searchbox', { name: 'Search logs' });
  await page.getByRole('option').filter({ hasText: 'Customer loaded' }).waitFor();
  await page.getByRole('button', { name: 'Ⅱ Pause', exact: true }).click();
  await search.fill('Singapore');
  assert(await page.getByRole('option').count() === 1, 'Search includes collapsed nested values');
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  assert(await page.getByText('city:"Singapore"', { exact: true }).isVisible(), 'Nested objects expand to capture-time values');
  assert(!(await page.locator('#values').innerText()).includes('Changed AFTER'), 'Later object mutations do not alter snapshots');
  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  assert(await page.locator('#values details[open]').count() === 0, 'Collapse closes every branch');
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  assert(await page.locator('#values details:not([open])').count() === 0, 'Expand opens every captured branch');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4317' });
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  await page.getByRole('status').filter({ hasText: 'Snapshot JSON copied' }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(JSON.parse(copied)[1].type === 'object', 'Copy JSON produces a structured snapshot');
  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ Export' }).click();
  const download = await downloadWait;
  await download.saveAs('output/playwright/export.json');
  assert(download.suggestedFilename().endsWith('.json'), 'Export downloads filtered log JSON');
  await search.fill('');
  await page.getByRole('button', { name: /^Errors / }).click();
  assert(await page.getByRole('option').count() === 2, 'Error filter isolates errors and failed assertions');
  await page.getByRole('button', { name: /^Warnings / }).click();
  assert(await page.getByRole('option').count() >= 1, 'Warning filter shows warnings');
  await page.getByRole('button', { name: 'Debug', exact: true }).click();
  assert(await page.getByRole('option').count() >= 1, 'Debug filter shows debug messages');
  await page.getByRole('button', { name: 'Output', exact: true }).click();
  assert(await page.getByRole('option').count() >= 2, 'Output filter shows raw stream writes');
  await page.getByRole('button', { name: /^All \d/ }).click();
  const billing = page.getByRole('button', { name: /^Billing \d/ });
  if (await billing.count()) {
    await billing.click();
    assert(await page.getByRole('option').count() === 1, 'Project filter isolates the second Node app');
    assert((await page.getByRole('option').innerText()).includes('Invoice delayed'), 'Second-project log is inspectable');
    await page.getByRole('button', { name: /^▤.*All projects/ }).click();
  }
  const beforePause = await page.getByRole('option').count();
  await page.waitForTimeout(6500);
  assert(await page.getByRole('option').count() === beforePause, 'Pause freezes the displayed log stream');
  await page.getByRole('button', { name: /^▶ Resume/ }).click();
  await page.waitForTimeout(100);
  assert(await page.getByRole('option').count() > beforePause, 'Resume includes logs captured while paused');
  await page.getByRole('button', { name: 'Clear view' }).click();
  assert(await page.getByRole('option').count() === 0, 'Clear view hides existing logs');
  await page.reload();
  await page.getByRole('option').filter({ hasText: 'Customer loaded' }).waitFor();
  assert(await page.getByRole('option').count() > 0, 'Reload restores collector history');
  await page.getByRole('checkbox', { name: 'Follow' }).uncheck();
  await page.getByRole('option').filter({ hasText: 'Customer loaded' }).click();
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout fits without horizontal page overflow');
  await page.screenshot({ path: 'output/playwright/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const bounds = await page.evaluate(() => ({ stream: document.querySelector('.stream').getBoundingClientRect().bottom, panes: document.querySelector('.panes').getBoundingClientRect().bottom }));
  assert(bounds.stream <= bounds.panes + 1, 'Desktop stream scrolls inside its panel');
  await page.screenshot({ path: 'output/playwright/desktop.png' });
  assert(errors.length === 0, `No browser runtime errors (${errors.length})`);
  return { passed: results.length, checks: results };
}
