'use strict';
// Exercise the package users receive, from an isolated global npm prefix.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { name, version } = require('../package.json');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${command} timed out`)); }, 30000);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`${command} exited ${code}\n${stderr}\n${stdout}`));
      else resolve(stdout);
    });
  });
}
async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'logview-package-'));
  let collector;
  try {
    const env = { ...process.env, npm_config_cache: path.join(temporary, 'npm-cache') };
    const pack = JSON.parse(await run('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: path.join(__dirname, '..'), env }))[0];
    const files = pack.files.map(file => file.path);
    for (const required of ['package.json', 'bin/logview.cjs', 'lib/capture.cjs', 'lib/deliver.cjs', 'lib/snapshot.cjs', 'lib/server.cjs', 'web/index.html', 'web/app.js', 'web/style.css', 'web/favicon.svg', 'examples/demo.cjs', 'examples/child.cjs', 'LICENSE', 'README.md']) {
      assert.ok(files.includes(required), `Missing ${required} from tarball`);
    }
    assert.ok(files.every(file => /^(bin\/|lib\/|web\/|examples\/|LICENSE$|README\.md$|CHANGELOG\.md$|package\.json$)/.test(file)), 'Tarball contains only public runtime files and package docs');
    const prefix = path.join(temporary, 'global install with spaces');
    await run('npm', ['install', '--offline', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', path.join(temporary, pack.filename)], { env });
    const command = path.join(prefix, 'bin/logview-local');
    const installed = path.join(prefix, 'lib/node_modules', name);
    assert.equal((await run(command, ['--version'], { env })).trim(), version);
    assert.match(await run(command, ['--help'], { env }), /logview-local npm run dev/);
    assert.match(await run(command, [], { env }), /Logview/);
    const { startServer } = require(path.join(installed, 'lib/server.cjs'));
    collector = await startServer({ port: 0 });
    const consumer = path.join(temporary, 'consumer project'); await fs.mkdir(consumer);
    await run(command, ['run', '--port', String(collector.port), '--project', 'Installed package', '--', process.execPath, '-e', "console.log('Global install works', {deep:{value:42}})"], { cwd: consumer, env });
    await run(command, ['demo', '--port', String(collector.port), '--', '--once'], { cwd: consumer, env });
    const data = await (await fetch(`${collector.url}/api/state`)).json();
    const logs = data.events.filter(event => event.kind === 'log');
    const event = logs.find(event => event.args[0]?.value === 'Global install works');
    assert.ok(event, 'Installed global executable captures an unrelated project');
    assert.equal(event.project, 'Installed package');
    assert.equal(event.args[1].children.find(c => c.key === 'deep').node.children[0].node.value, 42);
    assert.equal(logs.filter(event => event.project === 'Sample shop').length, 23, 'Bundled demo includes every log once');
    console.log(`PASS ${name}@${version}: ${files.length} packaged files; isolated global install; executable and version; capture from a directory with spaces; bundled demo (${logs.length} logs).`);
  } finally {
    if (collector) await collector.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
