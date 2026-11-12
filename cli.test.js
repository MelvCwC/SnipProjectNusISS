'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const { browserCommand } = require('./cli');
const exec = promisify(execFile);
const cli = require('node:path').join(__dirname, 'cli.js');

async function run(args, base) {
  try {
    const result = await exec(process.execPath, [cli, ...args], {
      env: { ...process.env, SNIP_API: base },
    });
    return { ...result, code: 0 };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

test('CLI validates arguments and uses the API contract', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      res.writeHead(201).end(JSON.stringify({ shortUrl: 'http://localhost:3000/Ab12Cd' }));
    } else if (req.url === '/api/links') {
      res.end(JSON.stringify([{ code: 'Ab12Cd', hits: 3, url: 'https://example.com' }]));
    } else {
      res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const help = await run(['help'], base);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /snip add <url>/);
  for (const args of [['add'], ['add', 'file:///tmp/a'], ['ls', 'extra'], ['open', '../bad']]) {
    const result = await run(args, base);
    assert.equal(result.code, 1);
    assert.notEqual(result.stderr, '');
  }
  assert.equal(requests.length, 0);
  const add = await run(['add', 'https://example.com'], base);
  assert.equal(add.code, 0);
  assert.equal(add.stdout.trim(), 'http://localhost:3000/Ab12Cd');
  assert.deepEqual(JSON.parse(requests[0].body), { url: 'https://example.com' });
  const list = await run(['ls'], base);
  assert.equal(list.code, 0);
  assert.match(list.stdout, /Ab12Cd\s+3\s+https:\/\/example\.com/);
  const missing = await run(['open', 'Ab12Cd'], base);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /not found/i);
  assert.equal(requests[2].url, '/Ab12Cd');
});

test('empty lists, API errors, malformed replies, and dead backends fail cleanly', async (t) => {
  let mode = 'empty';
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (mode === 'empty') res.end('[]');
    else if (mode === 'error') res.writeHead(400).end('{"error":"Bad URL"}');
    else res.end('not JSON');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => { if (server.listening) server.close(); });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await run(['ls'], base)).stdout.trim(), 'No links yet.');
  mode = 'error';
  const bad = await run(['add', 'https://example.com'], base);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /HTTP 400: Bad URL/);
  mode = 'malformed';
  const malformed = await run(['ls'], base);
  assert.equal(malformed.code, 1);
  assert.match(malformed.stderr, /invalid JSON/);
  await new Promise((resolve) => server.close(resolve));
  const dead = await run(['ls'], base);
  assert.equal(dead.code, 1);
  assert.match(dead.stderr, /Could not reach API/);
});

test('browser commands pass URLs as arguments without a shell', () => {
  const url = 'https://example.com/?a=1&b=2';
  assert.deepEqual(browserCommand('win32', url), ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual(browserCommand('darwin', url), ['open', [url]]);
  assert.deepEqual(browserCommand('linux', url), ['xdg-open', [url]]);
  assert.throws(() => browserCommand('unknown', url), /not supported/);
});

test('open requests the code once and launches the redirect destination', async (t) => {
  const paths = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    res.writeHead(302, { location: 'https://example.com/?a=1&b=2' }).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const script = `
    const cp = require('node:child_process');
    const { EventEmitter } = require('node:events');
    cp.spawn = (command, args, options) => {
      console.log(JSON.stringify({ command, args, options }));
      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => child.emit('spawn'));
      return child;
    };
    require(${JSON.stringify(cli)}).main(['open', 'Ab12Cd']).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  `;
  const result = await exec(process.execPath, ['-e', script], {
    env: { ...process.env, SNIP_API: `http://127.0.0.1:${server.address().port}` },
  });
  const launch = JSON.parse(result.stdout);
  const [command, args] = browserCommand(process.platform, 'https://example.com/?a=1&b=2');
  assert.equal(launch.command, command);
  assert.deepEqual(launch.args, args);
  assert.equal(launch.options.shell, undefined);
  assert.deepEqual(paths, ['/Ab12Cd']);
});
