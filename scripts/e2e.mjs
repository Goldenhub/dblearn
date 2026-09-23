/**
 * End-to-end smoke check for the Phase 1 pipeline.
 *
 * Requires a running server on :3000 (`npm run start` or `npm run dev`) and
 * playwright-core's chromium (download via `npx playwright-core install
 * chromium`, or point PLAYWRIGHT_CHROMIUM at any local Chrome binary).
 *
 * Verifies: page loads, DuckDB engine reaches ready, the sample query auto-runs,
 * and a real plan graph renders with operator nodes.
 */
import { chromium } from "playwright-core";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const execPath =
  process.env.PLAYWRIGHT_CHROMIUM ||
  process.env.HOME +
    "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const exit = (code) => {
  process.exit(code);
};

let browser;
try {
  browser = await chromium.launch({ executablePath: execPath, headless: true });
} catch (error) {
  console.error(
    "Could not launch Chromium for E2E. Install it with `npx playwright-core install chromium` " +
      "or set PLAYWRIGHT_CHROMIUM to a Chrome binary.",
  );
  console.error(String(error.message).slice(0, 300));
  exit(1);
}

const page = await browser.newPage();
const issues = [];
page.on("console", (m) => {
  if (m.type() === "error") issues.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => issues.push(String(e).slice(0, 300)));

await page.goto(`${baseUrl}/plan`, { waitUntil: "domcontentloaded", timeout: 60000 });

// The Query Plan lab boots the DuckDB engine and auto-runs the sample query.
await page.waitForFunction(
  () => document.querySelectorAll(".react-flow__node").length > 0,
  null,
  { timeout: 90000 },
);

const summary = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".react-flow__node")].map((el) =>
    (el.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
  const status = [...document.querySelectorAll("span")]
    .map((s) => s.textContent)
    .filter(Boolean)
    .find((t) => t.includes("DuckDB"));
  return { nodes, status: status ?? null };
});

const planBuilt = await page.evaluate(() =>
  [...document.querySelectorAll("section span")]
    .map((s) => s.textContent)
    .filter(Boolean)
    .some((t) => t.includes("plan built in")),
);

if (!summary.status) console.error("FAIL: engine never reached ready");
if (!planBuilt) console.error("FAIL: sample query did not run on load");
if (summary.nodes.length < 2) console.error(`FAIL: expected >1 plan node, got ${summary.nodes.length}`);
if (issues.length) console.error("FAIL: console issues:", issues.join(" | "));

console.log(`engine: ${summary.status ?? "not-ready"}`);
console.log(`auto-ran sample: ${planBuilt ? "yes" : "no"}`);
console.log(`nodes: ${summary.nodes.length}`);
if (process.env.VERBOSE) for (const n of summary.nodes) console.log("  -", n);
console.log(`console errors: ${issues.length ? issues.join(" | ") : "none"}`);

await browser.close();
exit(summary.status && planBuilt && summary.nodes.length >= 2 && issues.length === 0 ? 0 : 1);