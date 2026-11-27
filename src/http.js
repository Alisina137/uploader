import { InputError } from './draft-model.js';

export function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(body);
}

export function redirect(response, location) {
  response.writeHead(303, { Location: location });
  response.end();
}

export function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

export async function readBody(request, limit) {
  if (Number(request.headers['content-length']) > limit) throw new InputError('This request is too large.', 413);
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) throw new InputError('This request is too large.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readForm(request, limit = 8 * 1024) {
  const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  return new URLSearchParams((await readBody(request, limit)).toString('utf8'));
}
