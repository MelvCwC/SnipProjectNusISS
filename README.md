# Snip

Snip is a tiny URL shortener with one API and two clients: an Angular web app
and a Node.js command-line tool. The API stores links in memory, so restarting
the server clears them.

## Repository layout

Each component has its own orphan branch and is mounted on `main` as a
submodule. The submodule pointer pins the exact component commit used by this
checkout.

| Branch | Path | Contents |
| --- | --- | --- |
| `backend` | `backend/` | Zero-dependency Bun API server |
| `frontend` | `frontend/` | Angular 19 web client |
| `cli` | `cli/` | Zero-dependency Node.js CLI |
| `bundle` | `bundle/` | Generated release: API, web UI, and CLI |

Clone with submodules initialized:

```sh
git clone --recurse-submodules https://github.com/MelvCwC/SnipProjectNusISS.git
```

Without `--recurse-submodules`, the component directories are empty. To
populate them after a plain clone, run `git submodule update --init --recursive`.

## API contract

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `POST` | `/api/links` | `{ "url": "https://..." }` | `201` `{ code, url, shortUrl, hits, createdAt }`; `400` `{ error }` for invalid input |
| `GET` | `/api/links` | — | `200` array of link objects |
| `GET` | `/:code` | — | `302` redirect and incremented hit count; `404` when unknown |

Links have six-character base62 codes, start with zero hits, and use ISO
timestamps for `createdAt`.

## Run locally

Start the backend (requires Bun 1.x):

```sh
cd backend
bun start
```

In another terminal, run the web client (requires Node.js 20+ and npm):

```sh
cd frontend
npm ci
npm start
```

Run the CLI (requires Node.js 20+):

```sh
cd cli
node cli.js help
node cli.js add https://example.com
node cli.js ls
```

## Updating components

Make and push a component change from that component's branch first. Then, in
the `main` checkout, update and commit the pointer:

```sh
git submodule update --remote backend
git add backend
git commit -m "Bump backend submodule"
git push
```

Use the corresponding path for `frontend` or `cli`. The `bundle` directory is
generated output; do not edit it by hand. Rebuild it with
`node scripts/build-bundle.mjs`; pass `--push` to publish the bundle and main
pointer updates.

The bundle workflow rebuilds on an hourly schedule or manual dispatch; it has
no push trigger because component branch pushes do not run a workflow defined
only on `main`. The Docker workflow watches the `bundle` submodule pointer.
Both workflows run backend, frontend, and CLI tests. Docker publishing also
requires a passing production dependency audit and high/critical image scan.
CI uses Node 22 because the Angular 19 CLI does not support Node 24. Current
Angular 19 production advisories can block image publishing until a patched
compatible release is available.
