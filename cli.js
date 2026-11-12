#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const USAGE = `Usage:
  snip add <url>    Create a short link
  snip ls           List links and hit counts
  snip open <code>  Open a link in your browser
  snip help         Show this help

Set SNIP_API to the API base URL (default: http://localhost:3000).`;
const TIMEOUT_MS = 10000;

function httpUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must be a valid HTTP(S) URL.`);
  }
  return url;
}

function apiBase() {
  const url = httpUrl(process.env.SNIP_API || 'http://localhost:3000', 'SNIP_API');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('SNIP_API must not contain credentials, a query, or a fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(new URL(path, apiBase()), {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('API request timed out.');
    throw new Error(`Could not reach API: ${error.message}`);
  }
  return response;
}

async function apiError(response) {
  let detail = '';
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = await response.json();
      if (typeof body.error === 'string') detail = `: ${body.error}`;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return new Error(`API returned HTTP ${response.status}${detail}`);
}

async function jsonResponse(response) {
  if (!response.ok) throw await apiError(response);
  try {
    return await response.json();
  } catch {
    throw new Error('API returned invalid JSON.');
  }
}

function browserCommand(platform, url) {
  if (platform === 'win32') return ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'linux') return ['xdg-open', [url]];
  throw new Error(`Browser launching is not supported on ${platform}.`);
}

async function launchBrowser(url) {
  const [command, args] = browserCommand(process.platform, url);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', (error) => reject(new Error(`Could not launch browser: ${error.message}`)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function main(args) {
  if (args.length === 0 || (args.length === 1 && ['help', '--help', '-h'].includes(args[0]))) {
    console.log(USAGE);
    return;
  }
  const [command, argument] = args;
  if (command === 'add' && args.length === 2) {
    httpUrl(argument, 'URL');
    const response = await request('api/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: argument }),
    });
    const link = await jsonResponse(response);
    if (!link || typeof link.shortUrl !== 'string') throw new Error('API returned an invalid link.');
    httpUrl(link.shortUrl, 'Returned short URL');
    console.log(link.shortUrl);
  } else if (command === 'ls' && args.length === 1) {
    const links = await jsonResponse(await request('api/links'));
    if (!Array.isArray(links) || links.some((link) =>
      !link || typeof link.code !== 'string' || typeof link.url !== 'string' ||
      !Number.isSafeInteger(link.hits) || link.hits < 0)) {
      throw new Error('API returned an invalid links list.');
    }
    if (!links.length) {
      console.log('No links yet.');
      return;
    }
    const codeWidth = Math.max(4, ...links.map((link) => link.code.length));
    const hitsWidth = Math.max(4, ...links.map((link) => String(link.hits).length));
    console.log(`${'CODE'.padEnd(codeWidth)}  ${'HITS'.padStart(hitsWidth)}  URL`);
    for (const link of links) {
      console.log(`${link.code.padEnd(codeWidth)}  ${String(link.hits).padStart(hitsWidth)}  ${link.url}`);
    }
  } else if (command === 'open' && args.length === 2) {
    if (!/^[a-zA-Z0-9]{6}$/.test(argument)) throw new Error('Code must contain six letters or digits.');
    const response = await request(argument);
    if (response.status === 404) throw new Error(`Link not found: ${argument}`);
    if (response.status !== 302) throw await apiError(response);
    const location = response.headers.get('location');
    if (!location) throw new Error('API redirect is missing a Location header.');
    const destination = new URL(location, response.url);
    httpUrl(destination.href, 'Redirect target');
    await launchBrowser(destination.href);
  } else {
    throw new Error(`Invalid arguments.\n${USAGE}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { browserCommand, main };
