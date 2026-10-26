/**
 * Component: E2E fake metadata proxy tests (node:test, host-run, real HTTP on an ephemeral port)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { handleMetadata, isFakedHost, refuseConnect, searchBooks } from '../src/metadata.js';

const BOOKS = {
  one: { asin: 'B08G9PRS1K', title: 'Fixture Book One', author: 'Test Author', narrator: 'Test Narrator', runtimeMin: 970 },
  two: { asin: 'B082BHJMFF', title: 'Fixture Book Two', author: 'Test Author', narrator: 'Other Narrator', runtimeMin: 659 },
};
const records = [];
const state = { fixtureIndex: { books: BOOKS }, record: (e) => (records.push(e), e) };
let server;
let port;

/** Send a request the way axios does through an http proxy: absolute URI in the request line. */
function viaProxy(target, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: { host: u.host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: body && res.headers['content-type']?.includes('json') ? JSON.parse(body) : body }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  server = http.createServer((req, res) => {
    const entry = state.record({ service: 'metadata', method: req.method });
    handleMetadata(state, req, res, entry).catch((e) => res.writeHead(500).end(String(e)));
  });
  server.on('connect', (req, socket) => refuseConnect(state, req, socket));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(() => new Promise((r) => server.close(r)));

test('catalog search returns only books containing every title word', async () => {
  const res = await viaProxy('https://api.audible.com/1.0/catalog/products?num_results=10&products_sort_by=Relevance&title=Fixture%20Book%20Two&author=Test%20Author');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.products, [{ asin: 'B082BHJMFF' }]);
  assert.deepEqual(searchBooks(BOOKS, 'Fixture Book'), [BOOKS.one, BOOKS.two]);
  assert.deepEqual(searchBooks(BOOKS, 'Unknown Title'), []);
});

test('regional Audible API hosts are faked too', async () => {
  const res = await viaProxy('https://api.audible.ca/1.0/catalog/products?title=Fixture%20Book%20One');
  assert.deepEqual(res.body.products, [{ asin: 'B08G9PRS1K' }]);
});

test('audnexus book is synthetic and image-free; unknown ASIN is 404', async () => {
  const res = await viaProxy('https://api.audnex.us/books/B082BHJMFF?region=us');
  assert.equal(res.status, 200);
  assert.equal(res.body.asin, 'B082BHJMFF');
  assert.equal(res.body.title, 'Fixture Book Two');
  assert.deepEqual(res.body.authors, [{ name: 'Test Author' }]);
  assert.match(res.body.summary, /Synthetic e2e summary/);
  assert.equal('image' in res.body, false);
  assert.equal((await viaProxy('https://api.audnex.us/books/B000000000')).status, 404);
  assert.deepEqual((await viaProxy('https://api.audnex.us/authors?name=Test%20Author')).body, []);
});

test('records the target host and path of every proxied request', async () => {
  records.length = 0;
  await viaProxy('https://api.audnex.us/books/B08G9PRS1K');
  assert.equal(records.at(-1).host, 'api.audnex.us');
  assert.equal(records.at(-1).path, '/books/B08G9PRS1K');
  assert.equal(records.at(-1).target, 'https://api.audnex.us/books/B08G9PRS1K');
});

test('never forwards: any other host is 403, Audible web is 404, CONNECT is refused', async () => {
  assert.equal((await viaProxy('https://example.com/')).status, 403);
  assert.equal((await viaProxy('https://www.audible.com/search?keywords=x')).status, 404);
  assert.equal((await viaProxy('https://api.audnex.us/books/B08G9PRS1K', 'POST')).status, 405);
  const reply = await new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write('CONNECT api.audnex.us:443 HTTP/1.1\r\nHost: api.audnex.us:443\r\n\r\n'));
    let data = '';
    s.on('data', (c) => (data += c));
    s.on('end', () => resolve(data));
    s.on('error', reject);
  });
  assert.match(reply, /^HTTP\/1\.1 403/);
  assert.equal(records.at(-1).method, 'CONNECT');
});

test('host is checked before method: a non-GET to any other host is 403, not 405', async () => {
  assert.equal((await viaProxy('https://example.com/upload', 'POST')).status, 403);
  assert.equal((await viaProxy('https://api.audible.com/1.0/catalog/products', 'PUT')).status, 405);
  assert.equal(isFakedHost('API.Audnex.us'), true);
  assert.equal(isFakedHost('api.audible.co.uk'), true);
  assert.equal(isFakedHost('audnex.us.evil.example'), false);
  assert.equal(isFakedHost(''), false);
});

test('a client error on a refused CONNECT socket does not throw', async () => {
  const socket = new EventEmitter();
  socket.remoteAddress = '127.0.0.1';
  socket.end = () => {};
  await refuseConnect(state, { url: 'api.audnex.us:443', headers: {} }, socket);
  assert.doesNotThrow(() => socket.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })));
});
