'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, timingSafeEqual } = require('node:crypto');

const MAX_BODY = 2 * 1024 * 1024;

async function startServer({ port = 4317, maxEvents = 2000, maxBytes = 16 * 1024 * 1024 } = {}) {
  const token = randomUUID();
  const clients = new Set();
  const sessions = new Map();
  const ids = new Set();
  let events = [], bytes = 0, sequence = 0;
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
  ].map(([url, [file, type]]) => [url, { type, body: fs.readFileSync(path.join(__dirname, '../web', file)) }]));
  const payload = () => ({ events: events.map(e => e.data), sessions: [...sessions.values()], limit: maxEvents, cursor: sequence });
  function broadcast(type, data) {
    const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      if (client.writableLength > MAX_BODY) { client.destroy(); clients.delete(client); }
      else client.write(message);
    }
  }
  function accept(event) {
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || event.id.length > 200 ||
        typeof event.session !== 'string' || event.session.length > 200 || !Array.isArray(event.args) ||
        typeof event.project !== 'string' || !Number.isInteger(event.pid) ||
        typeof event.level !== 'string' || typeof event.timestamp !== 'string') return false;
    if (ids.has(event.id)) return true;
    event.cursor = ++sequence;
    const size = Buffer.byteLength(JSON.stringify(event));
    events.push({ data: event, size }); bytes += size; ids.add(event.id);
    while (events.length > maxEvents || bytes > maxBytes) {
      const removed = events.shift(); bytes -= removed.size; ids.delete(removed.data.id);
    }
    const previous = sessions.get(event.session);
    const session = {
      id: event.session, project: event.project, pid: event.pid, thread: event.thread || 0,
      cwd: event.cwd, command: event.command,
      status: event.kind === 'exit' ? 'exited' : (previous?.status || 'running'),
      lastSeen: event.timestamp, count: (previous?.count || 0) + (event.kind === 'log' ? 1 : 0)
    };
    sessions.set(event.session, session);
    if (sessions.size > 100) sessions.delete(sessions.keys().next().value);
    broadcast('entry', { event, session, oldestCursor: events[0]?.data.cursor || sequence });
    return true;
  }
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host;
    const expectedHost = `127.0.0.1:${server.address().port}`;
    const localhostHost = `localhost:${server.address().port}`;
    if (host !== expectedHost && host !== localhostHost) return json(res, 403, { error: 'Invalid host' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'Invalid origin' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { name: 'logview', version: 1 });
    if (req.method === 'GET' && url.pathname === '/api/connection') {
      if (req.headers.origin || req.headers['x-logview-client'] !== 'launcher') return json(res, 403, { error: 'Launcher only' });
      return json(res, 200, { token, port: server.address().port });
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, payload());
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(payload())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ingest') {
      const supplied = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(res, 401, { error: 'Invalid capture token' });
      let size = 0, chunks = [];
      try {
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY) { json(res, 413, { error: 'Batch too large' }); req.resume(); return; }
          chunks.push(chunk);
        }
        const batch = JSON.parse(Buffer.concat(chunks).toString());
        if (!Array.isArray(batch) || batch.length > 100) return json(res, 400, { error: 'Expected a batch of up to 100 events' });
        let accepted = 0;
        for (const event of batch) if (accept(event)) accepted++;
        return json(res, 200, { accepted });
      } catch { if (!res.writableEnded) return json(res, 400, { error: 'Invalid event batch' }); return; }
    }
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const asset = assets.get(url.pathname);
      res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store' }); res.end(asset.body); return;
    }
    json(res, 404, { error: 'Not found' });
  });
  server.requestTimeout = 5000;
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 15000);
  heartbeat.unref();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    server, token, port: server.address().port,
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      clearInterval(heartbeat);
      for (const client of clients) client.destroy();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
module.exports = { startServer };
