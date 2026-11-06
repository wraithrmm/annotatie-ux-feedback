import { expect, test, type Page } from "@playwright/test";

// The approval gate in the portal, against the in-memory mock (?mock=1).
// Runs at 390 x 844 (project "phone") and 1280 x 800 (project "desktop").

type Msg = { id: string; itemId: string; body: string; state: string; rejectedReason?: string; autoApproved?: boolean };
type MockWin = {
  __mock: {
    offline: boolean;
    state(): { messages: Msg[]; sites: Array<{ id: string; autoApprove: boolean }> };
    agentReply(itemId: string, body: string): Msg;
  };
};

const msg = async (page: Page, itemId: string, pred: (m: Msg) => boolean) => {
  const all = await page.evaluate(() => (window as unknown as MockWin).__mock.state().messages);
  return all.filter((m) => m.itemId === itemId).find(pred);
};
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

async function openQueue(page: Page) {
  await page.goto("/board/?mock=1#/attention");
  await expect(page.getByTestId("draft-card").first()).toBeVisible();
}
const card41 = (page: Page) => page.getByTestId("draft-card").filter({ hasText: "Report 41" });

test("nothing scrolls sideways at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const h of ["#/attention", "#/sites/s_acme/items/i41", "#/reports", "#/decisions", "#/more", "#/sites/s_acme/settings", "#/agents"]) {
    await page.goto(`/board/?mock=1${h}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, h).toBeLessThanOrEqual(0);
  }
});

test("approve sends after the 10-second undo window", async ({ page }) => {
  test.setTimeout(45_000);
  await openQueue(page);
  await card41(page).getByRole("button", { name: "Approve and send" }).click();
  const undo = page.getByTestId("undo").filter({ hasText: "Sent to Ada Example" });
  await expect(undo).toBeVisible();
  expect((await msg(page, "i41", (m) => m.body.startsWith("Thanks, Ada")))?.state).toBe("published");
  await expect(page.getByTestId("toast")).toHaveText("Sent to Ada Example", { timeout: 14_000 });
  await expect(undo).toHaveCount(0);
  await expect(card41(page)).toHaveCount(0);
});

test("undo within the window turns the reply back into a draft", async ({ page }) => {
  await openQueue(page);
  await card41(page).getByRole("button", { name: "Approve and send" }).click();
  await page.getByTestId("undo").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("toast")).toHaveText("Not sent. The draft is back.");
  await expect(card41(page)).toBeVisible();
  expect((await msg(page, "i41", (m) => m.body.startsWith("Thanks, Ada")))?.state).toBe("draft");
});

test("edit opens the editor sheet and sends the edited text", async ({ page }) => {
  await openQueue(page);
  await card41(page).getByRole("button", { name: "Edit" }).click();
  const sheet = page.getByTestId("edit-sheet");
  await expect(sheet.getByRole("heading", { name: "Edit the reply" })).toBeVisible();
  await expect(sheet.getByText("Ada Example: When I type the code")).toBeVisible();
  const ta = sheet.getByLabel("Your reply, sent as Riley Chen");
  await ta.fill("Thanks, Ada. Fixed on staging: lower case works now.");
  // The sheet's action stays on screen while typing.
  await expect(sheet.getByRole("button", { name: "Approve and send" })).toBeInViewport();
  await sheet.getByRole("button", { name: "Approve and send" }).click();
  await expect(page.getByTestId("undo")).toBeVisible();
  expect((await msg(page, "i41", (x) => x.body.startsWith("Thanks, Ada. Fixed")))?.state).toBe("published");
});

test("closing the editor with changes asks before discarding", async ({ page }) => {
  await openQueue(page);
  await card41(page).getByRole("button", { name: "Edit" }).click();
  const sheet = page.getByTestId("edit-sheet");
  await sheet.getByLabel("Your reply, sent as Riley Chen").fill("Half an edit");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Discard your edit?" })).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByTestId("toast")).toHaveText("Edit discarded. The draft is unchanged.");
  expect((await msg(page, "i41", (m) => m.state === "draft"))?.body).toMatch(/^Thanks, Ada/);
});

test("reject needs a reason and keeps the draft as a rejected note", async ({ page }) => {
  await openQueue(page);
  await card41(page).getByRole("button", { name: "Reject" }).click();
  const sheet = page.getByTestId("reject-sheet");
  await sheet.getByRole("button", { name: "Reject draft" }).click();
  await expect(sheet.getByText("Choose a reason or write a note")).toBeVisible();
  await sheet.getByText("Wrong tone").click();
  await sheet.getByLabel("Note for the agent").fill("Too casual");
  await sheet.getByRole("button", { name: "Reject draft" }).click();
  await expect(page.getByTestId("toast")).toHaveText("Draft rejected. The agent reads your reason.");
  await expect(card41(page)).toHaveCount(0);
  const m = await msg(page, "i41", (x) => x.body.startsWith("Thanks, Ada"));
  expect(m?.state).toBe("rejected");
  expect(m?.rejectedReason).toBe("Wrong tone: Too casual");
});

test("a failed approval keeps the reply and offers Try again", async ({ page }) => {
  await openQueue(page);
  await page.evaluate(() => ((window as unknown as MockWin).__mock.offline = true));
  await card41(page).getByRole("button", { name: "Approve and send" }).click();
  await expect(card41(page).getByText("Not sent: no connection.")).toBeVisible();
  await page.evaluate(() => ((window as unknown as MockWin).__mock.offline = false));
  await card41(page).getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("undo")).toBeVisible();
});

test("the report shows what the user saw before the messages, with a sticky action bar", async ({ page }) => {
  await page.goto("/board/?mock=1#/sites/s_acme/items/i41");
  await expect(page.getByRole("heading", { name: "Discount code is refused when typed in lower case" })).toBeVisible();
  if (isPhone(page)) {
    const cap = (await page.locator(".capcard").boundingBox())!;
    const first = (await page.locator("#msgs article").first().boundingBox())!;
    expect(cap.y).toBeLessThan(first.y);
  }
  const msgs = page.locator("#msgs");
  await expect(msgs.getByText("Draft · the user can't see it yet")).toBeVisible();
  await expect(msgs.getByText("Internal note")).toBeVisible();
  await expect(msgs.getByText("via Claude Code on WORKSTATION-7").first()).toBeVisible();
  const bar = page.getByTestId("actionbar");
  await expect(bar.getByRole("button", { name: "Approve and send" })).toBeInViewport();
  await bar.getByRole("button", { name: "Approve and send" }).click();
  await expect(bar.getByTestId("undo")).toBeVisible();
  await bar.getByRole("button", { name: "Undo" }).click();
  await expect(bar.getByRole("button", { name: "Approve and send" })).toBeVisible();
});

test("page copy renders only in a sandboxed frame with no scripts", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.goto("/board/?mock=1#/sites/s_acme/items/i41");
  if (isPhone(page)) await page.getByRole("button", { name: "Page copy" }).click();
  else await page.getByRole("tab", { name: "Page copy" }).click();
  const frame = page.locator("iframe[srcdoc]").last();
  await expect(frame).toHaveAttribute("sandbox", "");
  expect(await frame.getAttribute("srcdoc")).toMatch(/^<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
  await expect(page.frameLocator("iframe[srcdoc]").last().getByRole("heading", { name: "Your basket" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(dialogs).toEqual([]);
});

test("auto-approve: confirmation to turn on, banner on every screen, one click off", async ({ page }) => {
  await page.goto("/board/?mock=1#/sites/s_acme/settings");
  const sw = page.getByRole("switch", { name: "Auto-approve agent replies" });
  await sw.click();
  const sheet = page.getByTestId("auto-sheet");
  await expect(sheet.getByRole("heading", { name: "Turn on auto-approve for Acme Shop?" })).toBeVisible();
  await sheet.getByRole("button", { name: "Keep it off" }).click();
  await expect(sw).not.toBeChecked();
  const banner = page.getByTestId("autobar");
  await expect(banner).not.toBeVisible();

  await sw.click();
  await sheet.getByRole("button", { name: "Turn on auto-approve" }).click();
  await expect(sw).toBeChecked();
  await expect(banner).toContainText("Auto-approve is on for Acme Shop");

  // An agent reply now goes out at once, marked auto-approved.
  const auto = await page.evaluate(() => (window as unknown as MockWin).__mock.agentReply("i37", "We're looking into the map."));
  expect(auto.state).toBe("published");
  expect(auto.autoApproved).toBe(true);

  // The banner stays on other screens (hash navigation keeps the mock's state).
  await page.evaluate(() => (location.hash = "#/reports"));
  await expect(banner).toContainText("Auto-approve is on for Acme Shop");
  await banner.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByTestId("toast")).toHaveText("Auto-approve is off");
  await expect(banner).not.toBeVisible();
  const draft = await page.evaluate(() => (window as unknown as MockWin).__mock.agentReply("i37", "Second reply."));
  expect(draft.state).toBe("draft");
});

test("a question without options needs a written answer", async ({ page }) => {
  await page.goto("/board/?mock=1#/decisions");
  await page.getByTestId("decision-row").filter({ hasText: "Which test card" }).click();
  await expect(page.locator("#main").getByText("Blocking")).toBeVisible();
  await page.getByRole("button", { name: "Record answer" }).click();
  await expect(page.getByRole("alert")).toHaveText("Write an answer");
  await page.getByLabel("Your answer").fill("Use the provider's published test card.");
  await page.getByRole("button", { name: "Record answer" }).click();
  await expect(page.getByTestId("toast")).toHaveText("Answer recorded. The agent will see it.");
  await expect(page).toHaveURL(/#\/decisions$/);
});
