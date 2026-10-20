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
const extra = [];
async function nav(pg, name) {
  await pg.locator(`[data-screen="${name}"]`).click();
  await pg.locator("#screen-" + name).waitFor({ state: "visible" });
}
async function fileDownload(pg, action) {
  const wait = pg.waitForEvent("download");
  await action();
  return JSON.parse(await readFile(await (await wait).path(), "utf8"));
}
async function upload(pg, id, data) {
  await pg
    .locator(id)
    .setInputFiles({
      name: "fixture.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
}
const snap = (pg) =>
  pg.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const d = await openDatabase();
    try {
      return await d.snapshot();
    } finally {
      d.close();
    }
  });
try {
  page.on("dialog", (d) => d.accept());
  await page.clock.setFixedTime(new Date("2026-10-20T03:00:00Z"));
  await page.goto(base + "#settings");
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await category("食費");
  await screen("input");
  await register(100, "復旧検証");
  await screen("budget");
  await page.locator("#budget-base").fill("1000");
  await page.locator("#budget-save").click();
  await page.waitForFunction(() =>
    document.getElementById("budget-base-value").textContent.includes("1,000"),
  );
  await page.locator("#close-period").click();
  await page.waitForFunction(
    () => document.getElementById("budget-state").textContent === "締め済み",
  );
  await screen("settings");
  await page.locator("#family-parent-name").fill("復旧用の親");
  await page.locator("#family-setup").click();
  await page.waitForFunction(() =>
    document.getElementById("family-status").textContent.includes("復旧用の親"),
  );
  await page.locator("#family-child-name").fill("登録済みの子");
  const invitation = await fileDownload(page, () =>
      page.locator("#family-register").click(),
    ),
    data = await fileDownload(page, () => page.locator("#backup").click());
  const ctx = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 412, height: 915 },
    }),
    fresh = await ctx.newPage();
  extra.push(ctx);
  fresh.on("pageerror", (e) => errors.push(e.message));
  await fresh.clock.setFixedTime(new Date("2026-10-20T03:00:00Z"));
  await fresh.goto(base + "#settings");
  await fresh.waitForFunction(() => !document.getElementById("save").disabled);
  await upload(fresh, "#restore-file", data);
  await fresh.locator("#restore-dialog").waitFor({ state: "visible" });
  assert(await fresh.locator("#parent-recovery-option").isVisible());
  assert(await fresh.locator("#confirm-restore").isDisabled());
  await fresh.locator("#cancel-restore").click();
  assert.equal((await snap(fresh)).transactions.length, 0);
  check(
    "fresh profile offers explicit parent recovery; unchecked confirmation blocks and cancel preserves data",
  );
  await upload(fresh, "#restore-file", data);
  await fresh.locator("#restore-dialog").waitFor({ state: "visible" });
  await fresh.locator("#parent-recovery-confirm").check();
  await fresh.locator("#confirm-restore").click();
  await fresh.locator("#restore-dialog").waitFor({ state: "hidden" });
  await fresh.waitForFunction(() =>
    document.getElementById("message").textContent.includes("親として"),
  );
  let recovered = await snap(fresh);
  const own = recovered.meta.find((r) => r.key === "state").sharing,
    source = data.stores.meta.find((r) => r.key === "state").sharing;
  assert.equal(own.deviceId, source.deviceId);
  assert.equal(own.bookId, source.bookId);
  assert.deepEqual(own.members, source.members);
  for (const name of Object.keys(data.stores).filter(
    (n) => !["meta", "operationReceipts"].includes(n),
  ))
    assert.deepEqual(recovered[name], data.stores[name]);
  check(
    "confirmation restores original parent, child roster and all business stores without changing source backup",
  );
  await fresh.evaluate(() => navigator.serviceWorker.ready);
  await fresh.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await fresh.reload();
  await fresh.waitForFunction(
    () => !document.getElementById("family-export").disabled,
  );
  assert.match(
    await fresh.locator("#family-status").textContent(),
    /復旧用の親/,
  );
  await nav(fresh, "budget");
  assert.equal(await fresh.locator("#pool-balance").textContent(), "900円");
  assert(!(await fresh.locator("#close-period").isDisabled()));
  await ctx.setOffline(false);
  await nav(fresh, "settings");
  check(
    "recovered parent and restored pool persist through offline restart with parent controls",
  );
  const childCtx = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 412, height: 915 },
    }),
    child = await childCtx.newPage();
  extra.push(childCtx);
  child.on("pageerror", (e) => errors.push(e.message));
  await child.clock.setFixedTime(new Date("2026-10-20T03:00:00Z"));
  await child.goto(base + "#settings");
  await child.waitForFunction(() => !document.getElementById("save").disabled);
  await upload(child, "#family-join-file", invitation);
  await child.locator("#family-dialog").waitFor({ state: "visible" });
  await child.locator("#family-confirm").click();
  await child.locator("#family-dialog").waitFor({ state: "hidden" });
  await nav(child, "input");
  for (const k of "50") await child.locator(`[data-key="${k}"]`).click();
  await child.locator("#transaction-date").fill("2026-10-20");
  await child.locator("#register").click();
  await child.waitForFunction(
    () => document.getElementById("amount").value === "",
  );
  await nav(child, "settings");
  const childFile = await fileDownload(child, () =>
    child.locator("#family-export").click(),
  );
  for (let i = 0; i < 2; i++) {
    await upload(fresh, "#family-import-file", childFile);
    await fresh.locator("#family-dialog").waitFor({ state: "visible" });
    await fresh.locator("#family-confirm").click();
    await fresh.locator("#family-dialog").waitFor({ state: "hidden" });
  }
  recovered = await snap(fresh);
  assert.equal(recovered.transactions.length, 2);
  assert.equal(
    recovered.carryoverEntries.reduce((n, e) => n + e.delta, 0),
    850,
  );
  assert.equal(recovered.closingRevisions.length, 2);
  check(
    "registered child can merge with recovered parent and repeated import never doubles settlement",
  );
  await upload(child, "#restore-file", data);
  await child.locator("#restore-dialog").waitFor({ state: "visible" });
  assert(await child.locator("#parent-recovery-option").isHidden());
  await child.locator("#cancel-restore").click();
  assert.notEqual(
    (await snap(child)).meta.find((r) => r.key === "state").sharing.deviceId,
    source.deviceId,
  );
  check(
    "existing child does not receive parent-recovery option or change identity",
  );
  for (const width of [412, 320]) {
    await fresh.setViewportSize({ width, height: 915 });
    await upload(fresh, "#restore-file", data);
    await fresh.locator("#restore-dialog").waitFor({ state: "visible" });
    assert(
      await fresh.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await fresh.locator("#cancel-restore").click();
  }
  assert.deepEqual(errors, []);
  check("restore confirmation fits small screens with no browser exceptions");
  console.log("Parent recovery browser checks passed:", passed);
} finally {
  for (const ctx of extra) await ctx.close();
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
