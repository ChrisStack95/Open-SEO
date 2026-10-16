import { expect, test, type Page } from "@playwright/test";

async function dismissProviderSetup(page: Page) {
  const setup = page.getByRole("dialog", { name: "One quick setup step" });
  await expect(setup).toBeVisible();
  await setup.getByRole("button", { name: "Dismiss", exact: true }).click();
}

async function openTrackedBacklinks(page: Page) {
  await page.goto("/");
  await page.waitForURL(/\/p\/([^/]+)\/?$/);
  const projectId = page.url().match(/\/p\/([^/]+)/)?.[1];
  if (!projectId) throw new Error(`Missing project in ${page.url()}`);
  await page.goto(`/p/${projectId}/backlinks?mode=tracked`);
  await dismissProviderSetup(page);
  await expect(
    page.getByRole("button", { name: "Add backlink", exact: true }),
  ).toBeVisible();
}

test("manually added backlinks persist, can be edited and paused, and can be deleted", async ({
  page,
}, testInfo) => {
  await openTrackedBacklinks(page);
  const sourceUrl = `https://publisher.example/manual-backlink-${Date.now()}`;
  const targetUrl = "https://destination.example/original";
  const updatedTargetUrl = "https://destination.example/updated";

  await page.getByRole("button", { name: "Add backlink", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add a backlink" });
  await editor.getByLabel("Source page URL").fill(sourceUrl);
  await editor.getByLabel("Target page URL").fill(targetUrl);
  await editor.getByLabel("Acquired date (optional)").fill("2026-10-01");
  await editor.getByLabel("Notes (optional)").fill("Editorial placement");
  await editor
    .getByRole("button", { name: "Add backlink", exact: true })
    .click();
  await expect(editor).toBeHidden();

  const row = page.getByRole("row").filter({ hasText: sourceUrl });
  await expect(row).toContainText("Unchecked");
  await expect(
    page.getByRole("button", { name: "Check all", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await dismissProviderSetup(page);
  await expect(row).toContainText(targetUrl);

  await row.getByRole("button", { name: "Edit backlink", exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit backlink" });
  await expect(editDialog.getByLabel("Acquired date (optional)")).toHaveValue(
    "2026-10-01",
  );
  await expect(editDialog.getByLabel("Notes (optional)")).toHaveValue(
    "Editorial placement",
  );
  await editDialog.getByLabel("Target page URL").fill(updatedTargetUrl);
  await editDialog.getByRole("button", { name: "Save backlink" }).click();
  await expect(editDialog).toBeHidden();
  await expect(row).toContainText(updatedTargetUrl);

  await row.getByRole("button", { name: "View history", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Backlink history" });
  await expect(history).toContainText("No checks yet.");
  await history.getByRole("button", { name: "Close", exact: true }).click();
  await expect(history).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("tracked-backlinks.png"),
    fullPage: true,
  });

  await row
    .getByRole("button", { name: "Pause automatic checks", exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: "Resume automatic checks", exact: true }),
  ).toBeVisible();
  await page.reload();
  await dismissProviderSetup(page);
  await expect(
    row.getByRole("button", { name: "Resume automatic checks", exact: true }),
  ).toBeVisible();

  await row
    .getByRole("button", { name: "Delete backlink", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Delete backlink?" })
    .getByRole("button", { name: "Delete backlink", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await dismissProviderSetup(page);
  await expect(row).toHaveCount(0);
});

test("local no-auth mode saves a zero check limit and requires verified pricing before scheduling", async ({
  page,
}) => {
  await openTrackedBacklinks(page);
  await page
    .getByRole("button", { name: "Automatic checks", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Automatic backlink checks",
  });
  await expect(
    settings.getByText(
      "An administrator needs to configure DataForSEO before checks can run.",
    ),
  ).toBeVisible();
  await settings.getByLabel("Monthly check limit").fill("0");
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings).toBeHidden();

  await page.reload();
  await dismissProviderSetup(page);
  await page
    .getByRole("button", { name: "Automatic checks", exact: true })
    .click();
  await expect(settings.getByLabel("Check frequency")).toContainText("Off");
  await expect(settings.getByLabel("Monthly check limit")).toHaveValue("0");
  await settings.getByLabel("Check frequency").click();
  await page.getByRole("option", { name: "Weekly", exact: true }).click();
  await expect(settings).toContainText(
    "Automatic checks cannot be enabled until pricing is available.",
  );
  await expect(
    settings.getByRole("button", { name: "Save settings" }),
  ).toBeDisabled();
  await settings.getByLabel("Check frequency").click();
  await page.getByRole("option", { name: "Daily", exact: true }).click();
  await expect(
    settings.getByRole("button", { name: "Save settings" }),
  ).toBeDisabled();
  await settings.getByLabel("Check frequency").click();
  await page
    .getByRole("option", { name: "Off — manual checks only", exact: true })
    .click();
  await expect(
    settings.getByRole("button", { name: "Save settings" }),
  ).toBeEnabled();
  await settings.getByRole("button", { name: "Save settings" }).click();
  await expect(settings).toBeHidden();
});
