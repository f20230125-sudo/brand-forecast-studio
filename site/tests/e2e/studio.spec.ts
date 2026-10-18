import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const violations = async (page: import("@playwright/test").Page) =>
  (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);

test("loads with one h1, four sections and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page).toHaveTitle(/Brand Forecast Studio/);
  await expect(page.locator("h1")).toHaveCount(1);
  for (const id of ["forecast", "accuracy", "health", "method"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
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
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator("#forecast table.tbl tbody tr")).toHaveCount(4);
});

test("the accuracy and health sections show every brand and check", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#accuracy table").nth(1).locator("tbody tr")).toHaveCount(19);
  await expect(page.locator("#health .qrow")).toHaveCount(14);
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds no violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
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
