'use strict';
// A bounded exit-time delivery path for scripts that explicitly call process.exit().
const http = require('node:http');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const req = http.request({
    host: '127.0.0.1', port: Number(process.env.LOGVIEW_PORT), path: '/api/ingest', method: 'POST',
    headers: { Authorization: `Bearer ${process.env.LOGVIEW_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(input) }
  }, res => { res.resume(); });
  req.setTimeout(700, () => req.destroy());
  req.on('error', () => {});
  req.end(input);
});
