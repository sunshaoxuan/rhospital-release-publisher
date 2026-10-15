# Meelok Notification UI Evidence

Source: notification-only publisher changes based on b71454c624556b90f12a2249f3dab04e1e2a1a9c, before commit. Actual release-console HTML/CSS/JavaScript, Chrome/Playwright, isolated fixture on loopback port 18793. All release data is simulated. No production command or release request was executed.

The eight full-page captures cover pending, running, healthy and warning at 1440x1100 and 390x844. Matching restore-region captures retain native browser pixels. Additional viewport, running-status and scrolled mobile captures support readable visual review. The fixture includes the generated Meelok titles and validation text from the actual plan, with sanitized command text.

Function: zero console errors or failed requests across the eight cases; zero observed HTTP errors on final desktop/mobile reloads. Warning cases retain EXECUTED with SUCCESS_WITH_WARNINGS. The existing 280px log area scrolls to the fifth service. browser.json records line-box containment and scrolling. These DOM bounds do not measure visible glyph centering.

Visual: primary reviewed both full-page compositions and native-size changed text regions. Long labels wrap, panel borders remain intact, and status/restart facts and warnings remain readable. No controls, fonts, CSS or layout were changed, so there is no new control alignment budget. Gemini Pro and Gemini 3.8 Flash image probes were unavailable; external visual advice is not claimed.

Behavioral verification: npm test, 360 passed, zero failures or skipped tests. Full acceptance and two-round scope review are in docs/tasks/20261016-release-result-investigation.md.
