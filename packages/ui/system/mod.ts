/**
 * @projective/ui/system — the theming engine and framework-level configuration.
 *
 * This is the ONLY place `@material/material-color-utilities` may be imported (approved exception,
 * SYSTEM_ARCHITECTURE.md §3). Responsibilities (DESIGN_SYSTEM.md Part A.2 & §C.6):
 *   - buildScheme(seedHex, dark): seed → HCT → DynamicScheme → CSS custom-property map.
 *   - DesignSystemProvider / DesignSystemContext: nestable active-config token context.
 *   - asset-registry.ts: centralized open-source (e.g. Unsplash) media fallbacks.
 *
 * Components never import this module for values — they read the emitted `var(--*)` properties.
 * Structural scaffold only.
 */
export {};
