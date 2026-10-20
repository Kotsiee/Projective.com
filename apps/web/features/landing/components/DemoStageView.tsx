import type { ComponentChildren, JSX, Ref } from "preact";
import type { DemoId } from "@features/landing/core/demos/demo-contract.ts";
import {
	DEMO_IDS,
	DEMO_STAGE_COPY,
	DEMO_TABS,
	demoDescription,
	demoDomIds,
	demoHref,
} from "@features/landing/core/demo-stage.ts";

// #region Header
/** The stage heading's id: the section is labelled by its one h2. */
export const DEMO_TITLE_ID = "demo-title";

/**
 * DemoStageHeader — the stage's static head (`flows/LANDING.md` §4.4): the section header "See it
 * work", the h2, the always-visible stage note "Example only. No real money moves." `[P9]` and
 * the role note. Static content on the canvas, never boxed.
 */
export function DemoStageHeader(): JSX.Element {
	return (
		<header class="lp-demo__head">
			<p class="lp-eyebrow">{DEMO_STAGE_COPY.eyebrow}</p>
			<h2 id={DEMO_TITLE_ID} class="lp-display lp-display--section lp-demo__title">
				{DEMO_STAGE_COPY.title}
			</h2>
			<div class="lp-demo__notes">
				<p class="lp-lead lp-demo__note">{DEMO_STAGE_COPY.note}</p>
				<p class="lp-meta lp-demo__role">{DEMO_STAGE_COPY.role}</p>
			</div>
		</header>
	);
}
// #endregion

// #region Stage
/** What the host's polite live region says: each new key re-reads the same words. */
export interface DemoAnnouncement {
	key: number;
	text: string;
}

/** Props for {@link DemoStageView}. */
export interface DemoStageViewProps {
	/** The open tab. */
	active: DemoId;
	/** The platform fee in basis points from the server, or `null` (every fee clause drops). */
	feeBp: number | null;
	/**
	 * Render "See everything Projective does" → `/features` beside the tabs (work order L5; `/` turns
	 * it on). Off, the bar holds the tabs alone.
	 */
	features: boolean;
	/** The open tab's live demo, or `null` while its poster shows. */
	live: ComponentChildren | null;
	/**
	 * Each tab's poster: the server-rendered still of its demo's opening picture (the Work board's
	 * real kanban, the others' own parts), shown until that tab's demo is live.
	 */
	posters: Readonly<Record<DemoId, ComponentChildren>>;
	/**
	 * The host has hydrated, so the tablist is a roving tab stop (the open tab 0, the rest -1, the
	 * arrows moving focus). Before that — and with no JavaScript, when the arrows do nothing — every
	 * tab is an ordinary link and its own tab stop, so all four examples stay reachable.
	 */
	roving?: boolean;
	announcement: DemoAnnouncement;
	/** "Start again": shown only while a demo is live, so it always has something to reset. */
	onReset?: () => void;
	onTabClick?: (id: DemoId, event: MouseEvent) => void;
	onTabKeyDown?: (index: number, event: KeyboardEvent) => void;
	/** Receives each tab's element, for the roving focus. */
	tabRef?: (index: number, element: HTMLAnchorElement | null) => void;
	rootRef?: Ref<HTMLDivElement>;
}

/**
 * DemoStageView — the demo stage's tabs and panels (`flows/LANDING.md` §2.1 notes 10–13, §4.4), as
 * the server renders them and the DemoHost island keeps them.
 *
 * A tablist ("Work board · Payment protection · Booking · Team pay") of links that each open their
 * tab with no JavaScript (`/?demo=…#demo`, which the thin controller renders) — each its own tab
 * stop until the host hydrates; the host then turns them into tabs that open in place — a roving tab
 * stop on the open tab ({@link DemoStageViewProps.roving}), arrows and Home / End moving focus,
 * Enter or Space opening (manual activation, so arrowing never loads a demo). One panel per tab, the
 * closed ones `hidden`, each holding the window — its viewport's ratio reserved, showing the tab's
 * poster (a server-rendered still of the demo) above its crawlable description until the demo is
 * live, then the demo with the description kept as the panel's description, out of sight — and
 * under it the caption and "Start again". The polite live region is the host's.
 */
export function DemoStageView(props: DemoStageViewProps): JSX.Element {
	const { active, feeBp, live } = props;
	return (
		<div class="lp-demo__stage" ref={props.rootRef}>
			<div class="lp-demo__bar">
				<div class="lp-demo__tabs" role="tablist" aria-label={DEMO_STAGE_COPY.tablist}>
					{DEMO_IDS.map((id, index) => {
						const ids = demoDomIds(id);
						const selected = id === active;
						return (
							<a
								key={id}
								ref={(element) => props.tabRef?.(index, element)}
								class="lp-tab"
								role="tab"
								id={ids.tab}
								href={demoHref(id)}
								aria-controls={ids.panel}
								aria-selected={selected ? "true" : "false"}
								tabIndex={props.roving ? (selected ? 0 : -1) : undefined}
								onClick={props.onTabClick ? (event) => props.onTabClick?.(id, event) : undefined}
								onKeyDown={props.onTabKeyDown
									? (event) => props.onTabKeyDown?.(index, event)
									: undefined}
							>
								{DEMO_TABS[id].label}
							</a>
						);
					})}
				</div>
				{props.features
					? (
						<a class="lp-demo__more" href={DEMO_STAGE_COPY.moreHref}>
							{DEMO_STAGE_COPY.more}
							<span aria-hidden="true">→</span>
						</a>
					)
					: null}
			</div>
			{DEMO_IDS.map((id) => {
				const ids = demoDomIds(id);
				const open = id === active;
				const isLive = open && live !== null;
				return (
					<div
						key={id}
						class="lp-demo__panel"
						role="tabpanel"
						id={ids.panel}
						aria-labelledby={ids.tab}
						aria-describedby={ids.desc}
						tabIndex={isLive ? undefined : 0}
						hidden={!open}
					>
						<div class="lp-demo__window">
							<div class="lp-demo__viewport" data-state={isLive ? "live" : "poster"}>
								<div class="lp-demo__screen">
									{isLive ? live : props.posters[id]}
								</div>
								<p
									id={ids.desc}
									class={isLive ? "lp-demo__desc lp-demo__desc--quiet" : "lp-demo__desc"}
								>
									{demoDescription(id, feeBp)}
								</p>
							</div>
						</div>
						<div class="lp-demo__foot">
							<p class="lp-demo__caption">{DEMO_TABS[id].caption}</p>
							<button
								type="button"
								class="lp-demo-btn lp-demo__reset"
								data-ready={isLive && props.onReset ? "true" : "false"}
								disabled={!(isLive && props.onReset)}
								onClick={props.onReset}
							>
								{DEMO_STAGE_COPY.reset}
							</button>
						</div>
					</div>
				);
			})}
			<div class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
				{props.announcement.text
					? <span key={props.announcement.key}>{props.announcement.text}</span>
					: null}
			</div>
		</div>
	);
}
// #endregion
