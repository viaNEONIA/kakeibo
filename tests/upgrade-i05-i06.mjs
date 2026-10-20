import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
const BASE = "86cb704425de5f7f6675f2345176fab964796ffa";
const root = fileURLToPath(new URL("../", import.meta.url));
let upgraded = false;
const oldFiles = new Map();
for (const name of [
  "index.html",
  "sw.js",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/domain.js",
  "js/db.js",
  "js/schema.js",
  "js/validation.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
])
  oldFiles.set(
    name,
    execFileSync("git", ["show", BASE + ":" + name], {
      cwd: root,
      maxBuffer: 2 ** 20,
    }),
  );
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
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/kakeibo/")) {
      res.writeHead(404).end();
      return;
    }
    const relative = url.pathname.slice(9) || "index.html";
    const file = path.resolve(root, relative);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    const body = upgraded ? await readFile(file) : oldFiles.get(relative);
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type":
        mime[path.extname(relative)] || "application/octet-stream",
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
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext(),
  page = await context.newPage();
try {
  await page.goto(base + "#settings");
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await page.locator("#warning-percent").fill("75");
  await page.locator("#save").click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("保存しました"),
  );
  await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js"),
      { uuid, now, stateOf } = await import("./js/schema.js");
    const db = await openDatabase();
    try {
      const s = await db.snapshot();
      await db.command(
        "legacy-fixture",
        {},
        (s) => {
          const v = { revision: 1, createdAt: now(), updatedAt: now() },
            policy = uuid(),
            period = uuid(),
            cat = uuid();
          s.periodPolicies.push({
            id: policy,
            startDay: 1,
            effectiveFrom: "2026-10-01",
            ...v,
          });
          s.periods.push({
            id: period,
            policyId: policy,
            startDate: "2026-10-01",
            endDate: "2026-10-31",
            labelMonth: "2026-10",
            kind: "normal",
            state: "open",
            sequence: 1,
            ...v,
          });
          s.categories.push({
            id: cat,
            type: "expense",
            name: "旧版の食費",
            sortOrder: 0,
            active: true,
            ...v,
          });
          s.transactions.push({
            id: uuid(),
            type: "expense",
            date: "2026-10-20",
            periodId: period,
            categoryId: cat,
            amount: 420,
            name: "旧版データ",
            memo: "",
            ...v,
          });
          return [];
        },
        { expectedRevision: stateOf(s).datasetRevision },
      );
    } finally {
      db.close();
    }
  });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator("#warning-percent").fill("63");
  upgraded = true;
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    await r.update();
  });
  await page.locator("#update-panel").waitFor({ state: "visible" });
  assert.equal(await page.locator("#warning-percent").inputValue(), "63");
  console.log(
    "PASS I05 client waits for explicit I06 update and keeps unsaved draft",
  );
  page.once("dialog", (d) => d.accept());
  await Promise.all([
    page.waitForNavigation(),
    page.locator("#update").click(),
  ]);
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  assert.equal(await page.locator("#warning-percent").inputValue(), "75");
  assert.equal(await page.locator("[data-screen]").count(), 5);
  await page.locator('[data-screen="list"]').click();
  assert.match(
    await page.locator("#transaction-list").textContent(),
    /旧版データ.*420円/,
  );
  console.log(
    "PASS real I05 shell upgrades to I06 retaining settings and populated records",
  );
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  assert.match(
    await page.locator("#transaction-list").textContent(),
    /旧版データ/,
  );
  await page.locator('[data-screen="budget"]').click();
  await page.locator("#budget-base").waitFor({ state: "visible" });
  await page.locator("#budget-base").fill("5000");
  await page.locator("#budget-save").click();
  await page.waitForFunction(() =>
    document.getElementById("budget-base-value").textContent.includes("5,000"),
  );
  console.log(
    "PASS new I06 budget modules are cached and save works offline after upgrade",
  );
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
