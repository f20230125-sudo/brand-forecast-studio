import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const violations = async (page: import("@playwright/test").Page) =>
  (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);

test("loads with one h1, six sections and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page).toHaveTitle(/Brand Forecast Studio/);
  await expect(page.locator("h1")).toHaveCount(1);
  for (const id of ["forecast", "units", "ask", "accuracy", "health", "method"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a scenario moves the total, and reset brings the forecast back", async ({ page }) => {
  await page.goto("/");
  const line = page.locator("#forecast .scenario");
  await expect(line).toContainText("This is the model");
  await page.getByLabel("Price change, percent").fill("-5");
  await page.getByLabel("First generic launches in").selectOption("2026Q3");
  await expect(line).toContainText("Your scenario");
  await expect(line).toContainText("−");
  await page.getByRole("button", { name: "Reset to the forecast" }).click();
  await expect(line).toContainText("This is the model");
});

test("switching business unit changes the brand list and the chart", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("group", { name: "Business unit" }).getByRole("button", { name: "Oncology" }).click();
  await expect(page.getByLabel("Brand", { exact: true })).toHaveValue("KEYTRUDA");
  await expect(page.locator("#forecast h3").first()).toContainText("KEYTRUDA");
  await page.locator("#forecast").getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator("#forecast table.tbl tbody tr")).toHaveCount(4);
});

test("the accuracy and health sections show every brand and check", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#accuracy table").nth(1).locator("tbody tr")).toHaveCount(19);
  await expect(page.locator("#health .qrow")).toHaveCount(14);
});

test("the assistant answers with a tool call and opens a scenario in the what-if", async ({ page }) => {
  await page.goto("/");
  const box = page.getByLabel("Ask about the forecast");
  await box.fill("Keytruda price up 3% and volume up 8% from 2026Q2");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator("#ask .ask-trace code")).toHaveText('scenario(brand="KEYTRUDA", price_change_pct=3, volume_change_pct=8, start_quarter="2026Q2")');
  await page.getByRole("button", { name: "Open this in the what-if" }).click();
  await expect(page.getByLabel("Brand", { exact: true })).toHaveValue("KEYTRUDA");
  await expect(page.getByLabel("Price change, percent")).toHaveValue("3");
  await expect(page.locator("#forecast .scenario")).toContainText("Your scenario");
  await expect(page.locator("#units .legend")).toContainText("your scenario");
});

test("the assistant declines what it has no data for", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Ask about the forecast").fill("What is MSD's revenue in Saudi Arabia?");
  await page.getByLabel("Ask about the forecast").press("Enter");
  await expect(page.locator("#ask .ask-trace code")).toHaveText("none: declined");
});

test("business units: a chart, and a table with a total", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#units svg[role=img]")).toHaveCount(1);
  await page.locator("#units").getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator("#units table tbody tr")).toHaveCount(7);
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds no violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });

    if (scheme === "dark") await page.addInitScript(() => localStorage.setItem("bf-theme", "dark"));
    await page.goto("/");
    expect(await violations(page)).toEqual([]);
  });
}

for (const width of [390, 320]) {
  test(`no sideways scroll at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  });
}

test("opens in light mode even when the system prefers dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
