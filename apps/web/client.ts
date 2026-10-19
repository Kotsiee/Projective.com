/**
 * Projective client entry (loaded on every page).
 *
 * Imports the global token contract from `@projective/ui/styles` (DESIGN_SYSTEM.md Part A) followed
 * by the app-frame styles. The Material You theming engine (`@projective/ui/system`) writes the
 * runtime color custom-properties; this file only wires the static token + frame layer.
 */
// Must stay the FIRST import: puts Zod in jitless mode before any island builds a schema, so its
// `new Function` eval probe never trips the CSP (see the module's header).
import "@web/utils/zod-jitless.ts";
import "@projective/ui/styles";
import "@ui/layout/styles/index.css";
import "@ui/navigation/styles/index.css";
/*
 * The editorial reading family (DocumentLayout, Prose, ContentRenderer, the TOC, reading progress and
 * the print layer). Most of it is SERVER-rendered, so its sheet cannot ride a component import; its
 * two islands carry it too, but a document page that mounts neither (a short changelog entry, a hub
 * without a table of contents) must still be styled.
 */
import "@ui/display/styles/editorial.css";
/*
 * EmptyState, for the root error page (`routes/_error.tsx`): it renders outside every group layout
 * and mounts no island that imports `@projective/ui/utils`, so the sheet otherwise never reached it
 * and the 404 / 500 card painted as unstyled, left-aligned text.
 */
import "@ui/utils/styles/empty-state.css";
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
