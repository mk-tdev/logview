'use strict';
const http = require('node:http');
const path = require('node:path');
const util = require('node:util');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { threadId } = require('node:worker_threads');
const { StringDecoder } = require('node:string_decoder');
const { fileURLToPath } = require('node:url');
const { snapshot } = require('./snapshot.cjs');

if (process.env.LOGVIEW_PORT && process.env.LOGVIEW_TOKEN && !globalThis[Symbol.for('logview.capture')]) {
  globalThis[Symbol.for('logview.capture')] = true;
  const session = randomUUID();
  const metadata = { session, project: process.env.LOGVIEW_PROJECT || path.basename(process.cwd()), pid: process.pid,
    thread: threadId, cwd: process.cwd(), command: process.argv.slice(1).join(' ') };
  let serial = 0, depth = 0, group = 0, scheduled = false, inFlight = [], queue = [], queuedBytes = 0, dropped = 0, stopped = false, failures = 0;
  const sizes = new WeakMap();
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const timers = new Map(), counts = new Map();
  function stackLines() {
    try { const stack = new Error().stack; return typeof stack === 'string' ? stack.split('\n') : []; }
    catch { return []; }
  }
  function source() {
    const lines = stackLines().slice(2);
    for (const line of lines) {
      if (line.includes(__dirname) || line.includes('node:')) continue;
      const match = line.match(/(?:\(|at )((?:file:\/\/)?[^()]+):(\d+):(\d+)\)?$/);
      if (match) {
        let file = match[1];
        if (file.startsWith('file://')) { try { file = fileURLToPath(file); } catch { continue; } }
        if (path.isAbsolute(file)) return { file, line: Number(match[2]), column: Number(match[3]) };
      }
    }
    return null;
  }
  function record(level, args, extra = {}) {
    if (stopped) return;
    try {
      const entry = { ...metadata, id: `${session}:${++serial}`, timestamp: new Date().toISOString(),
        kind: 'log', level, group, source: source(), args: snapshot(args).children?.map(child => child.node) || [], ...extra };
      if (dropped) { entry.droppedBefore = dropped; dropped = 0; }
      sizes.set(entry, Buffer.byteLength(JSON.stringify(entry)) + 1);
      queue.push(entry); queuedBytes += sizes.get(entry);
      // Bounded queue: capture must never grow without limit when the viewer is unavailable.
      while (queue.length > 500 || queuedBytes > 4 * 1024 * 1024) { queuedBytes -= sizes.get(queue.shift()); dropped++; }
      if (!scheduled && !inFlight.length) { scheduled = true; setImmediate(flush); }
    } catch { /* Inspecting unusual values must not break the application. */ }
  }
  function takeBatch() {
    const batch = []; let size = 2;
    while (queue.length && batch.length < 50) {
      const nextSize = sizes.get(queue[0]);
      if (size + nextSize > 1500000 && batch.length) break;
      const entry = queue.shift(); queuedBytes -= nextSize;
      if (nextSize <= 1500000) { batch.push(entry); size += nextSize; }
    }
    return batch;
  }
  function flush() {
    scheduled = false;
    if (inFlight.length || !queue.length || stopped) return;
    inFlight = takeBatch();
    if (!inFlight.length) return;
    const body = JSON.stringify(inFlight);
    const req = http.request({ host: '127.0.0.1', port: Number(process.env.LOGVIEW_PORT), path: '/api/ingest', method: 'POST', agent,
      headers: { Authorization: `Bearer ${process.env.LOGVIEW_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      res.resume();
      res.on('end', () => finish(res.statusCode !== 200));
    });
    let finished = false;
    function finish(failed) {
      if (finished) return; finished = true;
      if (failed && ++failures < 3) { queue.unshift(...inFlight); queuedBytes += inFlight.reduce((sum, event) => sum + sizes.get(event), 0); }
      if (!failed) failures = 0;
      inFlight = [];
      if (queue.length) { scheduled = true; setTimeout(flush, failed ? 100 : 0); }
    }
    req.setTimeout(700, () => req.destroy()); req.on('error', () => finish(true)); req.end(body);
  }
  const methods = ['log', 'info', 'debug', 'warn', 'error', 'dir', 'dirxml', 'table', 'trace', 'assert', 'group', 'groupCollapsed', 'groupEnd', 'count', 'countReset', 'time', 'timeLog', 'timeEnd', 'clear'];
  for (const method of methods) {
    const original = console[method];
    if (typeof original !== 'function') continue;
    console[method] = function (...args) {
      if (depth) return Reflect.apply(original, this, args);
      depth++;
      try {
        let values = args, emit = true, level = method;
        // Normal logs must not coerce objects or invoke their custom toString().
        const label = ['time', 'timeLog', 'timeEnd', 'count', 'countReset'].includes(method) ? String(args[0] ?? 'default') : '';
        if (method === 'groupEnd') { group = Math.max(0, group - 1); emit = false; }
        if (method === 'time') { if (!timers.has(label)) timers.set(label, performance.now()); emit = false; }
        if (method === 'timeEnd' || method === 'timeLog') {
          values = timers.has(label) ? [`${label}: ${(performance.now() - timers.get(label)).toFixed(3)} ms`, ...args.slice(1)] : [`Timer '${label}' does not exist`];
          if (method === 'timeEnd') timers.delete(label);
        }
        if (method === 'count') { counts.set(label, (counts.get(label) || 0) + 1); values = [`${label}: ${counts.get(label)}`]; }
        if (method === 'countReset') { counts.delete(label); emit = false; }
        if (method === 'assert') { emit = !args[0]; values = ['Assertion failed:', ...args.slice(1)]; level = 'error'; }
        if (method === 'dir') values = args.slice(0, 1);
        if (method === 'clear') emit = false;
        const extra = method === 'trace' ? { trace: stackLines().filter(line => !line.includes(__dirname)).join('\n') } : {};
        if (emit) record(level, values, extra);
        if (method === 'group' || method === 'groupCollapsed') group++;
        return Reflect.apply(original, this, args);
      } finally { depth--; }
    };
  }
  const pendingLines = [];
  for (const [stream, level] of [[process.stdout, 'stdout'], [process.stderr, 'stderr']]) {
    const original = stream.write;
    const decoder = new StringDecoder('utf8'); let pending = '';
    function emitLine(line) {
      if (!line) return;
      const clean = util.stripVTControlCharacters(line.replace(/\r$/, ''));
      let value = clean, resolved = level;
      try {
        value = JSON.parse(clean);
        if (value && typeof value === 'object') {
          const candidate = value.level;
          resolved = ({ 10: 'debug', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'error' })[candidate] ||
            (['debug', 'info', 'warn', 'error'].includes(candidate) ? candidate : level);
        }
      } catch {}
      record(resolved, [value], { transport: level });
    }
    pendingLines.push(() => { pending += decoder.end(); if (pending) { emitLine(pending); pending = ''; } });
    stream.write = function (chunk, encoding, callback) {
      // Node forwards worker console writes through the parent's stdio. The worker
      // already captured them, so forwarding is display output, not a second log.
      if (!depth && !stopped) {
        depth++;
        try {
          if (!stackLines().some(line => line.includes('ReadableWorkerStdio.ondata'))) {
            pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
            let newline;
            while ((newline = pending.indexOf('\n')) !== -1) { emitLine(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
            if (pending.length > 50000) { emitLine(pending); pending = ''; }
          }
        } catch {} finally { depth--; }
      }
      return Reflect.apply(original, this, arguments);
    };
  }
  record('system', ['Process connected'], { kind: 'start', source: null });
  process.on('exit', code => {
    for (const flushLine of pendingLines) flushLine();
    record('system', [`Process exited with code ${code}`], { kind: 'exit', exitCode: code, source: null });
    stopped = true;
    queue.unshift(...inFlight);
    queuedBytes += inFlight.reduce((sum, event) => sum + sizes.get(event), 0);
    // exit handlers cannot await network I/O. The helper has no capture preload and IDs are deduplicated by the collector.
    const env = { ...process.env }; delete env.NODE_OPTIONS;
    const deadline = performance.now() + 1800;
    while (queue.length && performance.now() < deadline) {
      const batch = takeBatch(); if (!batch.length) continue;
      spawnSync(process.execPath, [path.join(__dirname, 'deliver.cjs')], { env, input: JSON.stringify(batch), timeout: Math.max(1, Math.min(900, Math.floor(deadline - performance.now()))), stdio: ['pipe', 'ignore', 'ignore'] });
    }
    agent.destroy();
  });
  // Observe without installing an uncaughtException handler or changing Node's crash behavior.
  process.on('uncaughtExceptionMonitor', error => record('error', [error], { uncaught: true }));
}
