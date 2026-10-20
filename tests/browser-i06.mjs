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
  viewport: { width: 412, height: 915 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let passed = 0;
const check = (name) => {
  passed++;
  console.log("PASS", name);
};
const screen = async (name) => {
  await page.locator(`[data-screen="${name}"]`).click();
  await page.locator("#screen-" + name).waitFor({ state: "visible" });
};
const snapshot = () =>
  page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const db = await openDatabase();
    try {
      return await db.snapshot();
    } finally {
      db.close();
    }
  });
async function category(name) {
  await page.locator("#add-category").click();
  await page.locator("#category-name").fill(name);
  await page.locator('#category-form button[type="submit"]').click();
  await page.locator("#category-dialog").waitFor({ state: "hidden" });
}
async function amount(n) {
  await page.locator("#clear-amount").click();
  for (const key of String(n))
    await page.locator(`[data-key="${key}"]`).click();
}
async function register(n, name, date = "2026-10-20") {
  await amount(n);
  await page.locator("#transaction-name").fill(name);
  await page.locator("#transaction-date").fill(date);
  await page.locator("#register").click();
  await page.waitForFunction(
    () => document.getElementById("amount").value === "",
  );
}
async function backup() {
  const promise = page.waitForEvent("download");
  await page.locator("#backup").click();
  const download = await promise;
  return JSON.parse(await readFile(await download.path(), "utf8"));
}
async function restore(data) {
  await page.locator("#restore-file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.locator("#restore-dialog").waitFor({ state: "visible" });
  await page.locator("#confirm-restore").click();
  await page.locator("#restore-dialog").waitFor({ state: "hidden" });
}
try {
  page.on("dialog", (d) => d.accept());
  await page.clock.setFixedTime(new Date("2026-10-20T03:00:00Z"));
  await page.goto(base);
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await screen("settings");
  await category("食費");
  await screen("budget");
  await page.locator("#budget-base").waitFor({ state: "visible" });
  await page.locator("#budget-date").fill("2026-10-20");
  await page.locator("#budget-show").click();
  await page.waitForFunction(
    () =>
      document.getElementById("budget-range").textContent ===
      "2026-10-01〜2026-10-31",
  );
  await page
    .locator("#opening-form")
    .evaluate((e) => (e.closest("details").open = true));
  await page.locator("#opening-amount").fill("30000");
  await page.locator("#opening-submit").click();
  await page.waitForFunction(() =>
    document.getElementById("pool-balance").textContent.includes("30,000"),
  );
  await page.locator("#budget-base").fill("100000");
  await page.locator("[data-category-budget]").first().fill("100000");
  await page.locator("#budget-save").click();
  await page.waitForFunction(() =>
    document
      .getElementById("budget-base-value")
      .textContent.includes("100,000"),
  );
  await page.locator("#allocate-amount").fill("20000");
  await page.locator("#allocate-submit").click();
  await page.waitForFunction(() =>
    document.getElementById("budget-available").textContent.includes("120,000"),
  );
  check("budget, category distribution, opening and manual allocation");
  await screen("input");
  await register(110000, "I06支出");
  await screen("budget");
  await page.waitForFunction(() =>
    document.getElementById("budget-expense").textContent.includes("110,000"),
  );
  await page.locator("#close-period").click();
  await page.waitForFunction(
    () => document.getElementById("budget-state").textContent === "締め済み",
  );
  assert.match(await page.locator("#pool-balance").textContent(), /20,000/);
  let state = await snapshot(),
    count = state.carryoverEntries.length;
  await page.locator("#close-period").click();
  await page.waitForFunction(
    () => !document.getElementById("close-period").disabled,
  );
  assert.equal((await snapshot()).carryoverEntries.length, count);
  await page.locator("[data-cancel-allocation]").click();
  await page.waitForFunction(() =>
    document
      .getElementById("allocation-history")
      .textContent.includes("取消済み"),
  );
  assert.match(await page.locator("#pool-balance").textContent(), /20,000/);
  check("manual close, idempotent reclose and audited allocation cancellation");
  await page.locator("#budget-next").click();
  await page.waitForFunction(
    () =>
      document.getElementById("budget-range").textContent ===
      "2026-11-01〜2026-11-30",
  );
  await page.locator("#budget-copy").click();
  await page.waitForFunction(() =>
    document
      .getElementById("budget-base-value")
      .textContent.includes("100,000"),
  );
  assert.match(
    await page.locator("#budget-allocation-value").textContent(),
    /0/,
  );
  assert.match(await page.locator("#budget-expense").textContent(), /0/);
  check("previous-period copy excludes allocation and actuals");
  await page.locator("#budget-prev").click();
  await page.waitForFunction(() =>
    document.getElementById("budget-range").textContent.includes("2026-10-01"),
  );
  await page
    .locator("#adjust-form")
    .evaluate((e) => (e.closest("details").open = true));
  await page.locator("#adjust-amount").fill("-30000");
  await page.locator("#adjust-submit").click();
  await page.waitForFunction(() =>
    document.getElementById("pool-unsettled").textContent.includes("10,000"),
  );
  assert(await page.locator("#allocate-submit").isDisabled());
  await page.locator("#budget-next").click();
  await page.waitForFunction(() =>
    document.getElementById("budget-range").textContent.includes("2026-11-01"),
  );
  await page.locator("#close-period").click();
  await page.waitForFunction(
    () => document.getElementById("budget-state").textContent === "締め済み",
  );
  assert.match(await page.locator("#pool-balance").textContent(), /90,000/);
  assert.equal(await page.locator("#pool-unsettled").textContent(), "0円");
  check(
    "negative balance shown as unsettled, allocation blocked, later surplus resolves",
  );
  await screen("settings");
  await page.locator("#policy-start-day").selectOption("25");
  await page.locator("#policy-submit").click();
  await page.waitForFunction(() =>
    document.getElementById("policy-preview").textContent.includes("25"),
  );
  state = await snapshot();
  assert(
    state.periods.some(
      (p) =>
        p.startDate === "2026-12-01" &&
        p.endDate === "2026-12-24" &&
        p.kind === "transition",
    ),
  );
  assert(
    state.periods.some(
      (p) => p.startDate === "2026-12-25" && p.endDate === "2027-01-24",
    ),
  );
  assert(
    state.periods.some(
      (p) => p.startDate === "2026-10-01" && p.endDate === "2026-10-31",
    ),
  );
  check("period-start change retains closed boundaries and creates transition");
  const data = await backup();
  await restore(data);
  state = await snapshot();
  assert.equal(
    state.carryoverEntries.length,
    data.stores.carryoverEntries.length,
  );
  await screen("budget");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("budget-save").disabled,
  );
  assert.match(await page.locator("#pool-balance").textContent(), /90,000/);
  await page.locator("#budget-base").fill("101000");
  await page.locator("#budget-save").click();
  await page.waitForFunction(() =>
    document
      .getElementById("budget-base-value")
      .textContent.includes("101,000"),
  );
  check("budget and pool survive whole restore and offline reload/save");
  await page.locator("#history-details").evaluate((e) => (e.open = true));
  for (const width of [412, 320]) {
    await page.setViewportSize({ width, height: 915 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.screenshot({
    path: "/tmp/kakeibo-i06-budget.png",
    fullPage: true,
  });
  check("budget screen fits 412px and 320px");
  assert.deepEqual(errors, []);
  check("no browser JavaScript errors");
  console.log("I06 browser checks passed:", passed);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
