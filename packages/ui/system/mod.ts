/**
 * @projective/ui/system — the theming engine and framework-level configuration.
 *
 * The ONLY place `@material/material-color-utilities` is imported (approved exception,
 * SYSTEM_ARCHITECTURE.md §3). Structure (unified convention): `types/` · `core/` · `components/`.
 *   - types: DesignSystemConfig · ThemeMode · CvdMode · ThemeInput.
 *   - core/theme-engine: buildScheme · schemeToCss · applyScheme (pure; SSR-safe).
 *   - core/context: dsConfig store · DesignSystemContext · useDesignSystem · mutators · bindRootTheme
 *     · hydrateConfigFromDom · applyConfig.
 *   - components/DesignSystemProvider: the mount component.
 *
 * Components never import this for values — they read the emitted `var(--*)` custom properties.
 */
export * from "./types/mod.ts";
export * from "./core/theme-engine.ts";
export * from "./core/context.ts";
export * from "./components/DesignSystemProvider.tsx";
