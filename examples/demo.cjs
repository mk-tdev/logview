'use strict';
// Ordinary Node code: no Logview imports, SDK, or logging dependency.
const { fork } = require('node:child_process');
const { Worker } = require('node:worker_threads');

function showcase() {
  console.info('Shop API ready', { port: 3000, environment: 'development', features: ['checkout', 'inventory', 'search'] });
  const user = { id: 'usr_1042', name: 'Maya Chen', profile: { email: 'maya@example.test', address: { city: 'Singapore', country: 'SG' }, preferences: { currency: 'SGD', notifications: true } }, roles: ['customer', 'beta-tester'] };
  console.log('Customer loaded', user);
  user.profile.address.city = 'Changed AFTER the log';
  console.debug('Cache lookup', { key: 'products:featured', hit: true, ttl: 120, duration: 0.84 });
  console.group('Checkout request');
  console.log('Cart validated', { items: [{ sku: 'BK-001', title: 'The Creative Act', quantity: 1, price: 28 }, { sku: 'NT-042', title: 'Field notes', quantity: 2, price: 12 }], subtotal: 52, discount: { code: 'WELCOME', amount: 5.2 }, total: 46.8 });
  console.warn('Stock running low', { sku: 'NT-042', remaining: 3, warehouse: 'SG-02' });
  console.groupEnd();
  const circular = { name: 'Circular reference', children: [] }; circular.self = circular; circular.children.push(circular);
  console.log('Circular data is okay', circular);
  const special = { createdAt: new Date('2026-11-12T02:30:00Z'), amount: 9007199254740993n, missing: undefined, pattern: /order-\d+/gi, scores: new Map([['Maya', 98], ['Alex', 87]]), flags: new Set(['paid', 'verified']), buffer: Buffer.from('Hello'), notANumber: NaN, infinity: Infinity };
  Object.defineProperty(special, 'expensiveGetter', { enumerable: true, get() { throw new Error('This getter must not run'); } });
  console.dir(special, { depth: 1 });
  console.table([{ route: '/products', status: 200, ms: 12 }, { route: '/checkout', status: 503, ms: 1200 }]);
  const error = new Error('Payment provider timed out', { cause: new Error('Upstream did not respond in 1200ms') }); error.code = 'PAYMENT_TIMEOUT'; error.request = { id: 'req_7f2a', retryable: true };
  console.error('Checkout failed', error);
  console.trace('Tracing inventory reservation');
  console.assert(false, 'Order total should match', { expected: 46.8, received: 52 });
  console.count('requests'); console.count('requests');
  console.time('database query');
  setTimeout(() => console.timeEnd('database query'), 35);
  console.log('Formatting: %s has %d items', 'Maya', 3);
  console.log('Multiline message\n  request accepted\n  payment queued\n  response sent');
  console.log('Large collection (bounded)', Array.from({ length: 160 }, (_, id) => ({ id, name: `Product ${id}` })));
  process.stdout.write(JSON.stringify({ level: 30, msg: 'Structured logger output', request: { method: 'GET', path: '/health', status: 200 } }) + '\n');
  process.stderr.write('worker:queue Retrying job after a temporary connection failure\n');
  process.stdout.write('A partial line, '); process.stdout.write('assembled correctly.\n');
  fork(require.resolve('./child.cjs'), [], { stdio: 'inherit' });
  new Worker(`console.log('Worker thread connected', { task: 'resize-image', dimensions: { width: 1200, height: 800 } });`, { eval: true });
}
showcase();
if (process.argv.includes('--once')) {
  // Let the timer and children finish, then exit naturally.
} else {
  let requests = 1042;
  setInterval(() => {
    requests++;
    console.info('Request completed', { requestId: `req_${requests}`, method: 'GET', path: '/api/products', status: 200, durationMs: Number((8 + Math.random() * 35).toFixed(2)) });
  }, 6000);
  setInterval(() => console.debug('Worker heartbeat', { queue: 'emails', pending: Math.floor(Math.random() * 8), healthy: true }), 13000);
}
