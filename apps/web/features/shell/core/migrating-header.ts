import { signal } from "@preact/signals";

/**
 * migrating-header — the ONE cross-island bridge behind the shell's scroll-migrated sticky header
 * (`DESIGN_SYSTEM.md` §D.7.6), shared by every surface that registers a band in the shell's header
 * slot: the entity view (`/view/[id]`, `/[handle]/view/[id]`) and the profile (`/[handle]`).
 *
 * Two hydration roots take part and neither can reach the other: the PAGE island that measures the
 * scroll (the hero's probe, the hero's rig) and the BAND island in `ui-middle-nav__header` /
 * `guest-shell__subheader` that reveals. Before this module each surface carried its own signal
 * (`viewHeaderCondensed`, `profileHeaderCondensed`), its own probe rule and its own back-control
 * withdrawal — three parallel implementations of one behaviour, which is how the profile came to
 * ship with TWO reachable Back controls once its band had revealed while the entity view withdrew
 * its page copy correctly.
 *
 * The signal is written on the CLIENT only. A module-level signal is shared across every request a
 * server process renders, so seeding it from props would be a data race between two viewers
 * (the Decision #69 finding); the SSR paint is always the collapsed state.
 */

// #region State
/**
 * Whether the page's anchor region has scrolled up under the shell's chrome, so the header band
 * should reveal the condensed identity. One producer (the page's probe) and one consumer (the
 * band) are ever mounted together, because every slot resolver returns exactly one band per URL.
 */
export const headerCondensed = signal(false);

/** The root attribute the page copy of the back control withdraws on (`migrating-back.css`). */
export const HEADER_CONDENSED_ATTR = "data-header-condensed";

const PAGE_BACK = ".shell-back--page";
const BAND_BACK = ".shell-back--band";
// #endregion

// #region Reflect
/**
 * Write the condensed state everywhere it is read: the signal (the band island), the root attribute
 * (the page copy's CSS withdrawal — the page's back control is server-rendered and owned by no
 * island, so an attribute is the only channel that reaches it), and keyboard focus.
 *
 * **Focus follows the control.** The two copies of the back control are mutually exclusive by
 * `visibility`, and a focused element that becomes `visibility: hidden` drops focus to `<body>` —
 * so a keyboard user who had reached the page copy and then scrolled would lose their place the
 * instant the band took over. If the copy that is about to withdraw holds focus, the copy that is
 * taking over receives it, with `preventScroll` so the hand-over never moves the page the reader is
 * scrolling. The band copy is focusable the moment it condenses (`.pf-stickyhead` flips
 * `visibility` with no delay on reveal), and the page copy the moment the attribute clears.
 */
export function reflectHeaderCondensed(condensed: boolean): void {
	if (headerCondensed.peek() === condensed) return;
	headerCondensed.value = condensed;

	const root = document.documentElement;
	root.setAttribute(HEADER_CONDENSED_ATTR, condensed ? "true" : "false");

	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return;
	const leaving = condensed ? PAGE_BACK : BAND_BACK;
	const arriving = condensed ? BAND_BACK : PAGE_BACK;
	if (!active.matches(leaving)) return;
	/*
	 * Deferred past the band island's re-render. The signal write above only QUEUES that render, so
	 * at this instant the band still carries `data-condensed="false"` and is `visibility: hidden` —
	 * a synchronous `focus()` on its copy is refused (measured: focus fell to `<body>`). A macrotask
	 * runs after Preact's microtask-batched render has committed the attribute. By then the leaving
	 * copy has already dropped focus to `<body>`, so the guard is "nothing else has taken it since".
	 */
	setTimeout(() => {
		if (headerCondensed.peek() !== condensed) return;
		const now = document.activeElement;
		if (now !== null && now !== document.body && now !== active) return;
		document.querySelector<HTMLElement>(arriving)?.focus({ preventScroll: true });
	}, 0);
}

/**
 * Reset on unmount. The signal is module-level, so a same-tab navigation into a page whose header
 * band is `null` would otherwise inherit `true`; and the root attribute would keep the next page's
 * back control withdrawn with nothing to take its place.
 */
export function clearHeaderCondensed(): void {
	headerCondensed.value = false;
	document.documentElement.removeAttribute(HEADER_CONDENSED_ATTR);
}
// #endregion
