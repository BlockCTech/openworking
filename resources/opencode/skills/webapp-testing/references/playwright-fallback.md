# Playwright Fallback

Use Playwright only when it is already available or the user approves installation.

For a focused fallback test:

1. Open the target URL after the server reports readiness.
2. Use stable roles, labels or test IDs for selectors.
3. Exercise one user-visible behavior at a time.
4. Record console errors and failed network responses.
5. Take a screenshot when a visual failure needs evidence.
6. Close the browser and stop the local server.

Avoid brittle selectors tied to transient generated classes.
