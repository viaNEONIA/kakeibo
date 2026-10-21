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
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute("download")) return;
    return click.call(this);
  };
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: () => true,
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async ({ files }) => {
      window.shared = {
        active: navigator.userActivation.isActive,
        body: await files[0].text(),
      };
      if (window.shareMode) throw new DOMException("fixture", window.shareMode);
    },
  });
});
async function manualDownload() {
  const pending = page.waitForEvent("download");
  await page.locator("#file-save-link").click();
  return JSON.parse(await readFile(await (await pending).path(), "utf8"));
}
try {
  await page.goto(base + "#settings");
  await page.waitForFunction(() => !document.getElementById("backup").disabled);
  await page.locator("#backup").click();
  await page.locator("#file-save-link").waitFor({ state: "visible" });
  await page.waitForTimeout(1500);
  const backup = await manualDownload();
  assert.equal(backup.format, "kakeibo-pwa");
  assert.match(await page.locator("#last-backup").textContent(), /未確認/);
  check(
    "blocked automatic download retains usable manual backup link beyond one second",
  );
  await page.locator("#file-save-share").click();
  await page.waitForFunction(() => window.shared);
  assert.equal(await page.evaluate(() => window.shared.active), true);
  assert.deepEqual(
    JSON.parse(await page.evaluate(() => window.shared.body)),
    backup,
  );
  check("prepared File reaches share API within direct user gesture");
  for (const mode of [
    "AbortError",
    "NotAllowedError",
    "TypeError",
    "InvalidStateError",
    "DataError",
  ]) {
    await page.evaluate((m) => (window.shareMode = m), mode);
    await page.locator("#file-save-share").click();
    await page.waitForFunction(
      () => !document.getElementById("file-save-share").disabled,
    );
    const status = await page.locator("#file-save-status").textContent();
    assert.match(
      status,
      mode === "AbortError" ? /キャンセル/ : new RegExp(mode),
    );
    assert(await page.locator("#file-share-help").isVisible());
    assert.deepEqual(await manualDownload(), backup);
  }
  check(
    "share cancellation and classified failures preserve manual download and external sharing guidance",
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => false,
    }),
  );
  await page.locator("#backup").click();
  await page.locator("#file-save-link").waitFor({ state: "visible" });
  assert(await page.locator("#file-save-share").isHidden());
  assert.match(
    await page.locator("#file-share-support").textContent(),
    /利用できません/,
  );
  assert(await page.locator("#file-share-help").isVisible());
  assert.equal((await manualDownload()).format, "kakeibo-pwa");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => {
        throw new Error("unsupported fixture");
      },
    }),
  );
  await page.locator("#backup").click();
  await page.locator("#file-save-link").waitFor({ state: "visible" });
  assert(await page.locator("#file-save-share").isHidden());
  assert.equal((await manualDownload()).format, "kakeibo-pwa");
  check(
    "unsupported or throwing capability check leaves JSON save and external sharing instructions usable",
  );
  page.on("dialog", (d) => d.accept());
  await page.locator("#family-parent-name").fill("fixture parent");
  await page.locator("#family-setup").click();
  await page.waitForFunction(() =>
    document
      .getElementById("family-status")
      .textContent.includes("fixture parent"),
  );
  await page.locator("#family-export").click();
  await page.waitForFunction(() =>
    document
      .getElementById("file-save-link")
      .download.startsWith("kakeibo-家族統合用-"),
  );
  assert.equal((await manualDownload()).format, "kakeibo-family");
  await page.locator("#family-child-name").fill("fixture child");
  await page.locator("#family-register").click();
  await page.waitForFunction(() =>
    document
      .getElementById("file-save-link")
      .download.startsWith("kakeibo-子参加用-"),
  );
  assert.equal((await manualDownload()).members.length, 2);
  check("family exchange and child invitation use same manual save fallback");
  await page.evaluate(async () => {
    const { Database } = await import("./js/db.js");
    window.originalBackup = Database.prototype.backup;
    Database.prototype.backup = async () => {
      throw new Error("fixture failure");
    };
  });
  await page.locator("#backup").click();
  await page.waitForFunction(() =>
    document
      .getElementById("file-save-status")
      .textContent.includes("fixture failure"),
  );
  assert(await page.locator("#file-save-link").isHidden());
  await page.evaluate(async () => {
    const { Database } = await import("./js/db.js");
    Database.prototype.backup = window.originalBackup;
  });
  await page.locator("#backup").click();
  await page.locator("#file-save-link").waitFor({ state: "visible" });
  assert.equal((await manualDownload()).format, "kakeibo-pwa");
  check("preparation error is visible and retry succeeds");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("backup").disabled);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById("backup").disabled);
  await page.locator("#backup").click();
  await page.locator("#file-save-link").waitFor({ state: "visible" });
  assert.equal((await manualDownload()).format, "kakeibo-pwa");
  await page.setViewportSize({ width: 320, height: 800 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  check("offline restart supports backup export and narrow viewport");
  assert.deepEqual(errors, []);
  console.log(`File save checks passed: ${passed}`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((r) => server.close(r));
}
