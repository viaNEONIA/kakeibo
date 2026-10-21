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
page.on("dialog", (d) => d.accept());
async function showBudget(pg) {
  await pg.goto(base + "#budget");
  await pg.reload();
  await pg.waitForFunction(
    () => !document.getElementById("budget-show").disabled,
  );
  await pg.locator("#budget-date").fill("2026-11-25");
  await pg.locator("#budget-show").click();
  await pg.waitForFunction(
    () =>
      document.getElementById("budget-range").textContent ===
      "2026-11-25〜2026-12-24",
  );
}
try {
  await page.goto(base + "#settings");
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  const fixture = await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js"),
      { Ledger } = await import("./js/domain.js"),
      { BudgetLedger } = await import("./js/budget.js"),
      { Recurring } = await import("./js/recurring.js"),
      { stateOf } = await import("./js/schema.js");
    const d = await openDatabase();
    const rev = async () => stateOf(await d.snapshot()).datasetRevision;
    try {
      const l = new Ledger(d),
        b = new BudgetLedger(d),
        r = new Recurring(d),
        food = (
          await l.saveCategory(
            { type: "expense", name: "食費" },
            undefined,
            await rev(),
          )
        ).resultIds[0],
        income = (
          await l.saveCategory(
            { type: "income", name: "給与" },
            undefined,
            await rev(),
          )
        ).resultIds[0];
      const old = (await b.select("2026-10-20", await rev())).resultIds[0];
      await b.close(old, await rev());
      await b.changePeriodStart(old, 25, await rev());
      const p = (await b.select("2026-11-25", await rev())).resultIds[0];
      await b.save(p, 1000, [{ categoryId: food, amount: 1000 }], await rev());
      const ids = [];
      for (const [day, amount, type] of [
        [31, 300, "expense"],
        [15, 150, "expense"],
        [31, 500, "income"],
      ])
        ids.push(
          (
            await r.save(
              {
                name: "plan" + day,
                type,
                dayOfMonth: day,
                amount,
                categoryId: type === "expense" ? food : income,
                activeFrom: "2026-01",
                activeUntil: null,
                enabled: true,
              },
              undefined,
              await rev(),
            )
          ).resultIds[0],
        );
      return { food, ids };
    } finally {
      d.close();
    }
  });
  await showBudget(page);
  assert.equal(
    await page.locator("#budget-remaining").textContent(),
    "1,000円",
  );
  assert.equal(
    await page.locator("#budget-planned-expense").textContent(),
    "450円",
  );
  assert.equal(
    await page.locator("#budget-planned-remaining").textContent(),
    "550円",
  );
  assert.equal(
    await page.locator("#budget-planned-income").textContent(),
    "500円",
  );
  assert.match(
    await page.locator(`[data-category-plan="${fixture.food}"]`).textContent(),
    /未確定予定 450円.*予定反映後の残額 550円/,
  );
  assert.equal(await page.locator("#pool-balance").textContent(), "0円");
  check(
    "cross-month planned expense and separate income display without changing actual remainder or pool",
  );
  await page.goto(base + "#settings");
  await page.waitForFunction(() => !document.getElementById("save").disabled);
  await page.locator("#recurring-details").evaluate((e) => (e.open = true));
  await page.locator("#recurring-month").fill("2026-11");
  await page.locator(`[data-recurring-confirm="${fixture.ids[0]}"]`).click();
  await page.waitForFunction(
    (id) => !document.querySelector(`[data-recurring-confirm="${id}"]`),
    fixture.ids[0],
  );
  await showBudget(page);
  assert.equal(await page.locator("#budget-expense").textContent(), "300円");
  assert.equal(await page.locator("#budget-remaining").textContent(), "700円");
  assert.equal(
    await page.locator("#budget-planned-expense").textContent(),
    "150円",
  );
  assert.equal(
    await page.locator("#budget-planned-remaining").textContent(),
    "550円",
  );
  assert.equal(await page.locator("#pool-balance").textContent(), "0円");
  check(
    "manual confirmation moves plan to actual once and preserves reference remainder",
  );
  await page.locator("#budget-base").fill("900");
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("budget-show").disabled,
  );
  await page.locator("#budget-date").fill("2026-11-25");
  await page.locator("#budget-show").click();
  await page.waitForFunction(
    () =>
      document.getElementById("budget-planned-expense").textContent === "150円",
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("budget-show").disabled,
  );
  await page.locator("#budget-date").fill("2026-11-25");
  await page.locator("#budget-show").click();
  await page.waitForFunction(
    () =>
      document.getElementById("budget-planned-expense").textContent === "150円",
  );
  for (const width of [320, 412]) {
    await page.setViewportSize({ width, height: 820 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  check("offline restart and small screens retain planned values");
  await context.setOffline(false);
  await page.goto(base + "#settings");
  await page.waitForFunction(
    () => !document.getElementById("family-setup").disabled,
  );
  await page.locator("#family-parent-name").fill("preview parent");
  await page.locator("#family-setup").click();
  await page.waitForFunction(() =>
    document
      .getElementById("family-status")
      .textContent.includes("preview parent"),
  );
  await page.locator("#family-child-name").fill("preview child");
  const pending = page.waitForEvent("download");
  await page.locator("#family-register").click();
  const join = JSON.parse(await readFile(await (await pending).path(), "utf8"));
  const childContext = await browser.newContext({
      viewport: { width: 320, height: 820 },
    }),
    child = await childContext.newPage();
  try {
    child.on("pageerror", (e) => errors.push(e.message));
    await child.goto(base + "#settings");
    await child.waitForFunction(
      () => !document.getElementById("family-join-file").disabled,
    );
    await child
      .locator("#family-join-file")
      .setInputFiles({
        name: "join.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(join)),
      });
    await child.locator("#family-dialog").waitFor({ state: "visible" });
    await child.locator("#family-confirm").click();
    await child.locator("#family-dialog").waitFor({ state: "hidden" });
    await showBudget(child);
    assert.match(
      await child.locator("#budget-planned-source").textContent(),
      /親から受け取った/,
    );
    assert.equal(
      await child.locator("#budget-planned-expense").textContent(),
      "150円",
    );
    assert(await child.locator("#budget-base").evaluate((e) => e.readOnly));
  } finally {
    await childContext.close();
  }
  assert.deepEqual(errors, []);
  check("child labels parent-source plans while keeping budget read-only");
  console.log(`Recurring preview browser checks passed: ${passed}`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
