#!/usr/bin/env node
import { appendFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const push = process.argv.slice(2).includes("--push");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--push");

if (unknownArgs.length) {
  throw new Error(`Unknown argument(s): ${unknownArgs.join(" ")}`);
}

function run(command, args, cwd = root) {
  const windowsCommand = process.platform === "win32" && ["npm", "npx"].includes(command)
    ? `${command}.cmd`
    : command;
  const result = spawnSync(windowsCommand, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && windowsCommand.endsWith(".cmd"),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function git(...args) {
  run("git", args);
}

function gitIn(directory, ...args) {
  run("git", ["-C", directory, ...args]);
}

function assertClean(directory, label) {
  const result = spawnSync("git", ["-C", directory, "status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not check ${label} working tree`);
  if (result.stdout.trim()) {
    throw new Error(`${label} has uncommitted changes; refusing to overwrite them`);
  }
}

function commitStaged(directory, message) {
  const result = spawnSync("git", ["-C", directory, "diff", "--cached", "--quiet"], {
    cwd: root,
    stdio: "ignore",
  });
  if (result.error) throw result.error;
  if (result.status === 0) return false;
  if (result.status !== 1) throw new Error("Could not inspect staged changes");
  gitIn(directory, "commit", "-m", message, "-m",
    "Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>");
  return true;
}

function ensureBundleBranch(bundleDir) {
  assertClean(bundleDir, "bundle");
  gitIn(bundleDir, "fetch", "origin", "bundle");
  const current = spawnSync("git", ["-C", bundleDir, "branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
  });
  if (current.error) throw current.error;
  if (current.status !== 0) throw new Error("Could not determine bundle branch");

  if (current.stdout.trim() !== "bundle") {
    const localBranch = spawnSync("git", ["-C", bundleDir, "show-ref", "--verify", "--quiet", "refs/heads/bundle"], {
      cwd: root,
      stdio: "ignore",
    });
    if (localBranch.error) throw localBranch.error;
    if (localBranch.status === 0) {
      gitIn(bundleDir, "switch", "bundle");
      gitIn(bundleDir, "merge", "--ff-only", "origin/bundle");
    } else {
      gitIn(bundleDir, "switch", "--create", "bundle", "--track", "origin/bundle");
    }
  } else {
    gitIn(bundleDir, "merge", "--ff-only", "origin/bundle");
  }
}

function ensureIdentity(directory) {
  const name = spawnSync("git", ["-C", directory, "config", "user.name"], { encoding: "utf8" });
  if (name.error) throw name.error;
  if (!name.stdout.trim()) gitIn(directory, "config", "user.name", "OpenBot");

  const email = spawnSync("git", ["-C", directory, "config", "user.email"], { encoding: "utf8" });
  if (email.error) throw email.error;
  if (!email.stdout.trim()) {
    gitIn(directory, "config", "user.email", "335604065+openbotgit[bot]@users.noreply.github.com");
  }
}

function writeBundleFile(bundleDir, file, contents) {
  writeFileSync(path.join(bundleDir, file), contents, "utf8");
}

try {
  const branch = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
  if (branch.error) throw branch.error;
  if (branch.status !== 0 || branch.stdout.trim() !== "main") {
    throw new Error("Run this script from the main superproject branch");
  }

  git("submodule", "update", "--init", "--remote", "backend", "frontend", "cli");

  const frontendDir = path.join(root, "frontend");
  const frontendBuild = path.join(frontendDir, "dist", "snip-frontend", "browser");
  run("npm", ["ci"], frontendDir);
  run(process.execPath, [path.join(frontendDir, "node_modules", "@angular", "cli", "bin", "ng.js"), "build"], frontendDir);
  if (!existsSync(path.join(frontendBuild, "index.html"))) {
    throw new Error(`Angular build output is missing ${path.join(frontendBuild, "index.html")}`);
  }

  const bundleDir = path.join(root, "bundle");
  ensureBundleBranch(bundleDir);
  ensureIdentity(bundleDir);

  const publicDir = path.join(bundleDir, "public");
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });
  cpSync(frontendBuild, publicDir, { recursive: true });
  cpSync(path.join(root, "backend", "server.js"), path.join(bundleDir, "server.js"));
  cpSync(path.join(root, "cli", "cli.js"), path.join(bundleDir, "cli.js"));

  writeBundleFile(bundleDir, ".env", "PUBLIC_DIR=./public\n");
  writeBundleFile(bundleDir, "package.json", `${JSON.stringify({
    name: "snip-bundle",
    version: "1.0.0",
    private: true,
    scripts: { start: "bun server.js" },
  }, null, 2)}\n`);
  writeBundleFile(bundleDir, "Dockerfile", [
    "FROM oven/bun:1-alpine",
    "COPY . .",
    "ENV PORT=3000",
    "EXPOSE 3000",
    "CMD [\"bun\", \"server.js\"]",
    "",
  ].join("\n"));
  writeBundleFile(bundleDir, ".dockerignore", [
    ".git",
    ".gitmodules",
    "node_modules",
    "*.log",
    "",
  ].join("\n"));
  writeBundleFile(bundleDir, "railway.json", `${JSON.stringify({
    "$schema": "https://railway.app/railway.schema.json",
    build: { builder: "DOCKERFILE" },
    deploy: {
      startCommand: "bun server.js",
      healthcheckPath: "/api/links",
      healthcheckTimeout: 100,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
  }, null, 2)}\n`);

  gitIn(bundleDir, "add", "-A");
  const bundleChanged = commitStaged(bundleDir, "Build generated Snip release bundle");

  git("add", "--", "backend", "frontend", "cli", "bundle");
  const mainChanged = commitStaged(root, "Update source and bundle submodule pointers");

  if (push) {
    gitIn(bundleDir, "push", "origin", "HEAD:refs/heads/bundle");
    git("push", "origin", "main");
  }

  if (bundleChanged || mainChanged) {
    console.log("Bundle generated; local bundle and main commits are ready.");
  } else {
    console.log("unchanged");
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `bundle_changed=${bundleChanged}\n`, "utf8");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
