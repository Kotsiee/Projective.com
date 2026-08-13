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
