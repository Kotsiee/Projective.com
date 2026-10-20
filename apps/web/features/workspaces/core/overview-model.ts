import {
	type ActivityEntry,
	type BusinessMoneyTile,
	canOpenFinance,
	type SetupStep,
	type SetupStepId,
	walletHrefFor,
	type WorkspaceDetail,
	workspaceHref,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { walletIntentHref } from "@features/wallet/core/wallet-intent.ts";
import {
	type AttentionItem,
	attentionItems,
	type CashFlowSource,
	cashFlowSource,
	type DeckTile,
	type OverviewRegion,
	overviewRegions,
	telemetryDeck,
} from "./overview-deck.ts";

/**
 * overview-model — every rule the console's Overview composes, as pure functions over the server's
 * {@link WorkspaceDetail}: the setup hero and its ONE filled control, which zones render, a business's
 * money, the projects preview and the activity rows — and the Finance module's balance line, which
 * reads the same tiles. The command-center regions (Decision #306: the telemetry deck, needs
 * attention, the cash-flow source and the region layout) are `overview-deck.ts`, composed here.
 *
 * The island only paints what this returns, so the rules the Overview is judged by — exactly one filled
 * control whatever the setup state, no action a viewer cannot perform, no money for a viewer the read
 * answered none to — are unit-tested here (`overview-model.test.ts`) rather than read off a screenshot.
 * Nothing here guesses a fact: a step's `done` and `actionable`, a payout block and an allowance are
 * the server's answers (`packages/backend/services/workspace/mappers.ts`), and an absent one renders as
 * absent. CSS-free and DOM-free, so `deno test` loads it directly.
 */

// #region Setup hero
/** What a step's control does: open the invite modal, publish the entity, or go to the step's page. */
export type HeroActionKind = "invite" | "publish" | "link";

/**
 * The Button Interaction Matrix tier a step's control takes (DESIGN_SYSTEM §B.8.1): 1 — the amber
 * accent (a business's Add money, the act that starts a financial flow); 2 — the monochrome
 * structural fill (Invite member); 3 — the primary (Publish, or the next step's page); 4 — the
 * neutral outlined utility (every other step the viewer may act on). Publish is a commit, never a
 * utility: a business's Publish offered beside earlier open steps keeps tier 3's primary severity,
 * `outlined` and unfilled (the weight table's real-alternative row, Decision #248).
 */
export type HeroTier = 1 | 2 | 3 | 4;

/** One step's control. */
export interface HeroAction {
	kind: HeroActionKind;
	tier: HeroTier;
	/**
	 * Whether this is the band's ONE filled control. Every fill is tier 1 to 3; the only unfilled
	 * tier 3 is a business's Publish beside earlier open steps.
	 */
	filled: boolean;
	label: string;
	/** The page a `link` goes to; `""` for an in-place action. */
	href: string;
}

/** One step as the hero draws it. */
export interface HeroStep {
	id: SetupStepId;
	label: string;
	/** "Done" for a finished step, else what doing it gets them (the server's note). */
	note: string;
	done: boolean;
	/** The first unfinished step — where the entity is, whoever is looking. */
	current: boolean;
	/** `null` when the step is done or the viewer may not act on it: no dead control. */
	action: HeroAction | null;
}

/** The setup hero. */
export interface SetupHeroModel {
	/** "Get Northloop ready". */
	title: string;
	done: number;
	total: number;
	/** Completion, 0–100, for the ring. */
	percent: number;
	/** "3 of 5 done" — the ring's fact in words, so the sweep is never its only channel. */
	progress: string;
	steps: HeroStep[];
}

/** The step's in-place action, if it has one; anything else is a page to go to. */
function actionKind(id: SetupStepId): HeroActionKind {
	if (id === "invite") return "invite";
	if (id === "publish") return "publish";
	return "link";
}

/**
 * The words on a step's control, where they differ from the step's own label. The label says what the
 * step IS ("Complete the public profile") and sits right above its control, in a column a fifth of
 * the band wide, so the control names the act in a word or two instead of repeating it: a small
 * Button has a fixed height, and a label that wraps inside it spills past its border. A step not
 * listed keeps its own label, which is already that short ("Set the split", "Add money", "Publish").
 */
export const HERO_ACTION_LABEL: Readonly<
	Record<WorkspaceKind, Readonly<Partial<Record<SetupStepId, string>>>>
> = {
	team: { invite: "Invite member", profile: "Edit profile", verification: "Verify identity" },
	business: { invite: "Invite member", verification: "Verify business", money: "Set rules" },
};

/**
 * The tier of the band's ONE fill on a step: the structural Invite member is tier 2; a business's Add
 * money is tier 1 — the amber that starts a financial flow (the wallet's top-up, §B.8.1); anything
 * else (Publish, or the step's page) the tier-3 primary.
 */
function primaryTier(id: SetupStepId): HeroTier {
	if (id === "invite") return 2;
	if (id === "fund") return 1;
	return 3;
}

/**
 * A step's control.
 *
 * The first unfinished step the viewer may act on carries the band's one fill
 * ({@link primaryTier}). Every other step they may act on gets a tier-4 utility — except Publish, a
 * one-way commit. A TEAM's is offered only as the step at hand, never beside the steps that come
 * before it ({@link setupHero} never makes it primary before then). A business's is not held behind
 * its other steps (Decision #248): offered beside them it stays a tier-3 primary, `outlined` and
 * unfilled, so the commit never reads as a utility and the band never holds a second fill. A step
 * whose page is unknown (`href: ""`) offers nothing. Its words are {@link HERO_ACTION_LABEL}'s.
 */
function actionFor(step: SetupStep, primary: boolean, entity: WorkspaceKind): HeroAction | null {
	if (step.done || !step.actionable) return null;
	const kind = actionKind(step.id);
	if (kind === "link" && !step.href) return null;
	const label = HERO_ACTION_LABEL[entity][step.id] ?? step.label;
	const href = kind === "link" ? step.href : "";
	if (primary) return { kind, tier: primaryTier(step.id), filled: true, label, href };
	if (kind === "publish") {
		return entity === "team" ? null : { kind, tier: 3, filled: false, label, href };
	}
	return { kind, tier: 4, filled: false, label, href };
}

/**
 * The setup hero, or `null` when it has nothing to show: every step done (a team's last step is
 * Publish, so a draft team always has one open), no steps, or the viewer dismissed it.
 */
export function setupHero(
	input: { kind: WorkspaceKind; name: string; steps: readonly SetupStep[]; dismissed: boolean },
): SetupHeroModel | null {
	const { kind, steps } = input;
	if (input.dismissed || steps.length === 0 || steps.every((s) => s.done)) return null;
	const current = steps.findIndex((s) => !s.done);
	// The first unfinished step the viewer can actually act on (done, unactionable and page-less
	// steps all answer `null`). A team's Publish qualifies only as the CURRENT step: a viewer who may
	// publish but not invite, split or edit the profile is never handed the one-way commit while the
	// steps before it are still open — the band then simply carries no fill for them. A business's
	// Publish qualifies whenever the viewer may publish (Decision #248): its earlier steps (KYB, money,
	// spending rules) can wait on a reviewer, a processor or a plan, and the hero is where a draft
	// business is published.
	const primary = steps.findIndex((s, i) =>
		(s.id !== "publish" || kind === "business" || i === current) &&
		actionFor(s, true, kind) !== null
	);
	const done = steps.filter((s) => s.done).length;
	return {
		title: `Get ${input.name} ready`,
		done,
		total: steps.length,
		percent: Math.round((done / steps.length) * 100),
		progress: `${done} of ${steps.length} done`,
		steps: steps.map((step, i) => ({
			id: step.id,
			label: step.label,
			note: step.done ? "Done" : step.note,
			done: step.done,
			current: i === current,
			action: actionFor(step, i === primary, kind),
		})),
	};
}

/**
 * The steps the hero may act on for an entity in `status`. Publishing is a draft's commit: leaving
 * `archived` is a restore, which `org.set_workspace_status` holds to `archive_entity` and lands where
 * it decides — a never-published entity's `active` is refused (`restore_target`). So on an entity that
 * is not a draft the Publish step offers nothing, whatever its `done` says, and an archived entity
 * goes back through Settings' Restore. Every other step is the server's answer unchanged.
 */
export function heroSteps(
	detail: Pick<WorkspaceDetail, "status" | "setup">,
): readonly SetupStep[] {
	if (detail.status === "draft") return detail.setup;
	return detail.setup.map((s) => s.id === "publish" ? { ...s, actionable: false } : s);
}

/** Whether the hero is showing `id` as an unfinished step. */
function heroHasOpen(hero: SetupHeroModel | null, id: SetupStepId): boolean {
	return !!hero?.steps.some((s) => s.id === id && !s.done);
}
// #endregion

// #region Money and counts
/**
 * How many projects are live: a team's distinct projects among its live engagements (B7 — assignments
 * not handed back, on an active or on-hold project); a business's commissioned projects in delivery.
 */
export function liveProjectCount(detail: WorkspaceDetail): number {
	if (detail.kind === "team") return new Set(detail.engagements.map((e) => e.projectSlug)).size;
	return detail.projects.filter((p) => p.state === "active").length;
}

/** A business's money band: BB9's tiles and the hand-off to its pooled wallet. */
export interface BusinessMoneyBand {
	/** One per wallet currency, the business's default currency first (`WorkspaceDetail.moneyTiles`). */
	tiles: BusinessMoneyTile[];
	/** The business wallet, VIEWED (`/wallet?w=business:<id>`) — never a switch of who acts. */
	walletHref: string;
}

/**
 * A business's money band — per wallet currency its Available, Committed, Awaiting-approval and
 * Spent-in-30-days figures (BB9's `moneyTiles`), and the hand-off to its pooled wallet — exactly when
 * the viewer may open the Finance module ({@link canOpenFinance}: `contribute_funds`, `spend_funds` or
 * `manage_finances` — BUSINESSES_AUDIT BD18), the same predicate the read answers the tiles on, so the
 * band and the module never disagree about one viewer. A team never has one: its money is the vault
 * tile.
 *
 * The band's predicate is also the hand-off's: the wallet opens a business's `?w=business:<id>` view
 * for every member of it (`resolveWalletContext` — membership alone is `view`), and every viewer the
 * band renders for is one, so a band always carries its link and there is no second gate to pass
 * (BD19, Decision #248).
 */
export function businessMoney(detail: WorkspaceDetail): BusinessMoneyBand | null {
	if (detail.kind !== "business") return null;
	if (!canOpenFinance("business", detail.viewerCapabilities)) return null;
	return {
		tiles: detail.moneyTiles,
		walletHref: walletHrefFor("business", detail.id),
	};
}

/** One fact on the Finance module's balance line. */
export interface WalletBalanceFact {
	key: string;
	/**
	 * The figure — the server's `display`, in the tile's OWN currency (never converted, so it reads
	 * as the Overview band's pinned tile does) — or `null` for the empty-wallet fact.
	 */
	figure: string | null;
	/** The words after the figure ("available"), or the whole fact when there is no figure. */
	text: string;
}

/**
 * The Finance module's balance line — one fact per wallet currency ("US$2,500.00 available"), from the
 * same BB9 tiles as the Overview's band, or that the wallet holds nothing yet. Every figure is the
 * server's `MoneyView.display` in its own currency: nothing here formats, converts or totals money.
 */
export function walletBalanceFacts(tiles: readonly BusinessMoneyTile[]): WalletBalanceFact[] {
	if (tiles.length === 0) {
		return [{ key: "empty", figure: null, text: "Nothing in the wallet yet" }];
	}
	return tiles.map((tile) => ({
		key: tile.currency,
		figure: tile.available.display,
		text: "available",
	}));
}
// #endregion

// #region Projects preview
/** One live engagement (team) or commissioned project (business) in the preview. */
export interface PreviewRow {
	key: string;
	/** `/projects/prj-…` — slugs only (Decision #88). */
	href: string;
	title: string;
	/** Middot facts: counterparty, stage, state, date. */
	meta: string[];
	/** Completion 0–1 for the ProgressBar, or `null` when the read carries none. */
	progress: number | null;
}

/** How many rows the Overview previews before "See all". */
export const PREVIEW_LIMIT = 3;

/**
 * The first live engagements: a team's from B7's `engagements` (one row per stage it works, with the
 * project's counterparty and completion joined from `projects` by slug); a business's in-delivery
 * commissions from `projects`.
 */
export function projectPreview(detail: WorkspaceDetail, limit = PREVIEW_LIMIT): PreviewRow[] {
	if (detail.kind === "team") {
		return detail.engagements.slice(0, limit).map((e) => {
			const project = detail.projects.find((p) => p.id === e.projectSlug);
			return {
				key: `${e.projectSlug}/${e.stageSlug}`,
				href: `/projects/${e.projectSlug}`,
				title: e.title,
				meta: [
					project?.counterparty ?? "",
					e.stageTitle,
					e.projectStatus === "on_hold" ? "On hold" : "",
				].filter(Boolean),
				progress: project ? project.progress : null,
			};
		});
	}
	return detail.projects.filter((p) => p.state === "active").slice(0, limit).map((p) => ({
		key: p.id,
		href: p.href,
		title: p.title,
		meta: [p.counterparty, p.statusLabel, p.due ?? ""].filter(Boolean),
		progress: p.progress,
	}));
}
// #endregion

// #region Activity
/** The console module an activity kind belongs to — the second fact on its meta line. */
const ACTIVITY_MODULE: Readonly<Record<ActivityEntry["kind"], string>> = {
	member: "Members",
	project: "Projects",
	money: "Finance",
	role: "Roles",
	listing: "Catalogue",
	system: "Settings",
};

/** One activity row. */
export interface ActivityRow {
	id: string;
	kind: ActivityEntry["kind"];
	text: string;
	actor: string | null;
	avatar: string | null;
	href: string | null;
	/** [relative time, module]. */
	meta: string[];
}

/** How many events the Overview shows. */
export const ACTIVITY_LIMIT = 8;

/** The newest events, each as avatar · sentence · [when, module]. */
export function activityRows(
	entries: readonly ActivityEntry[],
	limit = ACTIVITY_LIMIT,
): ActivityRow[] {
	return entries.slice(0, limit).map((entry) => ({
		id: entry.id,
		kind: entry.kind,
		text: entry.text,
		actor: entry.actor,
		avatar: entry.actorAvatar,
		href: entry.href,
		meta: [entry.at, ACTIVITY_MODULE[entry.kind]].filter(Boolean),
	}));
}
// #endregion

// #region Composition
/** The two-member rule, stated only where the hero is not already stating it. */
export interface ProposeNotice {
	/** Whether the notice may offer Invite member (the viewer holds `invite_members`). */
	canInvite: boolean;
}

/**
 * A draft business's `business_not_active` fact, stated only where the hero's Publish step is not
 * already saying it (Decision #248).
 */
export interface DraftNotice {
	/** Whether the notice may offer Publish (the viewer holds `manage_settings`). */
	canPublish: boolean;
}

/** Everything the Overview renders, top to bottom. */
export interface OverviewModel {
	hero: SetupHeroModel | null;
	/** The verification lock while unverified — only when the hero is not already showing the step. */
	lock: boolean;
	/** "Teams need two members to send proposals" — only for a team that cannot, off the hero. */
	propose: ProposeNotice | null;
	/** "{Business} isn't active…" — only for a draft business whose hero is not showing Publish. */
	draft: DraftNotice | null;
	/**
	 * The notices the hero is carrying right now — what {@link lock}, {@link propose} and
	 * {@link draft} become once it is dismissed. The island draws them beside the hero, hidden until
	 * the stack carries the dismissal mark (set by the pre-paint guard, {@link heroDismissGuard}, and by
	 * the island itself), so a viewer who dismissed the hero earlier sees them in place from first
	 * paint instead of popping in once the island has read their choice.
	 */
	standIn: { lock: boolean; propose: ProposeNotice | null; draft: DraftNotice | null };
	/** The telemetry deck ({@link telemetryDeck}) — only tiles the read has a source for. */
	deck: DeckTile[];
	/** A business's money ({@link businessMoney}) — the deck's wallet tiles; `null` for a team or a viewer who cannot open Finance. */
	money: BusinessMoneyBand | null;
	/** What is waiting on somebody here ({@link attentionItems}). */
	attention: AttentionItem[];
	/** Where the 30-day cash flow is read from, or `null` for a viewer who may not see the money. */
	cashFlow: CashFlowSource | null;
	/** The regions under the deck, in reading order ({@link overviewRegions}). */
	regions: OverviewRegion[];
	projects: PreviewRow[];
	/** The Projects module, for "See all". */
	projectsHref: string;
	activity: ActivityRow[];
}

/**
 * The notices beside a hero (or none): the verification lock, the two-member rule and a draft
 * business's not-active fact — each only where the hero is not showing its step.
 */
function notices(
	detail: WorkspaceDetail,
	hero: SetupHeroModel | null,
): Pick<OverviewModel, "lock" | "propose" | "draft"> {
	return {
		lock: detail.verification !== "verified" && !heroHasOpen(hero, "verification"),
		propose: detail.kind === "team" && !detail.canPropose && !heroHasOpen(hero, "invite")
			? { canInvite: detail.viewerCapabilities.includes("invite_members") }
			: null,
		draft: detail.kind === "business" && detail.status === "draft" && !heroHasOpen(hero, "publish")
			? { canPublish: detail.viewerCapabilities.includes("manage_settings") }
			: null,
	};
}

/**
 * Where a business's Add money step goes: its pooled wallet with the top-up already open, returning to
 * this Overview when done (the wallet intent, Decision #243; the way back allowlisted by #248).
 */
export function addMoneyHrefFor(businessId: string, handle: string): string {
	return walletIntentHref(`business:${businessId}`, "top_up", workspaceHref("business", handle));
}

/**
 * The steps' pages as the hero draws them: the server's, with a business's Add money pointed at the
 * wallet's top-up intent rather than the bare wallet the read addresses it to.
 */
function heroStepLinks(detail: WorkspaceDetail): SetupStep[] {
	if (detail.kind !== "business") return detail.setup;
	return detail.setup.map((step) =>
		step.id === "fund" && step.href
			? { ...step, href: addMoneyHrefFor(detail.id, detail.handle) }
			: step
	);
}

/**
 * The Overview for one viewer. `dismissed` is their remembered choice to hide the hero; the notices
 * the hero was carrying (the two-member rule, the verification lock, a draft business's not-active
 * fact) come back once it is gone, so hiding the steps never hides the facts.
 *
 * An archived business draws no hero: it is not being set up, nothing it holds can be spent until it
 * is restored, and its steps would hand a member Add money into a wallet that cannot pay out
 * (Decision #248).
 */
export function overviewModel(
	detail: WorkspaceDetail,
	opts: { dismissed: boolean },
): OverviewModel {
	const archivedBusiness = detail.kind === "business" && detail.status === "archived";
	const hero = archivedBusiness ? null : setupHero({
		kind: detail.kind,
		name: detail.name,
		steps: heroSteps({ status: detail.status, setup: heroStepLinks(detail) }),
		dismissed: opts.dismissed,
	});
	const shown = notices(detail, hero);
	const away = hero ? notices(detail, null) : shown;
	const money = businessMoney(detail);
	const cashFlow = cashFlowSource(detail);
	return {
		hero,
		lock: shown.lock,
		propose: shown.propose,
		draft: shown.draft,
		standIn: {
			lock: away.lock && !shown.lock,
			propose: shown.propose ? null : away.propose,
			draft: shown.draft ? null : away.draft,
		},
		deck: telemetryDeck(detail, money),
		money,
		attention: attentionItems(detail),
		cashFlow,
		regions: overviewRegions(cashFlow !== null),
		projects: projectPreview(detail),
		projectsHref: workspaceHref(detail.kind, detail.handle, "projects"),
		activity: activityRows(detail.activity),
	};
}

/**
 * How many FILLED controls the Overview renders: the hero's one, or — only while no hero is showing
 * Publish — a draft business's notice's tier-3 Publish for a viewer who may publish. Everything else
 * is quieter: the other notices act through a link-weight control, the deck carries no control, the
 * attention items, projects and activity rows are links, the cash flow's wallet hand-off is a link
 * and its Try again a tier-4 utility, "See all" is tier 5 and the dismiss is an icon-only text
 * button. Held to at most one.
 */
export function filledControls(model: OverviewModel): number {
	const hero = model.hero?.steps.filter((s) => s.action?.filled).length ?? 0;
	return hero + (model.draft?.canPublish ? 1 : 0);
}
// #endregion

// #region Dismissal
/**
 * The localStorage key the hero's dismissal is remembered under — per entity AND per viewer (their
 * member id), so one person waving it off on a shared browser does not hide it from another.
 */
export function heroDismissKey(
	detail: Pick<WorkspaceDetail, "kind" | "id" | "viewerMemberId">,
): string {
	return `pj.wsp.setup-hero.dismissed:${detail.kind}:${detail.id}:${detail.viewerMemberId}`;
}

/**
 * The pre-paint guard for a remembered dismissal: an inline script the island renders just inside the
 * stack, ahead of the hero band. On a server-rendered page it runs before the band is parsed, so a
 * viewer who hid the hero never sees it painted and then pulled away — it marks its parent with
 * `data-hero-dismissed`, which the stylesheet reads to hide the band and show its stand-ins. The
 * island's first client render reads the same key ({@link readHeroDismissed}) and renders the same
 * mark, so the revive — which diffs attributes against the server's DOM and drops any its tree does
 * not carry — keeps it rather than flashing the band back. The key is JSON-encoded with `<` escaped,
 * so no value can close the script element; storage failures are swallowed, and the hero then simply
 * shows.
 */
export function heroDismissGuard(key: string): string {
	const literal = JSON.stringify(key).replace(/</g, "\\u003c");
	return `(()=>{try{if(localStorage.getItem(${literal})==="1")document.currentScript.parentElement.setAttribute("data-hero-dismissed","")}catch(_){}})();`;
}

/**
 * Whether the viewer dismissed the hero. Storage can be absent or throw (a private window, blocked
 * site data), and then the hero simply shows.
 */
export function readHeroDismissed(key: string): boolean {
	try {
		return globalThis.localStorage?.getItem(key) === "1";
	} catch {
		return false;
	}
}

/** Remember the dismissal; a storage failure only means it is not remembered. */
export function writeHeroDismissed(key: string): void {
	try {
		globalThis.localStorage?.setItem(key, "1");
	} catch {
		// Nothing to recover: the hero stays hidden for this visit.
	}
}
// #endregion
