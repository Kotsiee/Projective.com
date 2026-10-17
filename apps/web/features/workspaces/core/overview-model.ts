import {
	type ActivityEntry,
	type SetupStep,
	type SetupStepId,
	type WorkspaceDetail,
	workspaceHref,
} from "@projective/types/workspace";

/**
 * overview-model — every rule the console's Overview composes, as pure functions over the server's
 * {@link WorkspaceDetail}: the setup hero and its ONE filled control, which zones render, the metric
 * tiles, the projects preview and the activity rows.
 *
 * The island only paints what this returns, so the rules the Overview is judged by — exactly one filled
 * control whatever the setup state, no action a viewer cannot perform, no money for a viewer the read
 * answered none to — are unit-tested here (`overview-model.test.ts`) rather than read off a screenshot.
 * Nothing here guesses a fact: a step's `done` and `actionable`, a payout block, an allowance and a
 * money tile are the server's answers (`packages/backend/services/workspace/mappers.ts`), and an absent
 * one renders as absent. CSS-free and DOM-free, so `deno test` loads it directly.
 */

// #region Setup hero
/** What a step's control does: open the invite modal, publish the entity, or go to the step's page. */
export type HeroActionKind = "invite" | "publish" | "link";

/**
 * The Button Interaction Matrix tier a step's control takes (DESIGN_SYSTEM §B.8.1): 2 — the monochrome
 * structural fill (Invite member); 3 — the primary fill (Publish, or the next step's page); 4 — the
 * neutral outlined utility (every other step the viewer may act on).
 */
export type HeroTier = 2 | 3 | 4;

/** One step's control. */
export interface HeroAction {
	kind: HeroActionKind;
	tier: HeroTier;
	/** Whether this is the band's ONE filled control — tiers 2 and 3. */
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
 * A step's control.
 *
 * The first unfinished step the viewer may act on carries the band's one fill: the tier-2 structural
 * Invite member, else the tier-3 primary (Publish, or the step's page). Every other step they may act on
 * gets a tier-4 utility — except Publish, a one-way commit offered only as the step at hand, never
 * beside the steps that come before it. A step whose page is unknown (`href: ""`) offers nothing.
 */
function actionFor(step: SetupStep, primary: boolean): HeroAction | null {
	if (step.done || !step.actionable) return null;
	const kind = actionKind(step.id);
	if (kind === "link" && !step.href) return null;
	const label = kind === "invite" ? "Invite member" : step.label;
	const href = kind === "link" ? step.href : "";
	if (primary) return { kind, tier: kind === "invite" ? 2 : 3, filled: true, label, href };
	if (kind === "publish") return null;
	return { kind, tier: 4, filled: false, label, href };
}

/**
 * The setup hero, or `null` when it has nothing to show: every step done (a team's last step is
 * Publish, so a draft team always has one open), no steps, or the viewer dismissed it.
 */
export function setupHero(
	input: { name: string; steps: readonly SetupStep[]; dismissed: boolean },
): SetupHeroModel | null {
	const { steps } = input;
	if (input.dismissed || steps.length === 0 || steps.every((s) => s.done)) return null;
	const current = steps.findIndex((s) => !s.done);
	// The first unfinished step the viewer can actually act on (done, unactionable and page-less
	// steps all answer `null`).
	const primary = steps.findIndex((s) => actionFor(s, true) !== null);
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
			action: actionFor(step, i === primary),
		})),
	};
}

/** Whether the hero is showing `id` as an unfinished step. */
function heroHasOpen(hero: SetupHeroModel | null, id: SetupStepId): boolean {
	return !!hero?.steps.some((s) => s.id === id && !s.done);
}
// #endregion

// #region Metrics
/** A count tile. */
export interface CountMetric {
	type: "count";
	key: string;
	label: string;
	value: number;
	caption: string | null;
}

/** A money tile — drawn through `MoneyView`, never formatted here. */
export interface MoneyMetric {
	type: "money";
	key: string;
	label: string;
	money: { minor: number; currency: string };
	caption: string | null;
}

/** One StatTile. */
export type OverviewMetric = CountMetric | MoneyMetric;

/**
 * How many projects are live: a team's distinct projects among its live engagements (B7 — assignments
 * not handed back, on an active or on-hold project); a business's commissioned projects in delivery.
 */
export function liveProjectCount(detail: WorkspaceDetail): number {
	if (detail.kind === "team") return new Set(detail.engagements.map((e) => e.projectSlug)).size;
	return detail.projects.filter((p) => p.state === "active").length;
}

/**
 * The metric row. Members and live projects for everyone; money only where the read answered it —
 * a team's vault from the payout block (`manage_finances` holders, Decision #233), a business's pool
 * from its money tiles (viewers who may open Finance) — and a team's proposal allowance.
 */
export function overviewMetrics(detail: WorkspaceDetail): OverviewMetric[] {
	const members = detail.members.filter((m) => m.state === "active").length;
	const invites = detail.invites.length;
	const metrics: OverviewMetric[] = [
		{
			type: "count",
			key: "members",
			label: "Members",
			value: members,
			caption: invites > 0 ? `${invites} invitation${invites === 1 ? "" : "s"} out` : null,
		},
		{
			type: "count",
			key: "live",
			label: "Live projects",
			value: liveProjectCount(detail),
			caption: detail.kind === "team" ? "In delivery" : "Commissioned",
		},
	];
	if (detail.payout) {
		metrics.push({
			type: "money",
			key: "vault",
			label: "Vault available",
			money: { minor: detail.payout.availableMinor, currency: detail.payout.currency },
			caption: "Ready to distribute or withdraw",
		});
	}
	for (const tile of detail.moneyTiles) {
		metrics.push({
			type: "money",
			key: `wallet-${tile.currency}`,
			label: detail.moneyTiles.length > 1 ? `Available · ${tile.currency}` : "Available",
			money: { minor: tile.available.minor, currency: tile.available.currency },
			caption: "In the pooled wallet",
		});
	}
	if (detail.allowance) {
		metrics.push({
			type: "count",
			key: "allowance",
			label: "Proposals left",
			value: detail.allowance.weeklyRemaining,
			caption: `of ${detail.allowance.weeklyGranted} this week`,
		});
	}
	return metrics;
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

/** Everything the Overview renders, top to bottom. */
export interface OverviewModel {
	hero: SetupHeroModel | null;
	/** The verification lock — only while unverified and not already a step on the hero. */
	lock: boolean;
	/** "Teams need two members to send proposals" — only for a team that cannot, off the hero. */
	propose: ProposeNotice | null;
	metrics: OverviewMetric[];
	projects: PreviewRow[];
	/** The Projects module, for "See all". */
	projectsHref: string;
	activity: ActivityRow[];
}

/**
 * The Overview for one viewer. `dismissed` is their remembered choice to hide the hero; the notices
 * the hero was carrying (the two-member rule, the verification lock) come back once it is gone, so
 * hiding the steps never hides the facts.
 */
export function overviewModel(
	detail: WorkspaceDetail,
	opts: { dismissed: boolean },
): OverviewModel {
	const hero = setupHero({ name: detail.name, steps: detail.setup, dismissed: opts.dismissed });
	return {
		hero,
		lock: detail.verification !== "verified" && !heroHasOpen(hero, "verification"),
		propose: detail.kind === "team" && !detail.canPropose && !heroHasOpen(hero, "invite")
			? { canInvite: detail.viewerCapabilities.includes("invite_members") }
			: null,
		metrics: overviewMetrics(detail),
		projects: projectPreview(detail),
		projectsHref: workspaceHref(detail.kind, detail.handle, "projects"),
		activity: activityRows(detail.activity),
	};
}

/**
 * How many FILLED controls the Overview renders. Only the hero carries one — the notices act through a
 * link-weight control, the projects and activity rows are links, "See all" is tier 5 and the dismiss is
 * an icon-only text button — so this is the hero's count, held to at most one.
 */
export function filledControls(model: OverviewModel): number {
	return model.hero?.steps.filter((s) => s.action?.filled).length ?? 0;
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
