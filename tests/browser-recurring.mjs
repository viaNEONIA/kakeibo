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
await context.addInitScript(() => {
  const original = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download.endsWith(".csv")) return;
    return original.call(this);
  };
});
page.on("dialog", (d) => d.accept());
async function snap() {
  return page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const d = await openDatabase();
    try {
      return await d.snapshot();
    } finally {
      d.close();
    }
  });
}
async function createRule(type, name, amount) {
  await page.locator("#recurring-type").selectOption(type);
  await page.locator("#recurring-name").fill(name);
  await page.locator("#recurring-amount").fill(String(amount));
  await page.locator("#recurring-day").fill("31");
  await page.locator("#recurring-start").fill("2026-01");
  await page.locator("#recurring-save").click();
  await page.waitForFunction(
    () => !document.getElementById("recurring-save").disabled,
  );
  return (await snap()).recurringRules.find((r) => r.name === name).id;
}
async function csvDownload(id) {
  await page.locator("#" + id).click();
  await page.locator("#file-save-link").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#file-save-link").textContent(),
    "CSVを保存",
  );
  assert.match(
    await page.locator("#file-share-help-title").textContent(),
    /CSV/,
  );
  const pending = page.waitForEvent("download");
  await page.locator("#file-save-link").click();
  const d = await pending;
  assert.match(d.suggestedFilename(), /\.csv$/);
  return readFile(await d.path(), "utf8");
}
try {
  await page.goto(base + "#settings");
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const { Ledger } = await import("./js/domain.js");
    const { stateOf } = await import("./js/schema.js");
    const d = await openDatabase();
    try {
      for (const type of ["expense", "income"])
        await new Ledger(d).saveCategory(
          { type, name: type },
          undefined,
          stateOf(await d.snapshot()).datasetRevision,
        );
    } finally {
      d.close();
    }
  });
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("recurring-save").disabled,
  );
  await page.locator("#recurring-details").evaluate((e) => (e.open = true));
  await page.locator("#recurring-month").fill("2026-02");
  const expense = await createRule("expense", "家賃", 1000);
  assert.equal((await snap()).transactions.length, 0);
  assert.match(
    await page.locator("#recurring-schedule").textContent(),
    /2026-02-28.*未確定/,
  );
  await page.locator(`[data-recurring-confirm="${expense}"]`).click();
  await page.waitForFunction(() =>
    document
      .getElementById("recurring-schedule")
      .textContent.includes("確定済み"),
  );
  assert.equal((await snap()).transactions.length, 1);
  check(
    "31st day becomes February month end and manual confirmation alone creates actual expense",
  );
  const income = await createRule("income", "給与", 2000);
  await page.locator(`[data-recurring-confirm="${income}"]`).click();
  await page.waitForFunction(
    (id) => !document.querySelector(`[data-recurring-confirm="${id}"]`),
    income,
  );
  let data = await snap();
  assert.equal(data.transactions.length, 2);
  assert(data.periodBudgets.every((b) => b.baseBudget === 0));
  check("recurring income confirms once without increasing budget");
  await page
    .locator("#recurring-rules")
    .evaluate((e) => (e.parentElement.open = true));
  await page.locator(`[data-recurring-edit="${expense}"]`).click();
  await page.locator("#recurring-amount").fill("1500");
  await page.locator("#recurring-enabled").uncheck();
  await page.locator("#recurring-save").click();
  await page.waitForFunction(
    () => !document.getElementById("recurring-save").disabled,
  );
  data = await snap();
  assert.equal(
    data.transactions.find((t) => t.type === "expense").amount,
    1000,
  );
  assert.equal(
    data.recurringOccurrences.find((o) => o.ruleId === expense).snapshot.amount,
    1000,
  );
  await page.locator("#recurring-month").fill("2026-03");
  assert.equal(
    await page.locator(`[data-recurring-confirm="${expense}"]`).count(),
    0,
  );
  check(
    "editing and disabling a rule preserve confirmed actuals and stop new plans",
  );
  const before = await snap(),
    tx = await csvDownload("csv-transactions"),
    pool = await csvDownload("csv-pool");
  assert(tx.startsWith("\uFEFF"));
  assert.match(tx, /家賃/);
  assert.match(tx, /給与/);
  assert.match(tx, /集計期間開始日/);
  assert.match(pool, /当時の目標額/);
  assert.match(pool, /2026-02/);
  assert.deepEqual(await snap(), before);
  check(
    "separate BOM CSVs download through retained manual links without changing stored data",
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  assert.equal((await snap()).recurringRules.length, 2);
  assert.match(await csvDownload("csv-transactions"), /家賃/);
  await page.locator("#recurring-details").evaluate((e) => (e.open = true));
  for (const width of [320, 412]) {
    await page.setViewportSize({ width, height: 820 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  assert.deepEqual(errors, []);
  check("recurring settings and CSV persist offline and fit narrow screens");
  console.log(`Recurring/CSV browser checks passed: ${passed}`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
