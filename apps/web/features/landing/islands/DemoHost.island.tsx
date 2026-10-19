/// <reference lib="dom" />
import "@ui/kanban/styles/kanban.css";
import "@ui/display/styles/money-view.css";
import "@features/projects/styles/funding-status.css";
import "../styles/lp-theatre.css";
import "../styles/lp-demo.css";
import "../styles/demos/board.css";
import "../styles/demos/payments.css";
import "../styles/demos/booking.css";
import "../styles/demos/splits.css";
import type { ComponentChildren, JSX } from "preact";
import { effect, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { DemoComponent, DemoId } from "../core/demos/demo-contract.ts";
import { motionAllowed } from "../core/hero-motion.ts";
import {
	DEMO_IDS,
	DEMO_SECTION_ID,
	samePageDemoLink,
	tabFocusTarget,
	urlWithDemo,
} from "../core/demo-stage.ts";
import { type DemoAnnouncement, DemoStageView } from "../components/DemoStageView.tsx";

// #region Demos
/** A demo module: its default export is the demo (`core/demos/demo-contract.ts`). */
type DemoModule = { default: DemoComponent };

/**
 * Each tab's demo, imported only when it is opened near the viewport: each is its own lazy chunk
 * (≤ 35 kB, `core/js-budget.ts`), outside `islands/`, so the server snapshot never evaluates one.
 */
const DEMOS: Readonly<Record<DemoId, () => Promise<DemoModule>>> = {
	board: () => import("../components/demos/BoardDemo.demo.tsx"),
	payments: () => import("../components/demos/PaymentsDemo.demo.tsx"),
	booking: () => import("../components/demos/BookingDemo.demo.tsx"),
	splits: () => import("../components/demos/TeamPayDemo.demo.tsx"),
};

/** How far ahead of the viewport the stage starts loading its open demo. */
const NEAR_MARGIN = "50% 0px";

/** `prefers-reduced-motion`, the OS channel (the in-app one is `:root[data-motion]`). */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** The share of a scrolling tab strip its trailing fade covers (`lp-demo.css`, `.lp-demo__tabs`). */
const TAB_FADE = 0.15;
// #endregion

// #region Tab strip
/**
 * Below --bp-md the tab strip scrolls sideways: scroll it — the strip only, never the page — so
 * the open tab is wholly in view, clear of the trailing fade. Instant under either reduced-motion
 * channel.
 */
function revealTab(tab: HTMLElement | null | undefined): void {
	const strip = tab?.parentElement;
	if (!tab || !strip || strip.scrollWidth <= strip.clientWidth) return;
	const box = strip.getBoundingClientRect();
	const at = tab.getBoundingClientRect();
	const end = box.right - box.width * TAB_FADE;
	const delta = at.left < box.left ? at.left - box.left : at.right > end ? at.right - end : 0;
	if (delta === 0) return;
	strip.scrollTo({
		left: strip.scrollLeft + delta,
		behavior: motionAllowed() ? "smooth" : "auto",
	});
}

/** Mark a scrolled-to-the-end strip, so its trailing fade lifts and its last tab reads whole. */
function markStripEnd(strip: HTMLElement): void {
	const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
	if (atEnd) strip.dataset.atEnd = "";
	else delete strip.dataset.atEnd;
}
// #endregion

// #region Host
/** Props for {@link DemoHost}. */
export interface DemoHostProps {
	/** The tab the server rendered open (`?demo=`, default `board`). */
	initial: DemoId;
	/** The platform fee in basis points from the server, or `null` when it is unavailable. */
	feeBp: number | null;
	/** Render "See everything Projective does" — only once `/features` exists (work order L5). */
	features?: boolean;
	/** The Work board's poster: the server-rendered still of its board. */
	children?: ComponentChildren;
	/** Payment protection's poster: the server-rendered still of its opening picture. */
	paymentsPoster?: ComponentChildren;
	/** Booking's poster: the server-rendered still of its first frame. */
	bookingPoster?: ComponentChildren;
	/** Team pay's poster: the server-rendered still of its opening picture. */
	splitsPoster?: ComponentChildren;
}

/**
 * DemoHost — the demo stage's island (`flows/LANDING.md` §2.1 notes 10–13, §2.7, §4.4; work order
 * L3). It keeps the server's tabs and panels ({@link DemoStageView}) and makes them work in place:
 *
 *   - Tabs: every tab is its own tab stop until the host hydrates (with no JavaScript the arrows
 *     do nothing, so all four must be reachable); then a click, Enter or Space opens a tab without
 *     leaving the page and writes `?demo=` with `history.replaceState` (no scroll jump), and arrows
 *     and Home / End move the roving focus. Below --bp-md the open tab is scrolled into the strip's
 *     view whenever it changes, a `?demo=` deep link included. A
 *     same-page "see it work" link anywhere on the page (`/?demo=board#demo`, the hero's "Try it
 *     yourself") opens its tab here and scrolls the stage into view instead of reloading.
 *   - Loading: once the stage nears the viewport (an IntersectionObserver), it imports ONLY the
 *     open tab's demo module, and each further tab's when it is opened; until a module arrives the
 *     tab's poster stays, in the same reserved box.
 *   - Props: the server's fee, either reduced-motion channel read live (`motionAllowed`, both the OS
 *     setting and `data-motion="reduced"`, watched), the "Start again" count, and `announce`, which
 *     speaks through the stage's one polite live region.
 *
 * It carries the stylesheets the stage and the board poster need: a stylesheet imported by a server
 * component never reaches the page.
 */
export default function DemoHost(
	{ initial, feeBp, features = false, children, paymentsPoster, bookingPoster, splitsPoster }:
		DemoHostProps,
): JSX.Element {
	const active = useSignal<DemoId>(initial);
	const hydrated = useSignal(false);
	const near = useSignal(false);
	const modules = useSignal<Partial<Record<DemoId, DemoComponent>>>({});
	const reduced = useSignal(false);
	const resets = useSignal(0);
	const said = useSignal<DemoAnnouncement>({ key: 0, text: "" });
	const root = useRef<HTMLDivElement>(null);
	const tabs = useRef<Array<HTMLAnchorElement | null>>([]);
	const loading = useRef(new Set<DemoId>());

	const announce = (text: string) => {
		said.value = { key: said.peek().key + 1, text };
	};

	const select = (id: DemoId) => {
		if (active.peek() !== id) active.value = id;
		try {
			history.replaceState(history.state, "", urlWithDemo(location.href, id));
		} catch {
			// A sandboxed frame can refuse history writes; the tab still opens.
		}
	};

	const load = (id: DemoId) => {
		if (modules.peek()[id] || loading.current.has(id)) return;
		loading.current.add(id);
		DEMOS[id]()
			.then((module) => {
				modules.value = { ...modules.peek(), [id]: module.default };
			})
			.catch(() => {
				// The poster stays; opening the tab again tries once more.
			})
			.finally(() => loading.current.delete(id));
	};

	// Hydrated: the tablist becomes a roving tab stop, and its strip follows the open tab.
	useEffect(() => {
		hydrated.value = true;
		const strip = tabs.current[0]?.parentElement;
		if (!strip) return;
		const sync = () => markStripEnd(strip);
		strip.addEventListener("scroll", sync, { passive: true });
		const stop = effect(() => {
			const tab = tabs.current[DEMO_IDS.indexOf(active.value)];
			requestAnimationFrame(() => {
				revealTab(tab);
				sync();
			});
		});
		return () => {
			strip.removeEventListener("scroll", sync);
			stop();
		};
	}, []);

	// Either reduced-motion channel, read live.
	useEffect(() => {
		const query = globalThis.matchMedia(REDUCED_QUERY);
		const sync = () => (reduced.value = !motionAllowed());
		sync();
		query.addEventListener("change", sync);
		const observer = new MutationObserver(sync);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-motion"],
		});
		return () => {
			query.removeEventListener("change", sync);
			observer.disconnect();
		};
	}, []);

	// Near the viewport: from then on the open tab's demo loads.
	useEffect(() => {
		const stop = effect(() => {
			if (near.value) load(active.value);
		});
		const stage = root.current;
		if (!stage || typeof IntersectionObserver !== "function") {
			near.value = true;
			return stop;
		}
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			near.value = true;
			observer.disconnect();
		}, { rootMargin: NEAR_MARGIN });
		observer.observe(stage);
		return () => {
			observer.disconnect();
			stop();
		};
	}, []);

	// Same-page "see it work" links open their tab here.
	useEffect(() => {
		const onClick = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
			if (!(anchor instanceof HTMLAnchorElement) || anchor.target) return;
			if (anchor.closest('[role="tablist"]')) return;
			const id = samePageDemoLink(anchor.getAttribute("href") ?? "", location.pathname);
			if (!id) return;
			event.preventDefault();
			select(id);
			document.getElementById(DEMO_SECTION_ID)?.scrollIntoView({
				behavior: motionAllowed() ? "smooth" : "auto",
				block: "start",
			});
			tabs.current[DEMO_IDS.indexOf(id)]?.focus({ preventScroll: true });
		};
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, []);

	const Demo = near.value ? modules.value[active.value] : undefined;
	return (
		<DemoStageView
			rootRef={root}
			active={active.value}
			feeBp={feeBp}
			features={features}
			roving={hydrated.value}
			posters={{
				board: children,
				payments: paymentsPoster,
				booking: bookingPoster,
				splits: splitsPoster,
			}}
			announcement={said.value}
			live={Demo
				? (
					<Demo
						key={active.value}
						feeBp={feeBp}
						reducedMotion={reduced.value}
						resetSignal={resets.value}
						announce={announce}
					/>
				)
				: null}
			onReset={() => (resets.value += 1)}
			onTabClick={(id, event) => {
				event.preventDefault();
				select(id);
			}}
			onTabKeyDown={(index, event) => {
				const target = tabFocusTarget(event.key, index, DEMO_IDS.length);
				if (target !== null) {
					event.preventDefault();
					tabs.current[target]?.focus();
					return;
				}
				if (event.key === " " || event.key === "Spacebar") {
					event.preventDefault();
					select(DEMO_IDS[index]);
				}
			}}
			tabRef={(index, element) => {
				tabs.current[index] = element;
			}}
		/>
	);
}
// #endregion
