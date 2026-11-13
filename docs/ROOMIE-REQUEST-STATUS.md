# Roomie request status — November 13, 2026

Use this checklist instead of repeatedly reconstructing the full chat. Distinguish implemented code, published PRs, merged code, and live verification. Do not call local drafts shipped.

## Latest decisions
- Announcements use one consistent background; never alternate colors by row position.
- Keep Berry and Orchid surfaces as approved. Retro: cream/deep-blue surfaces with bright colors in smaller accents. Coastal: ivory/sea-glass and charcoal-blue surfaces, with olive used sparingly.
- Selected palettes set the overall vibe. Use all seven palette colors in interface roles (actions, navigation, hover highlights, focus, markers and decorative details), not one hue everywhere. No fixed Coastal category colors. Category meaning/design is paused.
- Keep all five exact palette strips, personal preferences and light/dark modes. Use layered palette-colored backgrounds, cards, nested posts and balance tiles in all themes/modes. Use opaque fills and crisp contrasting text; no translucent overlay or blur.
- Page titles are visually hidden; navigation labels remain. Home overview sentence has no exclamation mark.
- Three independent cards in order: Invite roommates (code/Copy/Regenerate), current Roommates, Household details (rename/timezone/delete or leave). No former-roommate dropdown; management is inside profiles.

## Merged through PR 56
- Board filters replace Current/Resolved buttons; current is default.
- Separate Overdue/Cover requests cards; shared calendar toolbar and square feature-calendar cells.
- Home finance balance previews plus Needs/Wants wish list, no colored top border or Waiting on you.
- Compact contact/payment lists with Preferred badge, circular clickable avatars.
- Home date shortcuts prefill Add event/chore; Other-only label; Select all approvers; Edit response.
- Read activity disappears; answered requests clear; no navigation count badges or Who owes who.
- Wish list groups; crossed-out purchase history; expense autofill clears on deselection.
- Profile save refreshes from the saved response and leaves the button enabled.

## Follow-up branch: theme-accents-and-followups
- PR57 merged: remove fixed category colors and white announcement-action override; statuses and markers follow selected theme. Remove misleading calendar color legend while categories share one theme accent.
- Remove leftover descriptive Profile/email introductory copy.
- Exclude departed members' wishlist items from the Log expense picker.
- Exclude departed actors and unavailable sources from personal Activity responses.
- Measure dashboard tile heights so side cards nest without forced blank rows; resize when contents/window change. Allow drops in blank dashboard space to target the nearest tile slot.
- Dashboard still snaps to responsive slots using three width presets; arbitrary pixel placement is not supported.

## Verification still outstanding
- Live deployment/browser review of the latest changes, including narrow screens, text wrapping and drag previews.
- Lighthouse accessibility score >=90 is a target, not a verified result. Do not report contrast/unit checks as a Lighthouse score.
- Live end-to-end departure flow; source filters and regression checks do not prove old hosted records were cleaned.

## Intentionally paused
- Repeating/custom events requiring schema work. Do not run database migrations or hosted database cleanup without renewed authorization.
- Category color meanings and separate category palettes.

## Working preferences
- Minimal updates. Batch related edits. Run focused checks; do not repeatedly rerun unchanged checks.
- Never control the user's screen without permission. Never use Google Chrome unless explicitly requested.
- User reviews and merges PRs. Check PR state before updating a branch that may have merged.
