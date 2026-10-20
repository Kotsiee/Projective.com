/// <reference lib="dom" />
import { DEMO_MODULES } from "../components/demos/demo-modules.ts";
import "../styles/lp-background.css";
import "../styles/lp-features.css";
import "../styles/lp-feature-dialog.css";
import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { useIsMobile } from "@ui/hooks/useMediaQuery.ts";
import type { DemoComponent, DemoId } from "../core/demos/demo-contract.ts";
import { FEATURE_CHAPTERS, FEATURES_COPY } from "../core/features-catalogue.ts";
import {
	chapterAt,
	entryFor,
	FEATURE_DIALOG_INTRO_ID,
	type FeatureDemoEntry,
	isPlainPress,
	isSpaceKey,
	NAV_CHAPTER_ATTR,
	needsScroll,
	openDemo,
	readingLine,
	SECTION_TARGET_ATTR,
	shouldLandOnSection,
	TRY_DEMO_ATTR,
	TRY_FEATURE_ATTR,
} from "../core/feature-dialog.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";

// #region Triggers
/** Every "Try it" on the page. */
const TRIGGER_SELECTOR = `a[${TRY_DEMO_ATTR}][${TRY_FEATURE_ATTR}]`;

/** The "Try it" an event came from, if any. */
function triggerOf(target: EventTarget | null): HTMLAnchorElement | null {
	const found = target instanceof Element ? target.closest(TRIGGER_SELECTOR) : null;
	return found instanceof HTMLAnchorElement ? found : null;
}

/** How far the pinned chrome reaches down the screen: a chapter's own `scroll-margin-block-start`. */
function pinnedChrome(section: Element): number {
	return Number.parseFloat(getComputedStyle(section).scrollMarginBlockStart) || 0;
}

/**
 * The intro's ref: the app's `Dialog` describes itself by its whole body, and this body holds the
 * demo's every control, so on each mount the intro (the row's line and the stage note) becomes the
 * dialog's description instead. Done here rather than through a `Dialog` prop, which would grow the
 * held app baseline (Decision #302 (F)); the `Dialog` never rewrites the attribute, its own value
 * being constant.
 */
function describeDialogByIntro(intro: HTMLDivElement | null): void {
	intro?.closest('[role="dialog"]')?.setAttribute("aria-describedby", intro.id);
}
// #endregion

// #region Section landing
/**
 * Land on the chapter `?section=` named (the server marked it): on a fresh visit that has not
 * scrolled, scroll to it only when its h2 is out of sight under the pinned chrome — once, instantly,
 * never smoothly hijacking the page — and give its h2 focus, so the next Tab starts there.
 */
function landOnSection(): void {
	const target = document.querySelector<HTMLElement>(`[${SECTION_TARGET_ATTR}]`);
	const heading = target?.querySelector<HTMLElement>("h2");
	if (!target || !heading) return;
	const navigation = performance.getEntriesByType("navigation")[0] as
		| PerformanceNavigationTiming
		| undefined;
	const landing = {
		navigationType: navigation?.type ?? "navigate",
		hash: location.hash,
		scrollY: globalThis.scrollY,
	};
	if (!shouldLandOnSection(landing)) return;
	const pinned = pinnedChrome(target);
	if (needsScroll(heading.getBoundingClientRect(), { height: innerHeight, pinned })) {
		target.scrollIntoView({ block: "start", behavior: "auto" });
	}
	if (document.activeElement === document.body || document.activeElement === null) {
		heading.focus({ preventScroll: true });
	}
}
// #endregion

// #region Chapter marker
/**
 * Keep the chapter navigation's `aria-current="location"` (its stronger ink and teal rule) on the
 * chapter the reader is in: after any scroll, resize or fragment change, the chapter whose section
 * spans the reading line ({@link chapterAt}) is marked and every other link cleared, so a
 * `?section=` landing's marker never stays behind. Until the reader moves, the server's mark stands.
 * Returns the teardown.
 */
function followReader(): () => void {
	const links = [...document.querySelectorAll<HTMLAnchorElement>(`a[${NAV_CHAPTER_ATTR}]`)];
	const sections = FEATURE_CHAPTERS.flatMap((chapter) => {
		const section = document.getElementById(chapter.id);
		return section ? [{ id: chapter.id, section }] : [];
	});
	if (links.length === 0 || sections.length === 0) return () => {};
	let frame = 0;
	const mark = () => {
		frame = 0;
		const line = readingLine({ height: innerHeight, pinned: pinnedChrome(sections[0].section) });
		const here = chapterAt(
			sections.map(({ id, section }) => {
				const box = section.getBoundingClientRect();
				return { id, top: box.top, bottom: box.bottom };
			}),
			line,
		);
		for (const link of links) {
			const isHere = link.getAttribute(NAV_CHAPTER_ATTR) === here;
			if (isHere && link.getAttribute("aria-current") !== "location") {
				link.setAttribute("aria-current", "location");
			} else if (!isHere && link.hasAttribute("aria-current")) {
				link.removeAttribute("aria-current");
			}
		}
	};
	const schedule = () => {
		if (frame === 0) frame = requestAnimationFrame(mark);
	};
	addEventListener("scroll", schedule, { passive: true });
	addEventListener("resize", schedule);
	addEventListener("hashchange", schedule);
	return () => {
		removeEventListener("scroll", schedule);
		removeEventListener("resize", schedule);
		removeEventListener("hashchange", schedule);
		if (frame !== 0) cancelAnimationFrame(frame);
	};
}
// #endregion

// #region Island
/** Props for {@link FeatureDemoDialog}. */
export interface FeatureDemoDialogProps {
	/** The platform fee in basis points from the server, or `null` (every fee clause drops). */
	feeBp: number | null;
	/** The rows with a demo (`featureDemoEntries`): what each "Try it" on the page opens. */
	entries: readonly FeatureDemoEntry[];
}

/**
 * FeatureDemoDialog — `/features`' "Try it" (`flows/LANDING.md` §2.5 note 8, §2.6 note 8; work order
 * L5). The page's rows are server markup: each "Try it" is a link to the landing's demo stage on its
 * demo (`/?demo=board#demo`), so with no JavaScript it still opens the real demo there. Hydrated,
 * this island:
 *
 *   - turns every "Try it" into a button that opens a dialog (`role="button"`,
 *     `aria-haspopup="dialog"`, Space as well as Enter), leaving a modified or middle click its link;
 *   - opens the app's `Dialog` (packages/ui, Decision #171: portal, scrim, focus trap, scroll lock,
 *     Escape, focus back to the "Try it" that opened it), titled with the feature's name and
 *     described by its intro alone — the §4.12 line and the stage note "Example only. No real money
 *     moves." `[P9]` — never by the demo's every control ({@link describeDialogByIntro}). Below them
 *     the demo sits
 *     in the stage's own product viewport, flat in the panel (the panel is the one elevated
 *     surface), then "Start again" and the row's "Learn more". Below `--bp-md` it is a bottom sheet
 *     sized to the demo, up to the screen's height (Decision #302 (D)); from it a centred panel
 *     sized so the demo's reserved ratio fits the screen. Its panel is `lp-portal`, so the landing's
 *     tokens resolve at `<body>`;
 *   - imports ONLY the pressed row's demo, on the press — a plain pointer-down starts the import a
 *     beat early, focus never does — through the demos' one loader (`demo-modules.ts`), which every
 *     press joins, so should the chunk fail, even mid-import, the press falls back to the link's
 *     address (`openDemo`). The demo gets the contract's props (`DemoProps`): the server's fee, either
 *     reduced-motion channel read live, the "Start again" count, and `announce`, which speaks
 *     through the dialog's own polite live region;
 *   - lands on the chapter `?section=` named, once, only if the visitor has not moved
 *     ({@link landOnSection}), and from then on keeps the chapter navigation's marker on the chapter
 *     the reader is in ({@link followReader}).
 *
 * It renders nothing until a "Try it" is pressed. It carries the page's stylesheets — the chapter
 * index's, the stills' (the demo stage's window, the kanban and MoneyView, through
 * `demo-modules.ts`), the head's grid and the dialog's — since a server component's stylesheet
 * reaches no page.
 */
export default function FeatureDemoDialog({ feeBp, entries }: FeatureDemoDialogProps): JSX.Element {
	const open = useSignal(false);
	const current = useSignal<FeatureDemoEntry | null>(null);
	const modules = useSignal<Partial<Record<DemoId, DemoComponent>>>({});
	const reduced = useReducedMotion();
	const resets = useSignal(0);
	const opens = useSignal(0);
	const said = useSignal({ key: 0, text: "" });
	const sheet = useIsMobile();
	const entriesRef = useRef(entries);
	entriesRef.current = entries;

	const announce = (text: string) => {
		said.value = { key: said.peek().key + 1, text };
	};

	const show = (entry: FeatureDemoEntry, trigger: HTMLAnchorElement) => {
		// The trap hands focus back to whatever held it on opening: make that the "Try it" itself,
		// which a pointer press does not focus in every engine.
		trigger.focus({ preventScroll: true });
		said.value = { key: said.peek().key + 1, text: "" };
		resets.value = 0;
		opens.value += 1;
		current.value = entry;
		open.value = true;
		void openDemo(entry, {
			load: DEMO_MODULES.load,
			arrived: (module) => {
				if (!modules.peek()[entry.demo]) {
					modules.value = { ...modules.peek(), [entry.demo]: module.default };
				}
			},
			stillShowing: () => open.peek() && current.peek()?.feature === entry.feature,
			fallbackHref: trigger.href,
			navigate: (href) => location.assign(href),
		});
	};

	// Every "Try it" becomes a button that opens the dialog; a modified click keeps its link.
	useEffect(() => {
		const triggers = [...document.querySelectorAll<HTMLAnchorElement>(TRIGGER_SELECTOR)];
		for (const trigger of triggers) {
			trigger.setAttribute("role", "button");
			trigger.setAttribute("aria-haspopup", "dialog");
		}
		const entryOf = (trigger: HTMLAnchorElement) =>
			entryFor(entriesRef.current, trigger.getAttribute(TRY_FEATURE_ATTR));
		const onClick = (event: MouseEvent) => {
			if (!isPlainPress(event)) return;
			const trigger = triggerOf(event.target);
			const entry = trigger ? entryOf(trigger) : null;
			if (!trigger || !entry) return;
			event.preventDefault();
			show(entry, trigger);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isSpaceKey(event.key) || event.defaultPrevented) return;
			const trigger = triggerOf(event.target);
			const entry = trigger ? entryOf(trigger) : null;
			if (!trigger || !entry) return;
			event.preventDefault();
			show(entry, trigger);
		};
		// The press's own pointer-down: the import starts a beat before the click lands, and the
		// click joins it.
		const onPointerDown = (event: PointerEvent) => {
			if (!isPlainPress(event)) return;
			const trigger = triggerOf(event.target);
			const entry = trigger ? entryOf(trigger) : null;
			if (entry) DEMO_MODULES.load(entry.demo).catch(() => {});
		};
		document.addEventListener("click", onClick);
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown, { passive: true });
		return () => {
			document.removeEventListener("click", onClick);
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown);
			for (const trigger of triggers) {
				trigger.removeAttribute("role");
				trigger.removeAttribute("aria-haspopup");
			}
		};
	}, []);

	// The chapter `?section=` named, once; then the marker follows the reader.
	useEffect(() => {
		landOnSection();
		return followReader();
	}, []);

	const entry = current.value;
	const Demo = entry ? modules.value[entry.demo] : undefined;
	return (
		<Dialog
			visible={open}
			header={entry?.title ?? ""}
			position={sheet ? "bottom" : "center"}
			class="lp-portal lp-fdemo"
		>
			{entry
				? (
					<div class="lp-fdemo__body">
						<div
							id={FEATURE_DIALOG_INTRO_ID}
							ref={describeDialogByIntro}
							class="lp-fdemo__intro"
						>
							<p class="lp-fdemo__desc">{entry.description}</p>
							<p class="lp-fdemo__note">{FEATURES_COPY.stageNote}</p>
						</div>
						<div class="lp-demo__window lp-fdemo__window">
							<div
								class="lp-demo__viewport"
								data-state={Demo ? "live" : "loading"}
								aria-busy={Demo ? undefined : "true"}
							>
								<div class="lp-demo__screen">
									{Demo
										? (
											<Demo
												key={`${entry.feature}-${opens.value}`}
												feeBp={feeBp}
												reducedMotion={reduced.value}
												resetSignal={resets.value}
												announce={announce}
											/>
										)
										: null}
								</div>
							</div>
						</div>
						<div class="lp-fdemo__foot">
							<button
								type="button"
								class="lp-demo-btn lp-fdemo__reset"
								data-ready={Demo ? "true" : "false"}
								disabled={!Demo}
								onClick={() => (resets.value += 1)}
							>
								{FEATURES_COPY.reset}
							</button>
							{entry.helpHref
								? (
									<a class="lp-section__link lp-fdemo__more" href={entry.helpHref}>
										{FEATURES_COPY.learnMore}
										<span class="ui-visually-hidden">: {entry.title}</span>
									</a>
								)
								: null}
						</div>
						<div class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
							{said.value.text ? <span key={said.value.key}>{said.value.text}</span> : null}
						</div>
					</div>
				)
				: null}
		</Dialog>
	);
}
// #endregion
