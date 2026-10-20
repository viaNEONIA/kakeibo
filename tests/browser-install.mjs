import { chromium } from "playwright";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
let swVersion = "test-v1",
  legacy = true;
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
    if (
      pathname === "/stocklite/" ||
      pathname === "/stocklite/manifest.webmanifest"
    ) {
      res.writeHead(200, {
        "Content-Type": pathname.endsWith("webmanifest")
          ? "application/manifest+json"
          : "text/html",
        "Cache-Control": "no-store",
      });
      res.end(
        pathname.endsWith("webmanifest")
          ? JSON.stringify({
              name: "Sibling app",
              start_url: "./",
              scope: "./",
              display: "standalone",
            })
          : '<link rel="manifest" href="./manifest.webmanifest"><title>Sibling fixture</title>',
      );
      return;
    }
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
    if (relative === "manifest.webmanifest" && legacy) {
      const m = JSON.parse(body);
      m.id = "./";
      body = Buffer.from(JSON.stringify(m));
    }
    if (relative === "sw.js")
      body = Buffer.from(
        body
          .toString()
          .replace(/kakeibo-shell-v\d+/, "kakeibo-shell-" + swVersion),
      );
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
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
try {
  await page.goto(base + "#settings");
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  const cdp = await context.newCDPSession(page),
    origin = new URL(base).origin;
  let parsed = await cdp.send("Page.getAppManifest");
  assert.equal(parsed.manifest.id, origin + "/");
  assert.equal(parsed.manifest.startUrl, base);
  assert.equal(parsed.manifest.scope, base);
  check(
    "Chromium reproduces legacy id ./ resolving to origin root, not app folder",
  );
  const sibling = await context.newPage();
  await sibling.goto(origin + "/stocklite/");
  const other = await (
    await context.newCDPSession(sibling)
  ).send("Page.getAppManifest");
  assert.equal(other.manifest.id, origin + "/stocklite/");
  assert.equal(other.manifest.scope, origin + "/stocklite/");
  check(
    "sibling fixture without explicit id resolves to its distinct start URL",
  );
  await page.locator("#warning-percent").fill("77");
  await page.locator("#save").click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("保存しました"),
  );
  await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js"),
      { Ledger } = await import("./js/domain.js"),
      { stateOf } = await import("./js/schema.js");
    const d = await openDatabase();
    try {
      const l = new Ledger(d),
        s = await d.snapshot(),
        cat = (
          await l.saveCategory(
            { type: "expense", name: "識別検証" },
            undefined,
            stateOf(s).datasetRevision,
          )
        ).resultIds[0];
      await l.add(
        {
          type: "expense",
          date: "2026-10-20",
          categoryId: cat,
          amount: 1234,
          name: "保持確認",
          memo: "",
        },
        stateOf(await d.snapshot()).datasetRevision,
      );
    } finally {
      d.close();
    }
  });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const old = await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const d = await openDatabase();
    try {
      return await d.snapshot();
    } finally {
      d.close();
    }
  });
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration()).scope,
  );
  assert.equal(scope, base);
  assert.equal(
    await sibling.evaluate(() => navigator.serviceWorker.controller),
    null,
  );
  await page.evaluate(async () => {
    const c = await caches.open("stocklite-fixture-cache");
    await c.put("/stocklite/sentinel", new Response("keep"));
  });
  check(
    "kakeibo worker scope excludes sibling and separate cache marker is present",
  );
  legacy = false;
  swVersion = "test-v2";
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update();
  });
  await page.locator("#update-panel").waitFor({ state: "visible" });
  page.once("dialog", (d) => d.accept());
  await Promise.all([
    page.waitForNavigation(),
    page.locator("#update").click(),
  ]);
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  parsed = await cdp.send("Page.getAppManifest");
  assert.equal(parsed.manifest.id, base);
  assert.equal(parsed.manifest.startUrl, base);
  assert.equal(parsed.manifest.scope, base);
  assert.notEqual(parsed.manifest.id, other.manifest.id);
  assert.deepEqual(parsed.errors, []);
  check(
    "explicit worker update refreshes manifest to /kakeibo/ identity with unchanged start/scope",
  );
  const next = await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const d = await openDatabase();
    try {
      return await d.snapshot();
    } finally {
      d.close();
    }
  });
  assert.deepEqual(next, old);
  assert.equal(await page.locator("#warning-percent").inputValue(), "77");
  assert.equal(
    await page.evaluate(
      async () => await (await caches.match("/stocklite/sentinel")).text(),
    ),
    "keep",
  );
  check("all IndexedDB records and sibling cache survive app identity update");
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  parsed = await cdp.send("Page.getAppManifest");
  assert.equal(parsed.manifest.id, base);
  check(
    "correct identity and existing data remain available after offline restart",
  );
  assert.deepEqual(errors, []);
  console.log("Manifest identity browser checks passed:", passed);
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
