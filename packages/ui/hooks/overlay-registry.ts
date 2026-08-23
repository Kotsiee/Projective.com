/// <reference lib="dom" />
/**
 * `overlay-registry` — the containment model for portalled overlays.
 *
 * The `dom` lib reference above is explicit because this module imports nothing. Every other file in
 * the package receives the DOM globals transitively through Preact's type definitions; with no
 * imports at all, `Node`/`HTMLElement`/`ShadowRoot` would be unresolved the moment this file is
 * type-checked on its own (which is exactly what `deno test` does).
 *
 * Every anchored surface in this package renders its panel through `BodyPortal`, which appends a
 * fresh `document.body` child. That is deliberate and load-bearing (it escapes `overflow: clip`,
 * stacking contexts, and the `transform`/`filter`/`backdrop-filter` re-base trap), but it costs the
 * one thing outside-click detection was built on: **DOM ancestry**. A `Select` opened from inside a
 * modal is a SIBLING of that modal in the document, so `modalPanel.contains(optionRow)` is `false`
 * and the modal reads its own child's click as an outside click. `composedPath()` does not help —
 * the panel is genuinely a body child, so its path contains `body`/`html`, never the modal.
 *
 * This module restores the missing relation without giving up the portal. Each open overlay
 * registers its panel and its trigger; ownership is then derived from the DOM at check time:
 *
 *   an overlay B is a CHILD of overlay A  ⟺  A's panel contains B's trigger
 *
 * The trigger is the one element that is never portalled — it stays where the author wrote it, so it
 * is the honest link back to the surface that opened the panel. Ownership is computed live on every
 * query rather than cached at open time, so a panel whose trigger moves (a re-render, a lane that
 * collapses) cannot strand a stale parent.
 *
 * Preact context is deliberately NOT used for this: `BodyPortal` renders through a separate
 * `render()` root, so a provider above the trigger is not visible to the panel's tree.
 */

// #region Registry
/** One live overlay's DOM claim. */
interface OverlayEntry {
	/** The floating panel — portalled, so it is a `document.body` child. */
	panel: () => HTMLElement | null;
	/** The control that opened it — never portalled, so it locates the owner. */
	trigger: () => HTMLElement | null;
}

/** Open overlays by id. Registration is tied to the `useDismiss` effect's lifetime. */
const registry = new Map<string, OverlayEntry>();

/** Register an open overlay. Returns the unregister function. */
export function registerOverlay(id: string, entry: OverlayEntry): () => void {
	registry.set(id, entry);
	return () => {
		registry.delete(id);
	};
}
// #endregion

// #region Containment
/**
 * The id of the overlay whose PANEL most deeply contains `node`, or `null` when the node is not
 * inside any registered panel.
 *
 * "Most deeply" matters: a dropdown panel nested inside a draggable popover's panel is contained by
 * both, and the answer must be the inner one or the ownership walk starts from the wrong place.
 * Depth is measured by walking up from the node — the first panel we meet is the innermost.
 */
function panelOwnerOf(node: Node | null): string | null {
	if (!node) return null;
	let el: Node | null = node;
	while (el) {
		for (const [id, entry] of registry) {
			if (entry.panel() === el) return id;
		}
		el = el.parentNode ?? (el as ShadowRoot).host ?? null;
	}
	return null;
}

/**
 * Whether `target` lies inside overlay `id` — counting its own panel, its own trigger, and the
 * panel of any overlay transitively OPENED FROM it.
 *
 * The walk is bounded by `registry.size` rather than `while (true)`: ownership is derived from live
 * DOM, and a pathological arrangement (a trigger rendered inside its own panel) would otherwise
 * spin forever inside an event handler.
 */
export function isWithinOverlay(target: Node | null, id: string): boolean {
	if (!target) return false;

	const self = registry.get(id);
	if (self?.panel()?.contains(target)) return true;
	if (self?.trigger()?.contains(target)) return true;

	// Walk the ownership chain up from whichever panel the target actually landed in.
	let cursor = panelOwnerOf(target);
	for (let hops = 0; cursor && hops <= registry.size; hops++) {
		if (cursor === id) return true;
		const entry = registry.get(cursor);
		const trigger = entry?.trigger();
		if (!trigger) return false;
		const next = panelOwnerOf(trigger);
		if (next === cursor) return false; // self-owning: stop rather than loop
		cursor = next;
	}
	return false;
}

/**
 * Whether `node` lies inside an overlay that was OPENED FROM somewhere inside `container`.
 *
 * The focus counterpart of {@link isWithinOverlay}, for callers that own a DOM subtree rather than a
 * registered overlay id — a focus trap knows its container element, not an overlay identity.
 *
 * A trap that tests `container.contains(activeElement)` has the same blind spot outside-click
 * detection had: a panel opened from inside the trapped subtree is portalled to `document.body`, so
 * the trap reads focus landing in its own child as focus ESCAPING and pulls it back — which makes
 * every control in that panel unreachable by keyboard. Ownership answers it correctly: the panel's
 * chain leads to a trigger that IS inside the container.
 */
export function containerOwnsNode(container: HTMLElement | null, node: Node | null): boolean {
	if (!container || !node) return false;

	let cursor = panelOwnerOf(node);
	for (let hops = 0; cursor && hops <= registry.size; hops++) {
		const entry = registry.get(cursor);
		const trigger = entry?.trigger();
		if (!trigger) return false;
		if (container.contains(trigger)) return true;
		const next = panelOwnerOf(trigger);
		if (next === cursor) return false; // self-owning: stop rather than loop
		cursor = next;
	}
	return false;
}
// #endregion
