/* Headless probe: verify PostHog analytics wiring in dblearn.
 * Runs against the real .env key but intercepts /tt event POSTs locally
 * (fulfilled with {"status":1}) so no user events reach PostHog. Only the
 * SDK transport plumbing (config.js/recorder/flags) passes through the
 * next.config /tt rewrite. Capture bodies are gzip-compressed batch POSTs —
 * decode via postDataBuffer + gunzipSync.
 * Asserts:
 *   - $pageview fires (with app:"dblearn") on landing and route changes
 *   - cta_clicked fires on the landing hero/module-card CTAs
 *   - lesson_started fires on opening a lesson
 *   - zero console errors
 */
import { chromium } from "playwright-core";
import { accessSync, constants } from "fs";
import { gunzipSync } from "zlib";

const BASE = "http://localhost:3000";

function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  try {
    accessSync(exe, constants.X_OK);
    return exe;
  } catch {}
  throw new Error("Chromium not found; set PLAYWRIGHT_CHROMIUM");
}

let failures = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`PASS ${msg}`);
  } else {
    failures++;
    console.log(`FAIL ${msg}`);
  }
}

const events = [];
const consoleErrors = [];

function pushEvent(item) {
  if (item && item.event) events.push({ event: item.event, properties: item.properties ?? {} });
}

function parseText(text) {
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed.batch ?? [];
    for (const item of list ?? []) pushEvent(item);
    return list.length > 0;
  } catch {
    return false;
  }
}

async function decodeBody(req) {
  const buf = req.postDataBuffer();
  if (buf && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      if (parseText(gunzipSync(buf).toString("utf8"))) return;
    } catch {}
  }
  const body = buf ? buf.toString("utf8") : (req.postData() ?? "");
  if (parseText(body)) return;
  const m = body.match(/^data=(.*)$/s);
  if (m) {
    let b64 = m[1];
    const hash = b64.indexOf("#", 1);
    if (b64.startsWith("#") && hash > 1) b64 = b64.slice(hash + 1);
    try {
      const bin = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      if (bin[0] === 0x1f && bin[1] === 0x8b) {
        if (parseText(gunzipSync(bin).toString("utf8"))) return;
      }
      if (parseText(bin.toString("utf8"))) return;
    } catch {}
  }
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage();

await page.route("**/tt/**", async (route) => {
  const req = route.request();
  const url = req.url();
  const method = req.method();
  const isCapture = method === "POST" && !url.includes("/flags/") && !url.includes("/decide/");
  if (!isCapture) return route.continue();
  await decodeBody(req);
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: 1 }),
  });
});
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const seen = (ev) => events.filter((e) => e.event === ev);

// Landing → hero CTA.
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("header nav a", { timeout: 15000 });
await page.waitForTimeout(1500);
const hero = page.locator('a[href="/learn"]').filter({ hasText: "Start lesson one" });
await hero.waitFor({ timeout: 15000 });
await hero.click();
await page.waitForURL("**/learn", { timeout: 15000 });
await page.waitForTimeout(1500);

// Learn home → first lesson.
await page.locator("ul li button").first().click();
await page.waitForFunction(
  () => /^\/learn\/[a-z0-9-]+$/.test(window.location.pathname),
  undefined,
  { timeout: 15000 },
);
await page.waitForTimeout(1500);

// Let the posthog batch flush (3s flush interval) deliver the pageview for
// the lesson and lesson_started before asserting.
await page.waitForTimeout(3500);

check(seen("$pageview").length >= 3, "$pageview fired on landing, /learn, and lesson open");
check(
  seen("$pageview").length > 0 && seen("$pageview").every((e) => e.properties.app === "dblearn"),
  "every $pageview carries app=dblearn",
);
check(
  (() => {
    const cs = seen("cta_clicked");
    return (
      cs.some((e) => e.properties.cta_label === "Start lesson one") ||
      cs.some((e) => e.properties.cta_location?.includes("module_card"))
    );
  })(),
  "cta_clicked fires on the landing hero/module-card CTAs",
);
check(seen("lesson_started").length > 0, "lesson_started fires on lesson open");
const ls = seen("lesson_started")[0]?.properties ?? {};
console.log(`  lesson_started ${ls.lesson_id} / unit=${ls.lesson_unit}`);
console.log(`  events observed: ${[...new Set(events.map((e) => e.event))].join(", ") || "(none)"}`);
check(consoleErrors.length === 0, `zero console errors (${consoleErrors.length})`);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 5));

await browser.close();
console.log(failures ? `\n${failures} FAILURES` : "\nAll analytics checks passed");
process.exit(failures ? 1 : 0);