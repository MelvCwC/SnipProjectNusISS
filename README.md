# Snip CLI

Requires Node.js 20 or later. No dependencies are required.

```text
node cli.js add https://example.com
node cli.js ls
node cli.js open Ab12Cd
node cli.js help
```

The `snip`, `snip.cmd`, and `snip.ps1` wrappers forward their arguments to
`cli.js`. Set `SNIP_API` to the backend base URL; it defaults to
`http://localhost:3000`. `open` requests the short code once, increasing its hit
count, then opens the redirect destination in the system browser. Invalid input,
API and network failures, and browser-launch errors go to stderr with exit code 1.
API requests time out after 10 seconds.

Run the mock-API tests with `npm test`.
