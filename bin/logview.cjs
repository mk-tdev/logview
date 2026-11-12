#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer } = require('../lib/server.cjs');
const { version } = require('../package.json');

async function main() {
  let args = process.argv.slice(2);
  if (args[0] === '--version' || args[0] === '-v') { console.log(version); return; }
  if (!args.length || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    console.log(`Logview Local ${version} — a local console for Node.js\n\n  logview-local serve                 Start a shared collector\n  logview-local demo                  Run the sample Node app\n  logview-local npm run dev            Capture an existing project\n  logview-local run -- npm run dev     Explicit form\n  logview-local -- node app.js         Run a script\n\nOptions before the command:\n  --port 4317     Collector port (or LOGVIEW_PORT)\n  --project name  Project label\n  --version, -v  Print the installed version\n\nOpen the printed localhost URL. Press Ctrl+C to stop. Node.js 20+ required.\nDocs: https://github.com/mk-tdev/logview#readme`); return;
  }
  let port = Number(process.env.LOGVIEW_PORT || 4317), project = path.basename(process.cwd());
  let mode = 'run';
  if (['serve', 'demo', 'run'].includes(args[0])) mode = args.shift();
  while (args.length && args[0] !== '--') {
    if (args[0] === '--port') { args.shift(); port = Number(args.shift()); }
    else if (args[0] === '--project') { args.shift(); project = args.shift(); }
    else break;
  }
  if (args[0] === '--') args.shift();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  if (typeof project !== 'string' || !project.trim()) throw new Error('Supply a nonempty project name after --project.');
  if (mode === 'run' && !args.length) throw new Error('Supply a command, for example: logview-local run -- npm run dev');
  if (mode === 'demo') { args = [process.execPath, path.join(__dirname, '../examples/demo.cjs'), ...args]; project = 'Sample shop'; }
  let owned, connection;
  const url = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(`${url}/api/connection`, { headers: { 'X-Logview-Client': 'launcher' }, signal: AbortSignal.timeout(500) });
    if (!response.ok) throw new Error('Port is occupied by an incompatible service.');
    connection = await response.json();
    if (typeof connection.token !== 'string') throw new Error('Port is occupied by an incompatible service.');
  } catch (error) {
    if (error.message.includes('incompatible')) throw error;
    owned = await startServer({ port }); connection = owned;
  }
  console.log(`\n  Logview Local  ${url}\n  ${owned ? 'Collector started' : 'Connected to shared collector'}${mode === 'serve' ? '' : ` · ${project}`}\n`);
  let child, stopping = false;
  async function stop(signal) {
    if (stopping) return; stopping = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      if (process.platform !== 'win32') { try { process.kill(-child.pid, signal); } catch {} }
      else child.kill(signal);
      const force = setTimeout(() => {
        if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
        else child.kill('SIGKILL');
      }, 1500);
      await new Promise(resolve => child.once('close', resolve)); clearTimeout(force);
    }
    if (owned) await owned.close();
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
  }
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  if (mode === 'serve') return;
  const preload = path.join(__dirname, '../lib/capture.cjs');
  const env = { ...process.env, LOGVIEW_PORT: String(port), LOGVIEW_TOKEN: connection.token, LOGVIEW_PROJECT: project,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(preload)}`.trim() };
  child = spawn(args[0], args.slice(1), { env, stdio: 'inherit', detached: process.platform !== 'win32', shell: process.platform === 'win32' });
  child.on('error', error => { console.error(`Cannot launch ${args[0]}: ${error.message}`); process.exitCode = 1; if (owned) owned.close(); });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
    if (owned) console.log(`\n  Command finished${code === null ? ` (${signal})` : ` (code ${code})`}. Logs remain at ${url}\n  Press Ctrl+C to close the collector.\n`);
  });
}
main().catch(error => { console.error(`Logview Local: ${error.message}`); process.exitCode = 1; });
