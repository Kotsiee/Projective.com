/**
 * DesignSystemProvider — mounts the theming engine.
 *
 *  - `root`: shares the global `dsConfig` store and binds it to `<html>` (the app-wide theme). Mount
 *    once, high in the tree (in Fresh, inside an island so it hydrates — see
 *    apps/web/features/theme/islands/DesignSystemRoot.island.tsx).
 *  - nested: pass `config` overrides to scope a subtree to its own theme (e.g. an always-dark
 *    preview pane). Writes the scoped tokens onto a wrapper element; context crosses freely for
 *    non-Fresh consumers.
 *
 * See DESIGN_SYSTEM.md §C.6.
 */
import type { ComponentChildren } from "preact";
import { useContext, useEffect, useMemo, useRef } from "preact/hooks";
import { effect, signal } from "@preact/signals";
import {
	applyConfig,
	bindRootTheme,
	DesignSystemContext,
	dsConfig,
	hydrateConfigFromDom,
} from "../core/context.ts";
import type { DesignSystemConfig } from "../types/mod.ts";

export interface DesignSystemProviderProps {
	/** Partial overrides. For a nested provider these scope the subtree; for root, prefer the store mutators (setMode/setSeed/updateConfig). */
	config?: Partial<DesignSystemConfig>;
	/** Root provider binds `<html>` and uses the global store. Omit for a nested scoped theme. */
	root?: boolean;
	children?: ComponentChildren;
}

export function DesignSystemProvider(
	{ config, root = false, children }: DesignSystemProviderProps,
) {
	const parent = useContext(DesignSystemContext);
	// Root shares the global store; nested derives a scoped store merged over its parent.
	const store = useMemo(() => (root ? dsConfig : signal({ ...parent.value, ...config })), [root]);
	const ref = useRef<HTMLDivElement | null>(null);

	// Keep a nested (scoped) store synced with its overrides + parent config.
	useEffect(() => {
		if (!root) store.value = { ...parent.value, ...config };
	}, [root, JSON.stringify(config), parent.value]);

	// Apply to the DOM: root → <html>; nested → wrapper element.
	useEffect(() => {
		if (root) {
			hydrateConfigFromDom();
			return bindRootTheme();
		}
		const el = ref.current;
		if (!el) return;
		return effect(() => applyConfig(el, store.value));
	}, [root]);

	if (root) {
		return <DesignSystemContext.Provider value={store}>{children}</DesignSystemContext.Provider>;
	}
	return (
		<DesignSystemContext.Provider value={store}>
			<div ref={ref} class="ds-scope">{children}</div>
		</DesignSystemContext.Provider>
	);
}
