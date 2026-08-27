#!/usr/bin/env node
// mtok-bridge CLI: serve a model as an OpenAI-compatible API, keyed, no payment, no market.
// Runs anywhere node runs. Point it at any OpenAI-compatible upstream (a provider, or your own
// local model server), hand out the endpoint + key. When you want to get PAID + discovered for
// the same model, the market relay (npx mtok-relay) wraps this exact core with on-chain settlement.
//
//   npx mtok-bridge --upstream https://api.openai.com/v1 --upstream-key sk-... --model gpt-4o-mini
//   npx mtok-bridge --upstream http://localhost:11434/v1 --model llama3.2   # a local ollama server
//
// Flags: --upstream <url> (required), --upstream-key <key>, --model <id> (repeatable or comma-list),
//        --port <n> (default 8790), --api-key <key> (default: generate + print one), --keyless.
import http from 'node:http';
import crypto from 'node:crypto';
import { serveChat, httpUpstream } from './src/bridge.mjs';

function parseArgs(argv) {
  const o = { models: [], port: 8790 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keyless') { o.keyless = true; continue; }
    if (!a.startsWith('--')) { console.error(`ABORT: unexpected argument "${a}"`); process.exit(1); }
    const name = a.slice(2);
    const val = argv[++i];
    if (name === 'model') o.models.push(...String(val || '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (name === 'upstream') o.upstream = val;
    else if (name === 'upstream-key') o.upstreamKey = val;
    else if (name === 'port') o.port = Number(val) || 8790;
    else if (name === 'api-key') o.apiKey = val;
    else { console.error(`ABORT: unknown flag --${name}`); process.exit(1); }
  }
  return o;
}

const o = parseArgs(process.argv.slice(2));
if (!o.upstream) { console.error('need --upstream <openai-compatible url> (e.g. https://api.openai.com/v1 or http://localhost:11434/v1)'); process.exit(1); }
const apiKey = o.keyless ? null : (o.apiKey || 'mtok_' + crypto.randomBytes(24).toString('hex'));
const upstream = httpUpstream({ baseUrl: o.upstream, key: o.upstreamKey });

const MAX_BODY_BYTES = 2_000_000;
const readBody = (req) => new Promise((resolve) => {
  // #651: buffer the raw chunks and decode ONCE. `data += chunk` stringified each
  // Buffer as it arrived, which corrupts a multibyte UTF-8 character split across
  // two TCP chunks (each half decodes to replacement bytes). Track the BYTE total
  // (not string .length) against the cap, and on overflow resolve immediately so an
  // oversized request gets its 413 instead of leaving the handler awaiting forever.
  const chunks = [];
  let bytes = 0;
  let settled = false;
  const done = (value) => { if (!settled) { settled = true; resolve(value); } };
  req.on('data', (c) => {
    if (settled) return;
    bytes += c.length;
    if (bytes > MAX_BODY_BYTES) { req.destroy(); return done(null); }
    chunks.push(c);
  });
  req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
  req.on('error', () => done(null));
  req.on('close', () => done(null)); // destroy() emits close, not always end/error
});
const send = (res, status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };

const server = http.createServer(async (req, res) => {
  const path = (req.url || '').split('?')[0];
  if (req.method === 'GET' && path === '/v1/models') {
    return send(res, 200, { object: 'list', data: (o.models.length ? o.models : ['(upstream default)']).map((id) => ({ id, object: 'model' })) });
  }
  if (req.method === 'POST' && path === '/v1/chat/completions') {
    const raw = await readBody(req);
    if (raw === null) return send(res, 413, { error: { message: 'body too large or unreadable', type: 'invalid_request_error' } });
    let body; try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: { message: 'invalid JSON', type: 'invalid_request_error' } }); }
    const r = await serveChat({ body, authHeader: req.headers['authorization'], apiKey, models: o.models, upstream });
    return send(res, r.status, r.json);
  }
  return send(res, 404, { error: { message: 'not found; POST /v1/chat/completions', type: 'invalid_request_error' } });
});

server.listen(o.port, () => {
  const base = `http://localhost:${o.port}/v1`;
  console.log('mtok-bridge is serving.');
  console.log(`  endpoint:  ${base}`);
  console.log(`  models:    ${o.models.length ? o.models.join(', ') : '(whatever the upstream serves)'}`);
  console.log(apiKey ? `  api key:   ${apiKey}` : '  api key:   NONE (--keyless: anyone who can reach this endpoint can use it)');
  console.log('\n  hand these to whoever should use it. example:');
  console.log(`    curl ${base}/chat/completions \\`);
  if (apiKey) console.log(`      -H "authorization: Bearer ${apiKey}" \\`);
  console.log(`      -H "content-type: application/json" \\`);
  console.log(`      -d '{"model":"${o.models[0] ?? 'MODEL'}","messages":[{"role":"user","content":"hi"}]}'`);
  console.log('\n  want to get PAID for this model instead of handing out keys? the market relay');
  console.log('  (npx mtok-relay) wraps this same bridge with on-chain settlement. see mtok.market.');
});
