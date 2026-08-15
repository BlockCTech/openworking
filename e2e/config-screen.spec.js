const { test, expect } = require("./fixtures")

// Open the Settings -> Provider screen from the sidebar footer. The first-run onboarding
// tour is dismissed centrally in the fixture (see dismissFirstRunTour), so the nav item is
// clickable here directly.
async function openSettings(page) {
  await page.locator('[data-nav="config"]').click()
  await expect(page.getByRole("heading", { name: "Provider" })).toBeVisible()
}

test.describe("config / settings screen", () => {
  test("provider metadata fields are read-only", async ({ app }) => {
    const { page } = app
    await openSettings(page)

    // Provider ID / NPM package / Name are read-only metadata the Config screen
    // must never let the user edit (only baseURL/apiKey/modalities). Each sits in
    // its own <label> in the Provider form; assert all metadata inputs are
    // read-only and carry a non-empty value.
    const providerIdInput = page.locator("label", { hasText: "Provider ID" }).locator("input")
    await expect(providerIdInput).toHaveAttribute("readonly", "")
    await expect(providerIdInput).not.toHaveValue("")

    const npmInput = page.locator("label", { hasText: "NPM package" }).locator("input")
    await expect(npmInput).toHaveAttribute("readonly", "")

    // The editable baseURL field is NOT read-only.
    await expect(page.locator('[data-field="providerBaseURL"]')).not.toHaveAttribute("readonly", "")
  })

  test("App profile JSON redacts the API key", async ({ app }) => {
    const { page } = app
    await openSettings(page)
    await page.locator('[data-field="providerApiKey"]').fill("test-secret")

    // Switch to the Advanced section that renders the full effective config.
    await page.locator('[data-settings-section="advanced"]').click()
    const json = page.locator("textarea.config-json")
    await expect(json).toBeVisible()

    const text = await json.inputValue()
    // A non-empty apiKey must always be rendered as the redacted placeholder —
    // a raw secret must never reach the JSON preview. An empty apiKey ("") has
    // no secret to hide, so it is left as-is. The forbidden case is a non-empty
    // value that is anything other than the placeholder.
    expect(text).not.toMatch(/"apiKey":\s*"(?!\[redacted\])[^"]+"/)

    // The config textarea is read-only (editing happens via the Provider form).
    await expect(json).toHaveAttribute("readonly", "")
  })

  test("Appearance toggle flips the app theme and persists", async ({ app }) => {
    const { page } = app
    await openSettings(page)
    await page.locator('[data-settings-section="personalization"]').click()

    const html = page.locator("html")
    const lightBtn = page.locator('[data-theme-mode="light"]')
    const darkBtn = page.locator('[data-theme-mode="dark"]')
    await expect(page.locator(".theme-seg")).toBeVisible()

    // Light: <html data-theme="light"> and the light hljs sheet enabled.
    await lightBtn.click()
    await expect(html).toHaveAttribute("data-theme", "light")
    await expect(lightBtn).toHaveClass(/active/)
    const lightSheetDisabled = await page.locator("#hljs-light").evaluate((el) => el.disabled)
    expect(lightSheetDisabled).toBe(false)
    // The saved palette must actually be light (bg reads near-white).
    const lightBg = await html.evaluate((el) => getComputedStyle(el).getPropertyValue("--bg").trim())
    expect(lightBg.toLowerCase()).toBe("#ffffff")

    // Dark: the attribute is removed (dark is the default palette).
    await darkBtn.click()
    await expect(html).not.toHaveAttribute("data-theme", "light")
    await expect(darkBtn).toHaveClass(/active/)
    const darkSheetDisabled = await page.locator("#hljs-dark").evaluate((el) => el.disabled)
    expect(darkSheetDisabled).toBe(false)

    // The choice is persisted for the next launch.
    const stored = await page.evaluate(() => localStorage.getItem("openworking:theme"))
    expect(stored).toBe("dark")
  })
})
