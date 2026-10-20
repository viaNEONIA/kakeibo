import { chromium } from "playwright";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
let swVersion = "test-v1",
  label = "initial",
  mode = "ok",
  manifestRequests = 0;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (!pathname.startsWith("/kakeibo/")) {
      res.writeHead(404).end();
      return;
    }
    const relative = pathname.slice("/kakeibo/".length) || "index.html";
    const file = path.resolve(root, relative);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    let body = await readFile(file);
    if (relative === "manifest.webmanifest") {
      manifestRequests++;
      if (mode === "error") {
        res.writeHead(503, { "Cache-Control": "no-store" }).end("unavailable");
        return;
      }
      if (mode === "invalid") {
        res
          .writeHead(200, {
            "Content-Type": "text/html",
            "Cache-Control": "no-store",
          })
          .end("<html>error</html>");
        return;
      }
      if (mode === "slow") {
        setTimeout(() => {
          if (!res.destroyed)
            res
              .writeHead(200, { "Content-Type": "application/manifest+json" })
              .end(body);
        }, 5000);
        return;
      }
      const data = JSON.parse(body);
      data.description = label;
      body = Buffer.from(JSON.stringify(data));
    }
    if (relative === "sw.js")
      body = Buffer.from(
        body
          .toString()
          .replace(/kakeibo-shell-v\d+/, "kakeibo-shell-" + swVersion),
      );
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control":
        relative === "manifest.webmanifest" ? "max-age=3600" : "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/kakeibo/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 412, height: 820 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let passed = 0;
const check = (name) => {
  passed++;
  console.log("PASS", name);
};
const fetchManifest = () =>
  page.evaluate(async () => {
    try {
      return await (await fetch("./manifest.webmanifest")).json();
    } catch (e) {
      return { failed: true };
    }
  });
const cacheManifest = () =>
  page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration(),
      prefix = "kakeibo:" + new URL(r.scope).pathname + ":",
      names = (await caches.keys()).filter((n) => n.startsWith(prefix));
    const c = await caches.open(names[0]);
    return (await c.match(new URL("./manifest.webmanifest", r.scope))).json();
  });
try {
  await page.goto(base + "#settings");
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await page.locator("#warning-percent").fill("77");
  await page.locator("#save").click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("保存しました"),
  );
  const before = await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const d = await openDatabase();
    try {
      return await d.snapshot();
    } finally {
      d.close();
    }
  });
  const sibling = "stocklite-fixture-cache";
  await page.evaluate(async (name) => {
    await (
      await caches.open(name)
    ).put("/stocklite/sentinel", new Response("keep"));
  }, sibling);
  const initial = await fetchManifest();
  assert.equal(initial.description, "initial");
  const count = manifestRequests;
  label = "fresh-without-shell-update";
  const fresh = await fetchManifest();
  assert.equal(fresh.description, label);
  assert(manifestRequests > count);
  assert.equal((await cacheManifest()).description, label);
  check(
    "same-URL online request bypasses warm HTTP/cache API entries and stores fresh manifest without worker update",
  );
  mode = "error";
  assert.equal((await fetchManifest()).description, label);
  assert.equal((await cacheManifest()).description, label);
  check("HTTP failure uses last good manifest and never overwrites it");
  mode = "invalid";
  assert.equal((await fetchManifest()).description, label);
  assert.equal((await cacheManifest()).description, label);
  check("invalid successful response falls back without replacing good JSON");
  mode = "slow";
  const start = Date.now();
  assert.equal((await fetchManifest()).description, label);
  assert(Date.now() - start < 4500);
  check("stalled request aborts at bounded timeout and serves cached manifest");
  mode = "ok";
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  assert.equal((await fetchManifest()).description, label);
  assert.equal(await page.locator("#warning-percent").inputValue(), "77");
  check("offline restart keeps app and latest saved manifest available");
  await context.setOffline(false);
  mode = "error";
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration(),
      prefix = "kakeibo:" + new URL(r.scope).pathname + ":";
    for (const n of await caches.keys())
      if (n.startsWith(prefix))
        await (
          await caches.open(n)
        ).delete(new URL("./manifest.webmanifest", r.scope));
  });
  assert.equal((await fetchManifest()).failed, true);
  mode = "ok";
  label = "recovered";
  assert.equal((await fetchManifest()).description, label);
  check(
    "missing fallback surfaces fetch failure, then network recovery replenishes cache",
  );
  const after = await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const d = await openDatabase();
    try {
      return await d.snapshot();
    } finally {
      d.close();
    }
  });
  assert.deepEqual(after, before);
  assert.equal(
    await page.evaluate(
      async () => await (await caches.match("/stocklite/sentinel")).text(),
    ),
    "keep",
  );
  check("all IndexedDB records and sibling cache remain unchanged");
  assert.deepEqual(errors, []);
  console.log("Manifest refresh browser checks passed:", passed);
} finally {
  await context.close();
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
