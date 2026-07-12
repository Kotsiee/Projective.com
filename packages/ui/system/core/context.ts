/**
 * DesignSystemContext — the active layout-configuration tokens, exposed two ways:
 *
 *  1. A module-singleton signal store (`dsConfig`) shared across every island — this is the
 *     reliable cross-island channel in Fresh, where a Preact Context does NOT propagate between
 *     independently-hydrated islands. Components style themselves from the emitted `--*` CSS
 *     variables (which live on :root), so they are themed regardless of island boundaries.
 *  2. A Preact Context (`DesignSystemContext`) for nested/scoped overrides and for non-Fresh SPA
 *     consumers where context crosses freely. Read it with `useDesignSystem()`.
 *
 * See DESIGN_SYSTEM.md §C.6.
 */
import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { effect, type Signal, signal } from "@preact/signals";
import { applyScheme, buildScheme } from "./theme-engine.ts";
import type { DesignSystemConfig, ThemeMode } from "../types/mod.ts";

// #region Store
export const DEFAULT_CONFIG: DesignSystemConfig = {
	seed: "#288690",
	mode: "light",
	radiusScale: 1,
	shadowIntensity: 1,
	highContrast: false,
	reducedMotion: false,
	dyslexicFont: false,
	cvd: "none",
};

/** Global, island-shared active configuration. */
export const dsConfig: Signal<DesignSystemConfig> = signal({ ...DEFAULT_CONFIG });

/** Preact context wrapping the active-config signal (defaults to the global store). */
export const DesignSystemContext = createContext<Signal<DesignSystemConfig>>(dsConfig);

/** Read the active configuration value (reactive) from the nearest provider or the global store. */
export function useDesignSystem(): DesignSystemConfig {
	return useContext(DesignSystemContext).value;
}
// #endregion

// #region Mutators
function persist(mode: ThemeMode): void {
	try {
		localStorage.setItem("theme", mode);
	} catch {
		/* storage unavailable — non-fatal */
	}
}

/** Patch the global configuration. */
export function updateConfig(patch: Partial<DesignSystemConfig>): void {
	dsConfig.value = { ...dsConfig.value, ...patch };
	if (patch.mode) persist(patch.mode);
}

export function setMode(mode: ThemeMode): void {
	updateConfig({ mode });
}

export function toggleMode(): void {
	setMode(dsConfig.value.mode === "dark" ? "light" : "dark");
}

export function setSeed(seed: string): void {
	updateConfig({ seed });
}
// #endregion

// #region DOM application
/** Apply a full configuration to an element: color tokens + scale knobs + a11y data-attributes. */
export function applyConfig(el: HTMLElement, cfg: DesignSystemConfig): void {
	applyScheme(
		el,
		buildScheme({ seed: cfg.seed, dark: cfg.mode === "dark", highContrast: cfg.highContrast }),
	);
	el.style.setProperty("--radius-scale", String(cfg.radiusScale));
	el.style.setProperty("--shadow-intensity", String(cfg.shadowIntensity));
	el.dataset.theme = cfg.mode;
	el.dataset.contrast = cfg.highContrast ? "high" : "normal";
	el.dataset.font = cfg.dyslexicFont ? "dyslexic" : "default";
	el.dataset.cvd = cfg.cvd;
	el.dataset.motion = cfg.reducedMotion ? "reduced" : "full";
}

/** Sync the store's `mode` from the pre-paint `<html data-theme>` set by the inline theme script. */
export function hydrateConfigFromDom(): void {
	if (typeof document === "undefined") return;
	const mode: ThemeMode = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
	if (mode !== dsConfig.value.mode) dsConfig.value = { ...dsConfig.value, mode };
}

/**
 * Bind the global store to `<html>`: reactively apply the active config to `:root` whenever it
 * changes. Client-only; returns a dispose function. Idempotent across calls.
 */
let rootBound = false;
export function bindRootTheme(): () => void {
	if (typeof document === "undefined" || rootBound) return () => {};
	rootBound = true;
	const dispose = effect(() => applyConfig(document.documentElement, dsConfig.value));
	return () => {
		dispose();
		rootBound = false;
	};
}
// #endregion
