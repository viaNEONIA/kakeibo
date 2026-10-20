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
const children = [];
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
  await pg.locator(id).setInputFiles({
    name: "family.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await pg.locator("#family-dialog").waitFor({ state: "visible" });
  await pg.locator("#family-confirm").click();
  await pg.locator("#family-dialog").waitFor({ state: "hidden" });
}
async function add(pg, n) {
  await nav(pg, "input");
  await pg.locator("#clear-amount").click();
  for (const k of String(n)) await pg.locator(`[data-key="${k}"]`).click();
  await pg.locator("#transaction-name").fill("家族入力");
  await pg.locator("#transaction-date").fill("2026-10-20");
  await pg.locator("#register").click();
  await pg.waitForFunction(
    () => document.getElementById("amount").value === "",
  );
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
  await page.goto(base);
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await nav(page, "settings");
  await category("食費");
  await add(page, 100);
  await nav(page, "settings");
  await page.locator("#family-parent-name").fill("親のスマホ");
  await page.locator("#family-setup").click();
  await page.waitForFunction(() =>
    document.getElementById("family-status").textContent.includes("親のスマホ"),
  );
  const invites = [];
  for (const name of ["子1", "子2"]) {
    await page.locator("#family-child-name").fill(name);
    invites.push(
      await fileDownload(page, () => page.locator("#family-register").click()),
    );
  }
  assert.equal(invites[0].members[1].order, 1);
  assert.equal(invites[1].members[2].order, 2);
  check("parent setup and ordered child invitation downloads");
  for (const invite of invites) {
    const ctx = await browser.newContext({
        viewport: { width: 412, height: 915 },
        acceptDownloads: true,
      }),
      pg = await ctx.newPage();
    children.push({ ctx, pg });
    pg.on("pageerror", (e) => errors.push(e.message));
    await pg.clock.setFixedTime(new Date("2026-10-20T03:00:00Z"));
    await pg.goto(base + "#settings");
    await pg.waitForFunction(() => !document.getElementById("save").disabled);
    await upload(pg, "#family-join-file", invite);
    assert.match(await pg.locator("#family-status").textContent(), /子/);
    assert(await pg.locator("#add-category").isDisabled());
  }
  check(
    "two independent browser profiles join as distinct registered children",
  );
  const a = children[0].pg,
    b = children[1].pg;
  await add(a, 200);
  await nav(a, "budget");
  await a.reload();
  await a.locator("#child-budget-preview").waitFor({ state: "visible" });
  assert(await a.locator("#budget-base").evaluate((e) => e.readOnly));
  assert.equal(
    await a.locator("#child-preview-expense").textContent(),
    "300円",
  );
  assert.match(
    await a.locator("#child-preview-status").textContent(),
    /確認待ち 1件/,
  );
  assert.match(
    await a.locator("#child-preview-comparison").textContent(),
    /支出 100円/,
  );
  check(
    "child immediately displays provisional spending and confirmed parent comparison",
  );
  await nav(a, "settings");
  const data = await fileDownload(a, () => a.locator("#family-export").click());
  const ordinaryBackup = await fileDownload(a, () =>
    a.locator("#backup").click(),
  );
  await upload(page, "#family-import-file", ordinaryBackup);
  let s = await snap(page);
  assert.equal(s.transactions.length, 2);
  await upload(page, "#family-import-file", data);
  assert.equal((await snap(page)).transactions.length, 2);
  check("child input, parent preview and repeated import without duplicates");
  const parentFile = await fileDownload(page, () =>
    page.locator("#family-export").click(),
  );
  await upload(a, "#family-import-file", parentFile);
  await upload(b, "#family-import-file", parentFile);
  await nav(a, "budget");
  assert.match(
    await a.locator("#child-preview-status").textContent(),
    /確認待ちはありません/,
  );
  assert.match(
    await a.locator("#child-preview-title").textContent(),
    /反映済み/,
  );
  assert.equal(
    await a.locator("#child-preview-expense").textContent(),
    "300円",
  );
  await nav(a, "settings");
  check(
    "parent result refreshes provisional values and clears acknowledged changes",
  );
  const tx = (await snap(a)).transactions.find((t) => t.amount === 100);
  for (const [pg, amount] of [
    [a, 250],
    [b, 350],
  ]) {
    await pg.evaluate(
      async ({ id, amount }) => {
        const { openDatabase } = await import("./js/db.js"),
          { Ledger } = await import("./js/domain.js"),
          { stateOf } = await import("./js/schema.js");
        const d = await openDatabase();
        try {
          const s = await d.snapshot(),
            t = s.transactions.find((t) => t.id === id);
          await new Ledger(d).edit(
            id,
            { ...t, amount },
            t.revision,
            stateOf(s).datasetRevision,
          );
        } finally {
          d.close();
        }
      },
      { id: tx.id, amount },
    );
    await pg.reload();
    await pg.waitForFunction(
      () => !document.getElementById("family-export").disabled,
    );
  }
  const fb = await fileDownload(b, () => b.locator("#family-export").click()),
    fa = await fileDownload(a, () => a.locator("#family-export").click());
  await upload(page, "#family-import-file", fb);
  await upload(page, "#family-import-file", fa);
  assert.equal(
    (await snap(page)).transactions.find((t) => t.id === tx.id).amount,
    250,
  );
  assert.match(
    await page.locator("#family-result").textContent(),
    /子の登録順を優先/,
  );
  assert.match(
    await page.locator("#family-result").textContent(),
    /採用.*子1.*不採用.*子2/,
  );
  check(
    "child registration priority and visible adopted/rejected conflict details",
  );
  await nav(page, "budget");
  await page.locator("#budget-base").waitFor({ state: "visible" });
  await page.locator("#budget-base").fill("1000");
  await page.locator("#budget-save").click();
  await page.waitForFunction(() =>
    document.getElementById("budget-base-value").textContent.includes("1,000"),
  );
  await page.locator("#close-period").click();
  await page.waitForFunction(
    () => document.getElementById("budget-state").textContent === "締め済み",
  );
  await nav(page, "settings");
  const closed = await fileDownload(page, () =>
    page.locator("#family-export").click(),
  );
  await upload(a, "#family-import-file", closed);
  await nav(a, "budget");
  assert(await a.locator("#close-period").isDisabled());
  assert(await a.locator("#budget-save").isDisabled());
  await nav(a, "settings");
  check("parent closing propagates and child finance controls remain disabled");
  await add(a, 50);
  await nav(a, "budget");
  assert.equal(
    await a.locator("#child-preview-remaining").textContent(),
    "500円",
  );
  assert.equal(await a.locator("#pool-balance").textContent(), "550円");
  assert.match(
    await a.locator("#child-preview-status").textContent(),
    /確認待ち 1件/,
  );
  await nav(a, "settings");
  const late = await fileDownload(a, () => a.locator("#family-export").click());
  await upload(page, "#family-import-file", late);
  const latest = await fileDownload(page, () =>
    page.locator("#family-export").click(),
  );
  await upload(a, "#family-import-file", latest);
  await nav(a, "budget");
  assert.equal(await a.locator("#pool-balance").textContent(), "500円");
  assert.equal(
    await a.locator("#child-preview-remaining").textContent(),
    "500円",
  );
  assert.match(
    await a.locator("#child-preview-status").textContent(),
    /確認待ちはありません/,
  );
  for (const width of [412, 320]) {
    await a.setViewportSize({ width, height: 915 });
    assert(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await a.screenshot({
    path: "/tmp/kakeibo-child-budget-preview.png",
    fullPage: true,
  });
  await nav(a, "settings");
  check(
    "closed child budget is provisional without settlement until parent results arrive",
  );
  await a.evaluate(() => navigator.serviceWorker.ready);
  await a.waitForFunction(() => !!navigator.serviceWorker.controller);
  await children[0].ctx.setOffline(true);
  await a.reload();
  await a.waitForFunction(
    () => !document.getElementById("family-export").disabled,
  );
  const offline = await fileDownload(a, () =>
    a.locator("#family-export").click(),
  );
  assert.equal(offline.bookId, parentFile.bookId);
  check("offline restart retains child identity and can export sharing file");
  for (const pg of [page, a]) {
    await pg.setViewportSize({ width: 320, height: 915 });
    assert(
      await pg.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.screenshot({
    path: "/tmp/kakeibo-family-settings.png",
    fullPage: true,
  });
  check("family settings fit 320px and 412px");
  assert.deepEqual(errors, []);
  check("no browser JavaScript errors");
  console.log("Family browser checks passed:", passed);
} finally {
  for (const c of children) await c.ctx.close();
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
