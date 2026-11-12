# Snip backend

A single-file Bun 1.x server with no npm dependencies. Links live in an in-memory
Map; restarting the server deletes them. This is a public demo API, without
authentication, rate limiting, or persistent storage.

```powershell
bun start
bun test
```

## Shared API

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/links` | JSON `{ "url": "https://example.com" }` | 201 `{ code, url, shortUrl, hits, createdAt }` |
| GET | `/api/links` | None | 200 array of those objects, in creation order |
| GET | `/:code` | None | 302 with `Location` pointing to the original URL; increments hits once |
| OPTIONS | Any path | None | 204 CORS preflight |

Codes are six random base62 characters, with collisions retried. `hits` starts at
zero and `createdAt` is an ISO timestamp. URL input must be a non-empty string with
an HTTP or HTTPS scheme; surrounding whitespace is trimmed. Malformed JSON and
invalid URLs return 400 JSON `{ "error": "..." }`. Unknown routes/codes return 404
with the same error shape. Unsupported methods return 405 with an `Allow` header.
Responses include open CORS headers. Redirects disable caching so requests reach
the server and count hits.

## Configuration

| Environment variable | Behavior |
| --- | --- |
| `PORT` | Listening port, default `3000`; must be an integer from 1 to 65535 |
| `BASE_URL` | HTTP(S) URL whose origin is used in returned `shortUrl` values |
| `RAILWAY_PUBLIC_DOMAIN` | If `BASE_URL` is absent, use `https://` plus this domain |
| `PUBLIC_DIR` | Optional static directory; `/` serves `index.html` |

Without either origin setting, links use `http://localhost:<PORT>`. Relative
`PUBLIC_DIR` paths resolve from the process working directory. Static files win
over same-named short codes, but API routes remain reserved. Missing files return
404; paths and symbolic links cannot escape the configured public directory.
Invalid configuration fails startup explicitly.

For the generated bundle, set `PUBLIC_DIR=./public` and copy this `server.js`
unchanged. The bundled frontend should call relative `/api/links` URLs; development
clients may use `http://localhost:3000` via CORS or a development proxy.

## Smoke check

Start the server, create a link with POST `/api/links`, list it with GET
`/api/links`, and request its `/:code` without following redirects. Expect
201, 200, then 302. A second list request should show one hit. Also verify a bad
URL returns 400, an unknown code returns 404, and OPTIONS returns 204.

## Branch workflow

These files belong at the root of the independent `backend` branch. On the `main`
superproject they appear in its `backend` submodule. Commit and push backend source
changes first, then update and commit the superproject's backend commit pointer.
The `bundle` branch is generated output, never the source of backend edits.
