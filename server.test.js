const { afterEach, describe, expect, test } = require("bun:test");
const { mkdtemp, mkdir, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createHandler } = require("./server");

const temporaryDirectories = [];
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function request(pathname, method = "GET", body) {
  return new Request(`http://localhost:3000${pathname}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createLink(fetch, url = "https://example.com/a?b=1") {
  const response = await fetch(request("/api/links", "POST", { url }));
  expect(response.status).toBe(201);
  return response.json();
}

describe("shared API", () => {
  test("creates, lists and redirects without losing links or miscounting hits", async () => {
    const fetch = await createHandler({ baseUrl: "https://snip.example/" });
    expect(await (await fetch(request("/api/links"))).json()).toEqual([]);
    const link = await createLink(fetch);
    expect(Object.keys(link).sort()).toEqual(["code", "createdAt", "hits", "shortUrl", "url"]);
    expect(link.code).toMatch(/^[a-zA-Z0-9]{6}$/);
    expect(link.shortUrl).toBe(`https://snip.example/${link.code}`);
    expect(link.url).toBe("https://example.com/a?b=1");
    expect(link.hits).toBe(0);
    expect(new Date(link.createdAt).toISOString()).toBe(link.createdAt);
    const another = await createLink(fetch, "http://example.org/");
    expect(another.code).not.toBe(link.code);
    const redirect = await fetch(request(`/${link.code}`));
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe(link.url);
    expect(redirect.headers.get("Cache-Control")).toBe("no-store");
    expect(await (await fetch(request("/api/links"))).json()).toEqual([
      { ...link, hits: 1 }, another,
    ]);
  });

  test.each([null, {}, [], { url: null }, { url: 123 }, { url: "" },
    { url: "   " }, { url: "not a URL" }, { url: "/relative" },
    { url: "ftp://example.com" }, { url: "javascript:alert(1)" }])(
    "rejects invalid URL bodies: %j", async (body) => {
      const fetch = await createHandler();
      const response = await fetch(request("/api/links", "POST", body));
      expect(response.status).toBe(400);
      expect(typeof (await response.json()).error).toBe("string");
      expect(await (await fetch(request("/api/links"))).json()).toEqual([]);
    },
  );

  test("rejects malformed JSON and returns JSON errors for unknown paths/methods", async () => {
    const fetch = await createHandler();
    const invalid = await fetch(new Request("http://localhost/api/links", { method: "POST", body: "{" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid JSON" });
    for (const pathname of ["/ABC123", "/api/missing", "/missing/path"]) {
      expect((await fetch(request(pathname))).status).toBe(404);
    }
    const unsupported = await fetch(request("/api/links", "DELETE"));
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("Allow")).toBe("GET, POST, OPTIONS");
  });

  test("supports preflight and CORS on successes and errors", async () => {
    const fetch = await createHandler();
    for (const response of [
      await fetch(request("/api/links", "OPTIONS")),
      await fetch(request("/api/links")),
      await fetch(request("/ABC123")),
      await fetch(request("/api/links", "POST", {})),
    ]) {
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
    const preflight = await fetch(request("/api/links", "OPTIONS"));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    const link = await createLink(fetch);
    expect((await fetch(request(`/${link.code}`))).headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("a fresh server starts with empty in-memory storage", async () => {
    await createLink(await createHandler());
    const fresh = await createHandler();
    expect(await (await fresh(request("/api/links"))).json()).toEqual([]);
  });
});

describe("bundled static serving", () => {
  test("serves index/assets, prefers files over codes, and blocks escaping paths", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "snip-backend-test-"));
    temporaryDirectories.push(directory);
    const publicDir = path.join(directory, "public");
    await mkdir(publicDir);
    await writeFile(path.join(publicDir, "index.html"), "<h1>Snip</h1>");
    await writeFile(path.join(directory, "private.txt"), "not public");
    const fetch = await createHandler({ publicDir });
    expect(await (await fetch(request("/"))).text()).toBe("<h1>Snip</h1>");
    const link = await createLink(fetch);
    await writeFile(path.join(publicDir, link.code), "static wins");
    expect(await (await fetch(request(`/${link.code}`))).text()).toBe("static wins");
    expect((await (await fetch(request("/api/links"))).json())[0].hits).toBe(0);
    for (const pathname of ["/..%2fprivate.txt", "/..%5cprivate.txt"]) {
      expect((await fetch(request(pathname))).status).toBe(404);
    }
    expect((await fetch(request("/%FF"))).status).toBe(400);
    expect((await fetch(request("/%00"))).status).toBe(400);
  });

  test("fails explicitly for nonexistent PUBLIC_DIR or a non-HTTP origin", async () => {
    await expect(createHandler({ publicDir: path.join(tmpdir(), "snip-missing", "not-here") })).rejects.toThrow();
    await expect(createHandler({ baseUrl: "ftp://example.com" })).rejects.toThrow("HTTP(S)");
  });
});
