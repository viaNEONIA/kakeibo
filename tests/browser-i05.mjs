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
  await page
    .locator("#restore-file")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await page.locator("#restore-dialog").waitFor({ state: "visible" });
  await page.locator("#confirm-restore").click();
  await page.locator("#restore-dialog").waitFor({ state: "hidden" });
}
try {
  await page.goto(base);
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  assert.equal(await page.locator("[data-screen]").count(), 5);
  assert(await page.locator("#screen-home").isVisible());
  await screen("input");
  await page.goBack();
  assert(await page.locator("#screen-home").isVisible());
  await screen("settings");
  const initial = await backup();
  check("five screens and I04 backup format");
  for (const name of [
    "食費",
    "交通費",
    "日用品",
    "医療費",
    "雑費",
    "通信費",
    "交際費",
  ])
    await category(name);
  await screen("input");
  assert.equal(
    await page.locator("#category-buttons [data-category-id]").count(),
    6,
  );
  assert(await page.locator("#show-more-categories").isVisible());
  await page.locator("#show-more-categories").click();
  const allCats = (await snapshot()).categories;
  const seventh = allCats.find((c) => c.name === "交際費");
  await page.locator("#category-select").selectOption(seventh.id);
  assert.match(
    await page.locator("#show-more-categories").textContent(),
    /交際費/,
  );
  check("six category shortcuts plus all-category selection");
  await page
    .locator(
      `[data-category-id="${allCats.find((c) => c.name === "食費").id}"]`,
    )
    .click();
  await register(350, "パン");
  await register(350, "パン");
  assert.equal((await snapshot()).transactions.length, 2);
  await page.locator("#undo").click();
  await page.waitForFunction(() => document.getElementById("undo").hidden);
  assert.equal((await snapshot()).transactions.length, 1);
  check("keypad continuous same-amount registration and immediate undo");
  await page.locator('[data-type="refund"]').click();
  await register(50, "返金");
  await screen("settings");
  await page.locator('[data-category-type="income"]').click();
  await category("給与");
  await screen("input");
  await page.locator('[data-type="income"]').click();
  await register(10000, "給与");
  await screen("home");
  assert.equal(await page.locator("#home-income").textContent(), "10,000円");
  assert.equal(await page.locator("#home-expense").textContent(), "300円");
  assert.equal(await page.locator("#home-net").textContent(), "9,700円");
  check("income, refund and home totals");
  await screen("list");
  assert.equal(
    await page.locator("#transaction-list .transaction-row").count(),
    3,
  );
  const food = (await snapshot()).transactions.find((t) => t.name === "パン");
  await page
    .locator(`#transaction-list [data-transaction-id="${food.id}"]`)
    .click();
  await page.locator("#edit-amount").fill("500");
  await page.locator("#edit-date").fill("2026-11-01");
  await page.locator("#edit-name").fill("<b>変更</b>");
  await page.locator('#edit-form button[type="submit"]').click();
  await page.locator("#edit-dialog").waitFor({ state: "hidden" });
  const saved = (await snapshot()).transactions.find((t) => t.id === food.id);
  assert.equal(saved.amount, 500);
  assert.equal(saved.date, "2026-11-01");
  assert.equal(await page.locator("#transaction-list b").count(), 0);
  check("one-row edit, cross-period move and text-safe rendering");
  await page.locator("#filters summary").click();
  await page.locator("#filter-query").fill("変更");
  assert.equal(
    await page.locator("#transaction-list .transaction-row").count(),
    1,
  );
  await page.locator("#filter-type").selectOption("income");
  assert.equal(
    await page.locator("#transaction-list .transaction-row").count(),
    0,
  );
  await page.locator("#reset-filters").click();
  await page.locator("#filter-min").fill("400");
  await page.locator("#filter-max").fill("600");
  assert.equal(
    await page.locator("#transaction-list .transaction-row").count(),
    1,
  );
  await page.locator("#reset-filters").click();
  await page.locator("#filter-from").fill("2026-11-01");
  assert.equal(
    await page.locator("#transaction-list .transaction-row").count(),
    1,
  );
  await page.locator("#reset-filters").click();
  check("combined name, type, amount and date filters");
  await page.locator("#show-date").uncheck();
  await page.locator("#show-category").uncheck();
  await page.locator("#list-sort").selectOption("amount-desc");
  await page.locator("#save-view").click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("表示設定を保存"),
  );
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  assert.equal(await page.locator("#show-date").isChecked(), false);
  assert.equal(await page.locator("#list-sort").inputValue(), "amount-desc");
  assert.equal(await page.locator("#transaction-list .date").count(), 0);
  check("list column and sort preferences survive reload");
  const salary = (await snapshot()).transactions.find((t) => t.name === "給与");
  await page
    .locator(`#transaction-list [data-transaction-id="${salary.id}"]`)
    .click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#delete-transaction").click();
  await page.locator("#edit-dialog").waitFor({ state: "hidden" });
  assert.equal((await snapshot()).transactions.length, 2);
  check("delete after explicit confirmation");
  await screen("settings");
  await page.locator('[data-category-type="expense"]').click();
  await page.getByRole("button", { name: "食費を下へ", exact: true }).click();
  await page.waitForFunction(() =>
    document.getElementById("message").textContent.includes("順序を変更"),
  );
  await page.getByRole("button", { name: "食費を編集", exact: true }).click();
  await page.locator("#category-name").fill("食料品");
  await page.locator("#category-active").uncheck();
  await page.locator('#category-form button[type="submit"]').click();
  await page.locator("#category-dialog").waitFor({ state: "hidden" });
  const s = await snapshot();
  assert.equal(s.categories.find((c) => c.name === "交通費").sortOrder, 0);
  assert.equal(s.categories.find((c) => c.name === "食料品").active, false);
  await screen("list");
  await page.locator("#transaction-list .transaction-row").first().click();
  assert.match(
    await page.locator("#edit-category option:checked").textContent(),
    /食料品.*無効/,
  );
  await page.locator('[data-close="edit-dialog"]').click();
  check("category reorder, rename, disable and historical edit");
  await screen("settings");
  const full = await backup();
  await restore(initial);
  assert.equal((await snapshot()).transactions.length, 0);
  await restore(full);
  assert.equal((await snapshot()).transactions.length, 2);
  assert.equal(await page.locator("#show-date").isChecked(), false);
  check("I04 backup compatibility and populated I05 restore");
  await screen("input");
  await page.locator('[data-type="expense"]').click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await register(999, "オフライン");
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  assert((await snapshot()).transactions.some((t) => t.name === "オフライン"));
  check("new domain module and transaction write work after offline restart");
  await context.setOffline(false);
  await amount(42);
  const other = await context.newPage();
  await other.goto(base + "#settings");
  await other.waitForFunction(() => !document.getElementById("save").disabled);
  await other.locator("#warning-percent").fill("79");
  await other.locator("#save").click();
  await page.locator("#reload").waitFor({ state: "visible" });
  assert.equal(await page.locator("#amount").inputValue(), "42");
  assert(await page.locator("#register").isDisabled());
  await other.close();
  page.once("dialog", (d) => d.accept());
  await page.locator("#reload").click();
  await page.waitForFunction(() => document.getElementById("reload").hidden);
  check("other-tab change preserves draft and prevents stale save");
  await screen("input");
  await page.screenshot({
    path: process.env.I05_SCREENSHOT || "/tmp/kakeibo-i05-input.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await screen("list");
  await page.screenshot({ path: "/tmp/kakeibo-i05-list.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await screen("input");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await screen("settings");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  check("412px and 320px responsive layouts");
  assert.deepEqual(errors, []);
  check("no browser JavaScript exceptions");
  console.log("I05 browser checks passed:", passed);
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
