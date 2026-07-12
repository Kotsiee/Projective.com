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
