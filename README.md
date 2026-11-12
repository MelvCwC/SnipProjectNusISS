# Snip frontend

Angular 19 client for Snip. It creates short links through `POST /api/links` and
lists them through `GET /api/links`.

## Development

Run the backend on port 3000, then start the Angular dev server:

```bash
npm install
npx ng serve
```

Open `http://localhost:4200`. The dev-server proxy forwards `/api` requests to
`http://localhost:3000`; production builds use relative API paths so the bundled
frontend talks to the server that hosts it.

## Build

```bash
npx ng build
```

The production browser app is emitted to `dist/snip-frontend/browser`, which is
the static directory consumed by the bundle build.
