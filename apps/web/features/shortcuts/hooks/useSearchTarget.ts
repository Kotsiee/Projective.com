import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { ToggleableShortcutId } from "@projective/types/org";
import { shortcutOn } from "../core/shortcut-registry.ts";
import type { SearchTargetRole } from "../core/search-targets.ts";
import { registerSearchTarget, searchFieldOf } from "../core/shortcut-host.ts";

export interface SearchTargetOptions {
	/** `page` answers `/`; `lane` Ctrl/Cmd+Shift+/; `header` Ctrl/Cmd+/ and a `/` the page leaves unclaimed. */
	role: SearchTargetRole;
	/** The search field, or an element holding it. */
	scopeRef: RefObject<HTMLElement>;
	/** Ranks rival fields of one role; higher wins (default 0). */
	priority?: number;
	/** Offer the field at all (default true). */
	enabled?: boolean;
	/** Whether the field may take focus now, for a field that must be revealed first. Read once. */
	available?: () => boolean;
	/** Bring the search up in place of focusing the field (open an overlay, switch a pane). Read once. */
	activate?: () => void;
	/** Paint `aria-keyshortcuts` on the field (default true); off where the field renders its own. */
	announce?: boolean;
}

const ROLE_SHORTCUT: Record<SearchTargetRole, ToggleableShortcutId> = {
	page: "focus-search",
	lane: "focus-lane-search",
	header: "focus-header-search",
};

const ROLE_KEYS: Record<SearchTargetRole, string> = {
	page: "/",
	lane: "Control+Shift+/ Meta+Shift+/",
	header: "Control+/ Meta+/",
};

/**
 * useSearchTarget — offer the search field inside `scopeRef` to the platform's search shortcuts
 * through the one shared listener (`shortcut-host.ts`, Decision #418). Nothing binds a key here:
 * the host decides at keydown which offered field a key reaches. Released on unmount.
 */
export function useSearchTarget(options: SearchTargetOptions): void {
	const live = useRef(options);
	live.current = options;
	const { role, scopeRef, enabled = true, announce = true } = options;

	useEffect(() => {
		if (!enabled) return;
		const initial = live.current;
		const release = registerSearchTarget({
			role,
			element: () => scopeRef.current,
			get priority() {
				return live.current.priority ?? 0;
			},
			available: initial.available ? () => live.current.available?.() ?? false : undefined,
			activate: initial.activate ? () => live.current.activate?.() : undefined,
		});
		const field = announce && shortcutOn(ROLE_SHORTCUT[role])
			? searchFieldOf(scopeRef.current)
			: null;
		const keys = ROLE_KEYS[role];
		if (field && !field.hasAttribute("aria-keyshortcuts")) {
			field.setAttribute("aria-keyshortcuts", keys);
		}
		return () => {
			release();
			if (field?.getAttribute("aria-keyshortcuts") === keys) {
				field.removeAttribute("aria-keyshortcuts");
			}
		};
	}, [announce, enabled, role, scopeRef]);
}
