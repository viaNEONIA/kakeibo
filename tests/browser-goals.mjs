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
async function saveGoal(amount) {
  await page.locator("#goal-amount").fill(String(amount));
  await page.locator("#goal-save").click();
  await page.waitForFunction(
    () => !document.getElementById("goal-save").disabled,
  );
}
try {
  await page.goto(base + "#budget");
  await page.waitForFunction(
    () => !document.getElementById("goal-save").disabled,
  );
  assert.match(await page.locator("#goal-status").textContent(), /未設定/);
  await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const { BudgetLedger } = await import("./js/budget.js");
    const { stateOf } = await import("./js/schema.js");
    const d = await openDatabase();
    try {
      await new BudgetLedger(d).setOpening(
        1000,
        stateOf(await d.snapshot()).datasetRevision,
      );
    } finally {
      d.close();
    }
  });
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("goal-save").disabled,
  );
  await saveGoal(2000);
  assert.match(
    await page.locator("#goal-status").textContent(),
    /50%.*1,000円/,
  );
  const count = (await snap()).goalHistory.length;
  await saveGoal(0);
  assert.equal((await snap()).goalHistory.length, count);
  check("goal setting, exact shortage and zero rejected without saving");
  await saveGoal(500);
  assert.match(await page.locator("#goal-status").textContent(), /200%.*0円/);
  assert.match(
    await page.locator("#goal-achievement").textContent(),
    /初回達成済み/,
  );
  assert.equal((await snap()).goalNotifications.length, 1);
  const period = await page.locator("#goal-period").inputValue();
  for (const delta of [-700, 700]) {
    await page.evaluate(
      async ({ period, delta }) => {
        const { openDatabase } = await import("./js/db.js");
        const { BudgetLedger } = await import("./js/budget.js");
        const { stateOf } = await import("./js/schema.js");
        const d = await openDatabase();
        try {
          await new BudgetLedger(d).adjust(
            period,
            delta,
            "fixture",
            stateOf(await d.snapshot()).datasetRevision,
          );
        } finally {
          d.close();
        }
      },
      { period, delta },
    );
    await page.reload();
    await page.waitForFunction(
      () => !document.getElementById("goal-save").disabled,
    );
  }
  assert.equal((await snap()).goalNotifications.length, 1);
  await saveGoal(500);
  assert.equal((await snap()).goalNotifications.length, 2);
  check(
    "above 100 percent shown; regain does not duplicate, changed goal has fresh achievement",
  );
  await page.locator("#goal-clear").click();
  await page.waitForFunction(() =>
    document.getElementById("goal-status").textContent.includes("未設定"),
  );
  assert.equal((await snap()).goalHistory.length, 4);
  await page.locator("#history-details").evaluate((e) => (e.open = true));
  assert.match(await page.locator("#pool-history").textContent(), /未設定/);
  assert.match(
    await page.locator("#goal-history").textContent(),
    /2,000円.*|500円/,
  );
  check("explicit release retains setting and achievement history");
  const future = await page.evaluate(async () => {
    const { openDatabase } = await import("./js/db.js");
    const { BudgetLedger } = await import("./js/budget.js");
    const { stateOf } = await import("./js/schema.js");
    const { today, plusDays } = await import("./js/domain.js");
    const d = await openDatabase();
    try {
      const s = await d.snapshot(),
        p = s.periods.find(
          (p) => p.startDate <= today() && today() <= p.endDate,
        );
      return (
        await new BudgetLedger(d).select(
          plusDays(p.endDate, 1),
          stateOf(s).datasetRevision,
        )
      ).resultIds[0];
    } finally {
      d.close();
    }
  });
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("goal-save").disabled,
  );
  await page.locator("#goal-period").selectOption(future);
  await saveGoal(3000);
  assert.match(await page.locator("#goal-status").textContent(), /未設定/);
  await page.locator("#history-details").evaluate((e) => (e.open = true));
  assert.match(await page.locator("#pool-history").textContent(), /3,000円/);
  check(
    "future goal uses concrete period and appears in historical period table without early activation",
  );
  const before = await snap();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("goal-save").disabled,
  );
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () => !document.getElementById("goal-save").disabled,
  );
  const after = await snap();
  assert.deepEqual(after.goalHistory, before.goalHistory);
  assert.deepEqual(after.goalNotifications, before.goalNotifications);
  for (const width of [320, 412]) {
    await page.setViewportSize({ width, height: 820 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await context.setOffline(false);
  await page.locator("#goal-period").selectOption(period);
  await saveGoal(500);
  await page.goto(base + "#settings");
  await page.locator("#family-parent-name").fill("goal parent");
  await page.locator("#family-setup").click();
  await page.waitForFunction(() =>
    document
      .getElementById("family-status")
      .textContent.includes("goal parent"),
  );
  await page.locator("#family-child-name").fill("goal child");
  const downloaded = page.waitForEvent("download");
  await page.locator("#family-register").click();
  const invitation = JSON.parse(
    await readFile(await (await downloaded).path(), "utf8"),
  );
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
        buffer: Buffer.from(JSON.stringify(invitation)),
      });
    await child.locator("#family-dialog").waitFor({ state: "visible" });
    await child.locator("#family-confirm").click();
    await child.locator("#family-dialog").waitFor({ state: "hidden" });
    await child.goto(base + "#budget");
    await child.locator("#goal-status").waitFor({ state: "visible" });
    assert.match(await child.locator("#goal-status").textContent(), /200%/);
    for (const id of ["goal-period", "goal-amount", "goal-save", "goal-clear"])
      assert(await child.locator("#" + id).isDisabled());
    assert.match(
      await child.locator("#goal-permission").textContent(),
      /親端末/,
    );
  } finally {
    await childContext.close();
  }
  check(
    "shared child sees confirmed parent goal and all goal management controls are disabled",
  );
  assert.deepEqual(errors, []);
  check(
    "goals survive offline restart and fit 320px and 412px without browser errors",
  );
  console.log(`Goal browser checks passed: ${passed}`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
