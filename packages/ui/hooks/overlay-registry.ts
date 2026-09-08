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
 * registers, and ownership is derived at check time from three links, tried in that order:
 *
 *   1. **the trigger** — the control that opened the panel. Never portalled, so it stays where the
 *      author wrote it and is the honest link back to the opener.
 *   2. **the host** — an in-tree node the overlay component renders in place. Same property as a
 *      trigger, for a surface opened from state rather than from one particular button.
 *   3. **the overlay that was innermost-open at the moment this one registered.**
 *
 * (1) and (2) are exact and DOM-derived: they are re-read on every query, so a panel whose opener
 * moves (a re-render, a lane that collapses) cannot strand a stale parent, and an overlay whose
 * trigger sits on the PAGE is correctly reported as having no parent at all.
 *
 * (3) exists because most modals have neither. A `Dialog`, a `Drawer` and the asset picker are all
 * opened from state — often from a menu item that unmounts as the modal appears — so no live element
 * anywhere in the document ties them to their opener. Before this fallback the walk simply gave up at
 * such an overlay (`if (!trigger) return false`), which reported a click inside a nested modal as
 * OUTSIDE for every ancestor and collapsed the whole stack on the first click. Open order is a weaker
 * signal than the DOM, so it is consulted only when the DOM cannot answer, and it fails in the safe
 * direction: the worst case is an unrelated overlay treated as a child, which withholds a dismissal
 * rather than discarding work.
 *
 * ## Regions, and why a backdrop is not "outside"
 *
 * An overlay is more than its panel: `BodyPortal` gives it a container holding the backdrop and the
 * panel together. A click on a CHILD overlay's backdrop lands in no registered panel at all, so both
 * ancestry and panel-ownership call it a click on nothing — and every ancestor dismissed. The region
 * is therefore derived from the panel's own portal container, which costs no per-component change and
 * stays correct for an overlay that is deliberately not portalled (its region is just its panel). The
 * distinction is asymmetric on purpose: a backdrop is INSIDE the overlay's ancestors, so they stay
 * open, and OUTSIDE the overlay that owns it, so clicking it still dismisses that one.
 *
 * Preact context is deliberately NOT used for any of this: `BodyPortal` renders through a separate
 * `render()` root, so a provider above the trigger is not visible to the panel's tree.
 */

// #region Registry
/** One live overlay's DOM claim. */
export interface OverlayEntry {
	/** The floating panel — portalled, so it is a `document.body` child. */
	panel: () => HTMLElement | null;
	/** The control that opened it — never portalled, so it locates the owner. */
	trigger: () => HTMLElement | null;
	/**
	 * An in-tree node the overlay renders where the author wrote it, for a surface with no single
	 * trigger element. Same job as {@link OverlayEntry.trigger}, and consulted straight after it.
	 */
	host?: () => HTMLElement | null;
}

/** A registered overlay, plus the open-order parent captured when it registered. */
interface LiveEntry extends OverlayEntry {
	/** Innermost overlay open at registration time — the last-resort parent link. */
	openedUnder: string | null;
}

/** Open overlays by id, in open order. Registration is tied to the `useDismiss` effect's lifetime. */
const registry = new Map<string, LiveEntry>();

/** The innermost overlay currently open, ignoring `except` — an id re-registering is not its own parent. */
function innermostOpen(except: string): string | null {
	let last: string | null = null;
	for (const id of registry.keys()) if (id !== except) last = id;
	return last;
}

/** Register an open overlay. Returns the unregister function. */
export function registerOverlay(id: string, entry: OverlayEntry): () => void {
	// A re-registering overlay keeps the parent it opened under. The effect that registers re-runs
	// whenever a ref identity changes, and recomputing here would re-parent a modal onto a child that
	// opened in the meantime — inverting the very chain this is supposed to describe.
	const openedUnder = registry.get(id)?.openedUnder ?? innermostOpen(id);
	registry.set(id, { ...entry, openedUnder });
	return () => {
		registry.delete(id);
	};
}
// #endregion

// #region Containment
/**
 * The overlay's whole layer: the portal container holding its backdrop and its panel, or the panel
 * itself when the overlay is deliberately not portalled.
 */
function regionOf(entry: LiveEntry): HTMLElement | null {
	const panel = entry.panel();
	if (!panel) return null;
	const container = typeof panel.closest === "function"
		? panel.closest<HTMLElement>("[data-ui-portal]")
		: null;
	return container ?? panel;
}

/**
 * The id of the overlay whose REGION most deeply contains `node`, or `null` when the node is not
 * inside any registered overlay.
 *
 * "Most deeply" matters: a dropdown panel nested inside a draggable popover's panel is contained by
 * both, and the answer must be the inner one or the ownership walk starts from the wrong place.
 * Depth is measured by walking up from the node — the first overlay we meet is the innermost.
 *
 * At each level the PANEL is matched before the region. A panel belongs to exactly one overlay,
 * whereas a portal container can be shared — an overlay deliberately rendered in-tree (`toBody:
 * false`) inside a portalled one resolves to that outer container as its region. Walking up meets
 * the inner panel first, so the inner overlay wins its own subtree instead of the answer depending
 * on registry iteration order.
 */
function overlayOwning(node: Node | null): string | null {
	if (!node) return null;
	let el: Node | null = node;
	while (el) {
		for (const [id, entry] of registry) {
			if (entry.panel() === el) return id;
		}
		for (const [id, entry] of registry) {
			if (regionOf(entry) === el) return id;
		}
		el = el.parentNode ?? (el as ShadowRoot).host ?? null;
	}
	return null;
}

/**
 * The id of the overlay that opened `id`, or `null` when it was opened from the page.
 *
 * The three links are tried in order of how much each actually knows. A live trigger or host is
 * DEFINITIVE — including when it resolves to no overlay, which is the honest answer "this was opened
 * from the page", and is what stops two independently-opened overlays from deafening each other.
 * Only when neither element exists does open order stand in.
 */
function parentOf(id: string): string | null {
	const entry = registry.get(id);
	if (!entry) return null;
	const trigger = entry.trigger();
	if (trigger) return overlayOwning(trigger);
	const host = entry.host?.();
	if (host) return overlayOwning(host);
	return entry.openedUnder;
}

/**
 * Whether `target` lies inside overlay `id` — counting its own panel, its own trigger, and the whole
 * layer of any overlay transitively OPENED FROM it.
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

	// Walk the ownership chain up from whichever overlay the target actually landed in.
	let cursor = overlayOwning(target);

	// Our own region but not our own panel: our backdrop. Outside for US — which is what makes a
	// backdrop click dismiss — while the loop below keeps it INSIDE for everyone above us.
	if (cursor === id) return false;

	for (let hops = 0; cursor && hops <= registry.size; hops++) {
		if (cursor === id) return true;
		const next = parentOf(cursor);
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
 * chain leads to a trigger, a host, or an opener whose panel IS this container.
 */
export function containerOwnsNode(container: HTMLElement | null, node: Node | null): boolean {
	if (!container || !node) return false;

	let cursor = overlayOwning(node);
	for (let hops = 0; cursor && hops <= registry.size; hops++) {
		const entry = registry.get(cursor);
		if (!entry) return false;

		const trigger = entry.trigger();
		if (trigger && container.contains(trigger)) return true;
		const host = entry.host?.();
		if (host && container.contains(host)) return true;

		const next = parentOf(cursor);
		if (next === cursor) return false; // self-owning: stop rather than loop
		// The open-order link: the container IS the opener's own panel. Identity, never `contains` — a
		// container that merely sits inside the opener says nothing about who opened this overlay.
		if (next !== null && registry.get(next)?.panel() === container) return true;
		cursor = next;
	}
	return false;
}
// #endregion
