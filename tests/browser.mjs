import { chromium } from "playwright";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
let swVersion = "test-v1";
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
  assert.match(await page.locator("#db-status").textContent(), /保存できます/);
  check("repository-subpath startup");
  await page.locator("#warning-percent").fill("77");
  await page.locator("#save").click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("保存しました"),
  );
  await page.reload();
  await page.waitForFunction(
    () => document.getElementById("warning-percent").value === "77",
  );
  check("real IndexedDB persists after reload");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#backup").click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(Object.keys(backup.stores).length, 17);
  assert.equal(backup.stores.settings[0].value.warningPercent, 77);
  check("17-store JSON download");
  await page.locator("#warning-percent").fill("55");
  await page.locator("#save").click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("保存しました"),
  );
  await page
    .locator("#restore-file")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await page.locator("#restore-dialog").waitFor({ state: "visible" });
  await page.locator("#confirm-restore").click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("復元しました"),
  );
  assert.equal(await page.locator("#warning-percent").inputValue(), "77");
  check("explicit full-replacement confirmation and restore");
  const malformed = structuredClone(backup);
  malformed.stores.settings.push({ ...malformed.stores.settings[0] });
  malformed.recordCounts.settings++;
  await page
    .locator("#restore-file")
    .setInputFiles({
      name: "corrupt.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(malformed)),
    });
  await page.waitForFunction(() =>
    document.getElementById("message").classList.contains("error"),
  );
  assert.equal(await page.locator("#warning-percent").inputValue(), "77");
  assert.equal(await page.locator("#restore-dialog").isVisible(), false);
  check("duplicate-key file rejected before replacement");
  const api = await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const { stateOf, uuid } = await import("./js/schema.js");
    const a = await openDatabase(),
      b = await openDatabase();
    try {
      const rev = stateOf(await a.snapshot()).datasetRevision;
      const race = await Promise.allSettled([
        a.savePreferences({ warningPercent: 72 }, rev),
        b.savePreferences({ warningPercent: 73 }, rev),
      ]);
      if (race.filter((r) => r.status === "fulfilled").length !== 1)
        throw Error("race");
      const before = await a.snapshot(),
        file = await a.backup(),
        put = IDBObjectStore.prototype.put;
      let count = 0;
      IDBObjectStore.prototype.put = function (...args) {
        if (++count === 4) throw Error("injected");
        return put.apply(this, args);
      };
      let rejected = false;
      try {
        await a.restore(file, stateOf(before).datasetRevision);
      } catch {
        rejected = true;
      } finally {
        IDBObjectStore.prototype.put = put;
      }
      if (
        !rejected ||
        JSON.stringify(await a.snapshot()) !== JSON.stringify(before)
      )
        throw Error("rollback");
      await a.restore(file, stateOf(before).datasetRevision);
      let stale = false;
      try {
        await b.savePreferences(
          { warningPercent: 44 },
          stateOf(before).datasetRevision,
        );
      } catch {
        stale = true;
      }
      if (!stale) throw Error("generation");
      return true;
    } finally {
      a.close();
      b.close();
    }
  });
  assert(api);
  check(
    "real IndexedDB two-client conflict, mid-write rollback and restore-generation protection",
  );
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await page.locator("#warning-percent").fill("76");
  await page.locator("#save").click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("保存しました"),
  );
  assert.equal(await page.locator("#network").textContent(), "オフライン");
  check("offline reload and IndexedDB write");
  await context.setOffline(false);
  swVersion = "v2";
  await page.locator("#warning-percent").fill("63");
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    await r.update();
  });
  await page.locator("#update-panel").waitFor({ state: "visible" });
  assert.equal(await page.locator("#warning-percent").inputValue(), "63");
  check("waiting worker does not reload dirty form");
  page.once("dialog", (dialog) => dialog.accept());
  await Promise.all([
    page.waitForNavigation(),
    page.locator("#update").click(),
  ]);
  await page.waitForFunction(
    () => document.getElementById("warning-percent").value === "76",
  );
  check("explicit worker update preserves stored data");
  await page.screenshot({
    path: process.env.SCREENSHOT_PATH || "/tmp/kakeibo-foundation.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  check("412px viewport has no horizontal overflow");
  await page.setViewportSize({ width: 320, height: 640 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  check("320px viewport has no horizontal overflow");
  const upgradeContext = await browser.newContext();
  const upgradePage = await upgradeContext.newPage();
  await upgradePage.goto(base + "#settings");
  await upgradePage.waitForFunction(
    () => !document.getElementById("save").disabled,
  );
  await upgradePage.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("kakeibo-pwa", 2);
        r.onupgradeneeded = () => {};
        r.onsuccess = () => {
          r.result.close();
          resolve();
        };
        r.onerror = () => reject(r.error);
      }),
  );
  await upgradePage.waitForFunction(() =>
    document.getElementById("message").textContent.includes("アプリを再起動"),
  );
  assert(await upgradePage.locator("#save").isDisabled());
  await upgradeContext.close();
  check("DB versionchange closes connection and stops editing without reset");
  assert.deepEqual(errors, []);
  check("no browser JavaScript errors");
  console.log(`Browser checks passed: ${passed}`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
