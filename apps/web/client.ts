/**
 * Projective client entry (loaded on every page).
 *
 * Imports the global token contract from `@projective/ui/styles` (DESIGN_SYSTEM.md Part A) followed
 * by the app-frame styles. The Material You theming engine (`@projective/ui/system`) writes the
 * runtime color custom-properties; this file only wires the static token + frame layer.
 */
import "@projective/ui/styles";
import "@ui/layout/styles/index.css";
import "@ui/navigation/styles/index.css";
import "@web/styles/global.css";
/*
 * The authenticated shell's own chrome sheet.
 *
 * `UserShell` is a SERVER component, so its `import "../styles/user-shell.css"` never reaches a
 * client bundle — the sheet has always arrived as a side effect of the `ShellSidebar` and
 * `UserActions` islands, which both carry a comment saying so. The focus chrome
 * (DESIGN_SYSTEM.md Part D.6) renders NEITHER island, so on `/checkout/details` and
 * `/checkout/payment` the header stylesheet vanished entirely and the brand-only top bar painted
 * unstyled. Importing it here — where every page loads it regardless of which islands mount — is
 * the fix; the island-level imports stay, because the bundler dedupes them and removing them would
 * risk the reverse regression on every non-focus route.
 */
import "@web/features/shell/styles/user-shell.css";
/*
 * The guest shell's chrome sheet, here for exactly the same reason.
 *
 * It shipped as a side effect of the `GuestAside` island, so it reached a page only when a route
 * supplied a LANE. The `/view` routes now render their conversion rail in the page and decline the
 * shell's lane slot while still registering a floating sub-header — so on a signed-out listing page
 * the aside island never mounts, and `.guest-shell__subheader` would paint as a static, unstyled
 * block instead of a pinned glass band. Importing it where every page loads it regardless of which
 * islands mount is the fix; the island-level import stays, because the bundler dedupes it and
 * removing it risks the reverse regression on every lane route.
 */
import "@web/features/shell/styles/guest-shell.css";
