# mtok-bridge

Serve any model as an OpenAI-compatible API, gated by a key. No payment, no market, no account,
nothing reported anywhere. Runs anywhere node runs.

```
npx mtok-bridge --upstream https://api.openai.com/v1 --upstream-key sk-... --model gpt-4o-mini
npx mtok-bridge --upstream http://localhost:11434/v1 --model llama3.2      # a local ollama server
```

It prints an endpoint and an api key. Hand them to whoever should use it:

```
curl http://localhost:8790/v1/chat/completions \
  -H "authorization: Bearer <the-printed-key>" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
```

## flags

- `--upstream <url>` (required): any OpenAI-compatible chat/completions root (a provider, or your
  own model server: ollama, LM Studio, vLLM, etc).
- `--upstream-key <key>`: the upstream's bearer token, if it needs one.
- `--model <id>`: a model you serve (repeatable, or a comma list). Omit to pass the upstream's
  default through.
- `--port <n>`: default 8790.
- `--api-key <key>`: the key clients send. Omit and one is generated + printed for you.
- `--keyless`: serve with NO key (anyone who can reach the endpoint can use it). Opt-in.

## want to get paid for it?

The bridge is the transport half of [mtok.market](https://mtok.market)'s seller relay. When you
want to get PAID for a model (on-chain, per call, in USDC on Base) and be discovered on the market
board instead of handing out keys, the market relay wraps this exact bridge with settlement. Same
tool, one layer on top.

## the shared serve core (for market hosts)

`mtok-bridge` also exports `createServeCore`, the paid-serve state machine the market relay
(and the workers-ai house seller) run: validate request => verify the on-chain DrawPaid
(request-hash bound) => bound both legs against the payment => claim => upstream => complete,
fail-closed. The redemption store is a pluggable interface (`{ state, get, claim, complete,
retentionMs }`, each method sync or async: the core awaits every call). The store must make
claims atomic across every host serving that offer. Independent local files and eventually
consistent KV read/write pairs do not provide that guarantee. If you
are just serving a model for a key, you never need it; it is here so every mtok seller host
shares one money path.

`state(key, { claimKey })` and `get(key, { claimKey })` receive the canonical commitment
identity even when `key` names a legacy record. `claim(key, markerKey, { paidAtMs })` receives
the verifier's payment timestamp, so a store migrating old claims can refuse ambiguous
pre-cutover payments. Existing stores may ignore these additional arguments. The core still
verifies the payment before reading a completion, and known claims never run upstream again.


---

Read-only public mirror. The source of truth is the private mtok.market
monorepo; this repo is synced automatically. Do not open pull requests here.
Home: https://mtok.market
