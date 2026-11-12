const { randomInt } = require("node:crypto");
const { realpath, stat } = require("node:fs/promises");
const path = require("node:path");

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...cors, ...headers } });
}

function methodNotAllowed(allow) {
  return json({ error: "Method not allowed" }, 405, { Allow: allow });
}

async function createHandler({ baseUrl, publicDir } = {}) {
  const origin = new URL(baseUrl || "http://localhost:3000");
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new Error("BASE_URL must be an HTTP(S) URL");
  }
  const publicRoot = publicDir ? await realpath(publicDir) : null;
  if (publicRoot && !(await stat(publicRoot)).isDirectory()) {
    throw new Error("PUBLIC_DIR must be a directory");
  }
  const links = new Map();

  async function staticFile(pathname) {
    if (!publicRoot) return null;
    const candidate = path.resolve(publicRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
    const isInside = (file) => {
      const relative = path.relative(publicRoot, file);
      return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    };
    if (!isInside(candidate)) return null;

    let resolved;
    try {
      resolved = await realpath(candidate);
      if (!isInside(resolved) || !(await stat(resolved)).isFile()) return null;
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    }
    return new Response(Bun.file(resolved), { headers: cors });
  }

  return async function fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/links") {
      if (request.method === "GET") return json([...links.values()]);
      if (request.method !== "POST") return methodNotAllowed("GET, POST, OPTIONS");

      let body;
      try {
        body = await request.json();
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return json({ error: "Invalid JSON" }, 400);
      }
      if (!body || typeof body.url !== "string" || !body.url.trim()) {
        return json({ error: "url must be an HTTP(S) URL string" }, 400);
      }
      const url = body.url.trim();
      let parsed;
      try {
        parsed = new URL(url);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        return json({ error: "url must be an HTTP(S) URL string" }, 400);
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return json({ error: "url must be an HTTP(S) URL string" }, 400);
      }

      let code;
      do {
        code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
      } while (links.has(code));
      const link = {
        code,
        url,
        shortUrl: `${origin.origin}/${code}`,
        hits: 0,
        createdAt: new Date().toISOString(),
      };
      links.set(code, link);
      return json(link, 201);
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }
    if (request.method !== "GET") return methodNotAllowed("GET, OPTIONS");

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      return json({ error: "Invalid path" }, 400);
    }
    if (decoded.includes("\0")) return json({ error: "Invalid path" }, 400);
    const file = await staticFile(decoded);
    if (file) return file;

    const link = /^\/[a-zA-Z0-9]{6}$/.test(pathname) ? links.get(pathname.slice(1)) : null;
    if (!link) return json({ error: "Not found" }, 404);
    link.hits += 1;
    return new Response(null, {
      status: 302,
      headers: { ...cors, Location: link.url, "Cache-Control": "no-store" },
    });
  };
}

async function start() {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  const baseUrl = process.env.BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `http://localhost:${port}`);
  const fetch = await createHandler({ baseUrl, publicDir: process.env.PUBLIC_DIR });
  const server = Bun.serve({
    port,
    fetch,
    error(error) {
      console.error(error);
      return json({ error: "Internal server error" }, 500);
    },
  });
  console.log(`Snip listening on ${server.url}`);
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { createHandler };
