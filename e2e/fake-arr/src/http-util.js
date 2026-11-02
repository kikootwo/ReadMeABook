/**
 * Component: E2E fake-arr HTTP helpers (body parsing, multipart, responses)
 * Documentation: documentation/testing/e2e-harness.md
 */

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Read the full request body into a Buffer (capped at 8 MB). */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Parse a multipart/form-data body into { fields, files }.
 * files: [{ name, filename, contentType, data: Buffer }]
 */
export function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('multipart boundary missing');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const fields = {};
  const files = [];
  let start = body.indexOf(boundary);
  while (start !== -1) {
    const partStart = start + boundary.length;
    // Final boundary is followed by "--"
    if (body.slice(partStart, partStart + 2).toString() === '--') break;
    const next = body.indexOf(boundary, partStart);
    if (next === -1) break;
    // Part = CRLF headers CRLF CRLF data CRLF
    const part = body.slice(partStart + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      const data = part.slice(headerEnd + 4);
      const name = /name="([^"]*)"/i.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      const ctype = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1];
      if (name !== undefined) {
        if (filename !== undefined) files.push({ name, filename, contentType: ctype, data });
        else fields[name] = data.toString('utf8');
      }
    }
    start = next;
  }
  return { fields, files };
}

/** Parse query string + urlencoded/multipart body into a flat params object. */
export async function readParams(req, url) {
  const params = Object.fromEntries(url.searchParams.entries());
  const multi = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    if (all.length > 1) multi[key] = all;
  }
  let files = [];
  if (req.method === 'POST' || req.method === 'PUT') {
    const body = await readBody(req);
    const ctype = req.headers['content-type'] || '';
    if (ctype.startsWith('multipart/form-data')) {
      const parsed = parseMultipart(body, ctype);
      Object.assign(params, parsed.fields);
      files = parsed.files;
    } else if (ctype.startsWith('application/x-www-form-urlencoded')) {
      for (const [k, v] of new URLSearchParams(body.toString('utf8'))) params[k] = v;
    } else if (ctype.startsWith('application/json') && body.length > 0) {
      Object.assign(params, JSON.parse(body.toString('utf8')));
    }
  }
  return { params, multi, files };
}

export function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

export function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function sendBuffer(res, status, buffer, contentType, headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': buffer.length, ...headers });
  res.end(buffer);
}

export function notFound(res, what = 'not found') {
  sendJson(res, 404, { error: what });
}
