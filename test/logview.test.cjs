'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { startServer } = require('../lib/server.cjs');
const { snapshot } = require('../lib/snapshot.cjs');
const capture = path.join(__dirname, '../lib/capture.cjs');
const cli = path.join(__dirname, '../bin/logview.cjs');
function childResult(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options); let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Child timed out')); }, 12000);
    child.stdout?.on('data', data => { stdout += data; }); child.stderr?.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stdout, stderr }); });
  });
}
function captured(server, script) {
  return childResult(process.execPath, ['--require', capture, '-e', script], {
    env: { ...process.env, LOGVIEW_PORT: String(server.port), LOGVIEW_TOKEN: server.token, LOGVIEW_PROJECT: 'Integration tests' }
  });
}
const getState = async server => (await fetch(`${server.url}/api/state`)).json();
const logEvents = data => data.events.filter(event => event.kind === 'log');
function child(node, key) { return node.children?.find(item => item.key === key)?.node; }

test('snapshots preserve cycles and types, avoid getters, and bound large data', () => {
  let calls = 0; const obj = { amount: 42n, date: new Date('2026-01-01Z'), map: new Map([['key', { value: 3 }]]), set: new Set([1, 2]), error: new Error('Failed') };
  obj.self = obj; Object.defineProperty(obj, 'computed', { get() { calls++; return 99; } });
  const result = snapshot(obj);
  assert.equal(calls, 0); assert.equal(child(result, 'computed').type, 'accessor');
  assert.equal(child(result, 'self').type, 'reference'); assert.equal(child(result, 'amount').preview, '42n');
  assert.equal(child(result, 'map').type, 'map'); assert.equal(child(result, 'set').type, 'set');
  assert.equal(child(child(result, 'error'), 'message').value, 'Failed');
  assert.equal(snapshot(Array.from({ length: 1000 }, (_, i) => i)).omitted, 900);
  assert.match(snapshot('x'.repeat(100000)).value, /truncated/);
});

test('real console logs are structured snapshots, delivered once, with original output preserved', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const result = await captured(server, `
    const user = { profile: { city: 'Singapore' } };
    console.log('Loaded', user); user.profile.city = 'mutated';
    console.warn('Warning', { stock: 3 });
    console.error(new Error('Payment failed'));
    console.assert(true, 'must not be captured');
    console.assert(false, 'bad total');
    console.time('query'); console.timeEnd('query');
    console.count('hits'); console.count('hits');
    process.stdout.write('raw '); process.stdout.write('line\\n');
    process.stdout.write(JSON.stringify({level: 30, msg: 'Pino style', data: { id: 7 }}) + '\\n');
    process.stderr.write('debug:worker a message\\n');
    const hostile = { toString() { throw new Error('Must not coerce') } };
    console.log('No coercion', hostile);
    Error.prepareStackTrace = () => ({ custom: true });
    process.stdout.write('Custom stack formatter still works\\n');
    console.log('Custom formatter console log');
  `);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Loaded/); assert.match(result.stderr, /Payment failed/);
  const data = await getState(server), logs = logEvents(data);
  assert.equal(logs.filter(e => e.args[0]?.value === 'Loaded').length, 1);
  const loaded = logs.find(e => e.args[0]?.value === 'Loaded');
  assert.equal(child(child(loaded.args[1], 'profile'), 'city').value, 'Singapore');
  assert.equal(logs.some(e => e.args[0]?.value === 'must not be captured'), false);
  assert.equal(logs.filter(e => e.level === 'error').length, 2);
  assert.equal(logs.find(e => e.transport === 'stdout' && e.args[0]?.type === 'object').level, 'info');
  assert.equal(logs.filter(e => e.args[0]?.value === 'raw line').length, 1);
  assert.equal(logs.filter(e => e.level === 'count').length, 2);
  assert.equal(logs.filter(e => e.level === 'timeEnd').length, 1);
  assert.equal(logs.some(e => e.args[0]?.value === 'No coercion'), true);
  assert.equal(logs.some(e => e.args[0]?.value === 'Custom stack formatter still works'), true);
  assert.equal(logs.some(e => e.args[0]?.value === 'Custom formatter console log'), true);
  assert.equal(data.sessions[0].status, 'exited');
});

test('explicit process.exit preserves final logs and exit code; crashes remain crashes', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const abrupt = await captured(server, `console.log('Last log', { final: true }); process.stdout.write('no newline'); process.exit(7);`);
  assert.equal(abrupt.code, 7);
  let logs = logEvents(await getState(server));
  assert.equal(logs.filter(e => e.args[0]?.value === 'Last log').length, 1);
  assert.equal(logs.some(e => e.args[0]?.value === 'no newline'), true);
  const crash = await captured(server, `throw new Error('Uncaught test failure');`);
  assert.equal(crash.code, 1); assert.match(crash.stderr, /Uncaught test failure/);
  logs = logEvents(await getState(server));
  assert.equal(logs.some(e => e.uncaught && e.args[0].type === 'error'), true);
});

test('forked processes and worker threads inherit capture through NODE_OPTIONS', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const script = `
    console.log('parent message');
    require('node:child_process').spawn(process.execPath, ['-e', "console.log('child message', {nested:{ok:true}})"], {stdio:'inherit'});
    new (require('node:worker_threads').Worker)("console.log('worker message', {ok:true})", {eval:true});
  `;
  const result = await childResult(process.execPath, ['-e', script], { env: { ...process.env,
    NODE_OPTIONS: `--require ${JSON.stringify(capture)}`, LOGVIEW_PORT: String(server.port), LOGVIEW_TOKEN: server.token, LOGVIEW_PROJECT: 'Process tree'
  } });
  assert.equal(result.code, 0, result.stderr);
  const data = await getState(server), logs = logEvents(data);
  for (const name of ['parent message', 'child message', 'worker message']) assert.equal(logs.filter(e => e.args[0]?.value === name).length, 1, name);
  assert.equal(new Set(logs.map(e => e.session)).size, 3);
  assert.ok(logs.find(e => e.args[0]?.value === 'worker message').thread > 0);
  assert.equal(logs.filter(e => e.transport && e.args[0]?.value?.includes('worker message')).length, 0, 'Worker forwarding must not become a second raw entry');
});

test('collector authenticates ingestion, rejects browser origins, deduplicates and bounds history', async t => {
  const server = await startServer({ port: 0, maxEvents: 3 }); t.after(() => server.close());
  const makeEvent = i => ({ id: `event-${i}`, session: 'one', project: 'test', pid: 10, level: 'info', kind: 'log', timestamp: new Date().toISOString(), args: [snapshot(i)] });
  const send = (batch, headers = {}) => fetch(`${server.url}/api/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(batch) });
  assert.equal((await send([makeEvent(1)])).status, 401);
  assert.equal((await send([makeEvent(1)], { Authorization: `Bearer ${server.token}`, Origin: 'https://example.com' })).status, 403);
  assert.equal((await fetch(`${server.url}/api/connection`, { headers: { Origin: server.url, 'X-Logview-Client': 'launcher' } })).status, 403);
  assert.equal((await fetch(`${server.url}/api/connection`)).status, 403);
  const auth = { Authorization: `Bearer ${server.token}` };
  await send([makeEvent(1), makeEvent(1), makeEvent(2), makeEvent(3), makeEvent(4)], auth);
  const data = await getState(server);
  assert.deepEqual(data.events.map(e => e.id), ['event-2', 'event-3', 'event-4']);
  assert.equal(data.cursor, 4);
  assert.equal((await send([{}], auth)).status, 200);
  assert.equal((await getState(server)).events.length, 3);
  assert.equal((await fetch(`${server.url}/../package.json`)).status, 404);
});

test('SSE sends initial history and new live entries', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const abort = new AbortController(); t.after(() => abort.abort());
  const response = await fetch(`${server.url}/api/stream`, { signal: abort.signal });
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /event: state/);
  await captured(server, `console.log('streamed message');`);
  let text = '';
  while (!text.includes('streamed message')) {
    const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value);
  }
  assert.match(text, /event: entry/); assert.match(text, /streamed message/);
});

test('CLI reuses collector, labels projects, and returns child exit codes', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const result = await childResult(process.execPath, [cli, 'run', '--port', String(server.port), '--project', 'Other project', '--', process.execPath, '-e', `console.log('CLI captured'); process.exit(4);`]);
  assert.equal(result.code, 4, result.stderr); assert.match(result.stdout, /Connected to shared collector/);
  const logs = logEvents(await getState(server));
  assert.equal(logs.find(e => e.args[0]?.value === 'CLI captured').project, 'Other project');
});

test('sample app runs end to end without importing the tool', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const result = await childResult(process.execPath, [cli, 'demo', '--port', String(server.port), '--', '--once']);
  assert.equal(result.code, 0, result.stderr);
  const logs = logEvents(await getState(server));
  assert.equal(logs.length, 23, 'Each sample log should arrive once, including worker logs');
  const customer = logs.find(e => e.args[0]?.value === 'Customer loaded');
  assert.equal(child(child(child(customer.args[1], 'profile'), 'address'), 'city').value, 'Singapore');
  assert.equal(logs.filter(e => e.args[0]?.value === 'Background job finished').length, 1);
  assert.equal(logs.filter(e => e.args[0]?.value === 'Worker thread connected').length, 1);
});

test('unavailable collector never makes the app crash or hang indefinitely', async () => {
  const server = await startServer({ port: 0 }); const port = server.port; await server.close();
  const start = Date.now();
  const result = await childResult(process.execPath, ['--require', capture, '-e', `console.log('still works');`], { env: { ...process.env, LOGVIEW_PORT: String(port), LOGVIEW_TOKEN: 'unavailable' } });
  assert.equal(result.code, 0); assert.match(result.stdout, /still works/); assert.ok(Date.now() - start < 5000);
});

test('normal npm scripts inherit capture without changing their source or dependencies', async t => {
  const server = await startServer({ port: 0 }); t.after(() => server.close());
  const result = await childResult(process.execPath, [cli, 'run', '--port', String(server.port), '--project', 'npm sample', '--', 'npm', 'run', 'once'], {
    cwd: path.join(__dirname, '../examples'), env: { ...process.env, NODE_OPTIONS: '--no-warnings' }
  });
  assert.equal(result.code, 0, result.stderr);
  const logs = logEvents(await getState(server));
  assert.equal(logs.filter(e => e.args[0]?.value === 'Customer loaded').length, 1);
  assert.equal(logs.find(e => e.args[0]?.value === 'Customer loaded').project, 'npm sample');
  assert.equal(logs.filter(e => e.args[0]?.value === 'Worker thread connected').length, 1);
});
