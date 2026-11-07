// The widget end to end: open it, choose a part, comment, send with the capture, see the pin, open the
// thread, reply. Runs at 390×844 and 1280×800 (playwright.config.ts).
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:4311";

// The widget's shadow root is closed; Playwright can only see into open ones. For the tests only, the
// page's attachShadow is told to make it open. The product code is unchanged.
test.beforeEach(async ({ page, request }) => {
  await request.post(`${API}/__test/reset`);
  await page.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return orig.call(this, { ...init, mode: "open" });
    };
  });
});

async function openWidget(page: Page) {
  await page.goto("/");
  const report = page.getByRole("button", { name: /^Report, / });
  await expect(report).toBeVisible();
  return report;
}

async function state(request: import("@playwright/test").APIRequestContext) {
  return (await request.get(`${API}/__test/state`)).json() as Promise<{ items: Array<{ id: string; number: number; status: string; capture: { confirmed: boolean; files: Record<string, { size: number }>; context: { method: string; masked?: { fields: number; elements: number } }; part?: { selector: string; label: string; outerHTML?: string } } }>; objects: string[] }>;
}

test("report a part with its capture, see the pin, open the thread and reply", async ({ page, request }) => {
  const report = await openWidget(page);
  await expect(report).toHaveAttribute("aria-label", "Report, no reports on this page");

  // Report mode on.
  await report.click();
  await expect(report).toHaveAttribute("aria-pressed", "true");
  const modeBar = page.getByRole("region", { name: "Report mode" });
  await expect(modeBar).toBeVisible();

  // The capture layer: pressing a page control chooses it and does not run the page's own handler.
  const clicksBefore = await page.evaluate(() => (window as unknown as { fixtureClicks: number }).fixtureClicks);
  await page.locator("#export").click();
  expect(await page.evaluate(() => (window as unknown as { fixtureClicks: number }).fixtureClicks)).toBe(clicksBefore);

  const panel = page.getByRole("dialog", { name: "New report" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("About: button “Export this list”")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Sent with your report" })).toBeVisible();
  await expect(panel.getByText(/^A screenshot and a copy of this page, [\d.]+ (KB|MB)$/)).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/Password fields and the fields this site marks as private are left blank\./)).toBeVisible();

  // "See what will be sent": the screenshot, then the sandboxed page copy.
  await panel.getByRole("button", { name: "See what will be sent" }).click();
  const viewer = page.getByRole("dialog", { name: "What will be sent" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("img", { name: /^Screenshot of Officials register/ })).toBeVisible();
  await viewer.getByRole("tab", { name: "Page copy" }).click();
  const frame = viewer.locator("iframe.copyframe");
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(viewer.getByText(/Copy of the page’s HTML/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(panel).toBeVisible();

  // Send with an empty comment: the error summary.
  await panel.getByRole("button", { name: "Send report" }).click();
  await expect(panel.getByRole("group", { name: "There is a problem" })).toBeVisible();
  await expect(page).toHaveTitle(/^Error: /);

  await panel.getByLabel("Comment").fill("Export this list opened nothing the first time I pressed it.");
  await panel.getByRole("radio", { name: "Question" }).check();
  await panel.getByRole("button", { name: "Send report" }).click();
  const sent = panel.getByText(/^Report \d+ sent$/);
  await expect(sent).toBeVisible();
  await expect(page).not.toHaveTitle(/^Error: /);
  const number = Number((await sent.textContent())!.match(/\d+/)![0]);

  // The files reached the fake S3 and were confirmed with their sizes and hashes.
  await expect.poll(async () => (await state(request)).items[0]?.capture.confirmed, { timeout: 15_000 }).toBe(true);
  const s = await state(request);
  const item = s.items[0]!;
  expect(Object.keys(item.capture.files).sort()).toEqual(["closeup", "html", "page", "pageMarked"]);
  expect(item.capture.context.method).toBe("dom");
  expect(item.capture.context.masked).toEqual({ fields: 1, elements: 1 });
  expect(item.capture.part?.label).toBe("button “Export this list”");
  expect(item.capture.part?.selector).toBe("#export");

  // Nothing masked is in the page copy; the part is marked; no script survives.
  const html = await (await request.get(`${API}/__test/html/${item.id}`)).text();
  expect(html).not.toContain("hunter2-fixture");
  expect(html).not.toContain("GB00 FIXT 1234 5678");
  expect(html).toContain("ellis@example.test");
  expect(html).toMatch(/<button[^>]*id="export"[^>]*data-annotatie-target|data-annotatie-target[^>]*id="export"/);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/onsubmit=/i);
  expect(html).not.toContain('data-rw="annotatie"');

  // Primary buttons keep their own colours whatever the host page sets (the element reset never wins).
  const close = panel.getByRole("button", { name: "Close" }).last();
  await expect(close).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(close).toHaveCSS("font-weight", "500");
  // Close: report mode stays on, the new pin is on the page.
  await close.click();
  await expect(panel).toBeHidden();
  await expect(modeBar).toBeVisible();
  const pin = page.getByRole("button", { name: `Report ${number}, Open, Question, about button “Export this list”` });
  await expect(pin).toBeVisible();

  // Leave report mode; the page works again.
  await modeBar.getByRole("button", { name: "Done" }).click();
  await expect(modeBar).toBeHidden();
  await expect(report).toHaveAttribute("aria-label", "Report, 1 report on this page not yet resolved");

  // A reply from the team arrives; the thread shows it as Answered.
  await request.post(`${API}/__test/team-reply`, { data: { itemId: item.id, body: "Thank you. The first press was lost while the list loaded; fixed now." } });
  await pin.click();
  const thread = page.getByRole("dialog", { name: `Report ${number}` });
  await expect(thread).toBeVisible();
  await expect(thread.getByText("Answered: a reply is waiting for you.")).toBeVisible();
  await expect(thread.getByText("Export this list opened nothing the first time I pressed it.")).toBeVisible();
  await expect(thread.getByText(/The first press was lost/)).toBeVisible();
  await expect(thread.getByRole("heading", { name: "Sent with this report" })).toBeVisible();
  await expect(thread.getByText("Question · Officials register – Fixture · sent by Ellis Varnholt")).toBeVisible();

  // The thread's viewer loads the stored capture.
  await thread.getByRole("button", { name: "View", exact: true }).click();
  const stored = page.getByRole("dialog", { name: `Sent with Report ${number}` });
  await expect(stored.getByRole("img", { name: /^Screenshot of/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(stored).toBeHidden();

  // Reply: empty first, then for real; the reporter's reply opens the report again.
  await thread.getByRole("button", { name: "Send reply" }).click();
  await expect(thread.getByRole("group", { name: "There is a problem" })).toBeVisible();
  await thread.getByLabel("Your reply").fill("It works now, thank you.");
  await thread.getByRole("button", { name: "Send reply" }).click();
  await expect(thread.getByText("Reply sent")).toBeVisible();
  await expect(thread.getByText(`Report ${number} is open again until it is answered.`)).toBeVisible();
  await expect(thread.locator(".msg .body").last()).toHaveText("It works now, thank you.");
  await page.keyboard.press("Escape");
  await expect(thread).toBeHidden();
});

test("the Reports panel, a whole-page report, failures kept, and pins across single-page navigation", async ({ page, request }) => {
  const report = await openWidget(page);
  await report.click();
  const modeBar = page.getByRole("region", { name: "Report mode" });

  // Empty list first.
  await modeBar.getByRole("button", { name: /^Reports/ }).click();
  const list = page.getByRole("dialog", { name: "Reports" });
  await expect(list.getByText("No reports on this page yet")).toBeVisible();
  await list.getByRole("button", { name: "Comment on the whole page" }).click();

  const panel = page.getByRole("dialog", { name: "New report" });
  await expect(panel.getByText("About: the whole page")).toBeVisible();
  await panel.getByLabel("Comment").fill("The page title runs under the menu at this width.");

  // The server fails once: the comment is kept, with the failure in words.
  await request.post(`${API}/__test/fail`, { data: { route: "POST items", status: 500 } });
  await panel.getByRole("button", { name: "Send report" }).click();
  await expect(panel.getByRole("alert")).toContainText("Your report was not sent");
  await expect(panel.getByRole("alert")).toContainText(/send reference RPT-[A-Z0-9]{4} to the system team/);
  await expect(panel.getByLabel("Comment")).toHaveValue("The page title runs under the menu at this width.");
  await panel.getByRole("button", { name: "Send report" }).click();
  await expect(panel.getByText(/^Report \d+ sent$/)).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).last().click();

  // The list now has it, as a report on the whole page, and My reports counts it.
  await modeBar.getByRole("button", { name: /^Reports/ }).click();
  await expect(list.getByText(/^1 report on Officials register – Fixture: 1 not yet resolved, 0 resolved\. As at /)).toBeVisible();
  await expect(list.getByRole("button", { name: /Report 1/ })).toContainText("Bug · on the whole page · Ellis Varnholt");
  await list.getByRole("tab", { name: /My reports/ }).click();
  await expect(list.getByText(/^1 report you sent, on 1 page\./)).toBeVisible();
  await list.getByRole("button", { name: "Close" }).click();

  // A part report on the register, then a single-page navigation away and back.
  await page.locator("#views").click();
  await panel.getByLabel("Comment").fill("Saved views opened an empty menu.");
  await panel.getByRole("button", { name: "Send report" }).click();
  await expect(panel.getByText(/^Report \d+ sent$/)).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).last().click();
  await modeBar.getByRole("button", { name: "Done" }).click();
  const pin = page.getByRole("button", { name: /about button “Saved views”/ });
  await expect(pin).toBeVisible();

  await page.getByRole("link", { name: "Settings (single-page link)" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(pin).toHaveCount(0);
  await expect(report).toHaveAttribute("aria-label", "Report, no reports on this page");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Officials register" })).toBeVisible();
  // The browser restores the scroll position (the link was low on the page): the pin follows its part,
  // hidden while the part is scrolled away, shown again once it is back in view.
  await page.locator("#views").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: /about button “Saved views”/ })).toBeVisible();
  await expect(report).toHaveAttribute("aria-label", "Report, 2 reports on this page not yet resolved");
});

test("without a token from the host, nothing is drawn", async ({ page, context }) => {
  await context.route("**/annotatie/token", (route) => route.fulfill({ status: 403, body: '{"error":"forbidden"}' }));
  await page.goto("/");
  await page.waitForTimeout(1000);
  await expect(page.locator('[data-rw="annotatie"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Report/ })).toHaveCount(0);
});
