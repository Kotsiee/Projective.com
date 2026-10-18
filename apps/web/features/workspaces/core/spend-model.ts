import type { MoneyView } from "@projective/types/finance";
import {
	type BusinessSpendPolicy,
	canOpenVerification,
	type SpendLimit,
	type SpendLimitPatch,
	type SpendPeriod,
	type SpendRequest,
	type UpdateSpendInput,
	type WorkspaceCapability,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceMember,
} from "@projective/types/workspace";
import { approverList, BUSINESS_REFUSAL_COPY } from "./refusal-copy.ts";

/**
 * spend-model — the pure half of a business's Spend module (BU2, Decision #246): the editor's draft
 * and the one patch it saves, what a limits row draws while a draft is being priced, the grant pickers,
 * the request queue's controls and every notice's words.
 *
 * Nothing here decides policy. Whose rows the viewer may change, whether nobody but the owner approves,
 * whether a ceiling is plan-gated, whether the viewer may decide, every figure and every link are the
 * server's (BB9 + #246); this module only compares a draft with what was saved, picks which server
 * figure to show, and words it. The only arithmetic is a meter's percentage (the server's
 * `usedFraction` × 100).
 *
 * Two disabled states MIRROR `finance.save_spend_policy`'s own refusals, so a control the save would
 * refuse is not offered (Decision #246 ruling (h)): granting what the viewer does not hold
 * ({@link grantView}, and the can-spend toggle) — read from the detail's `viewer.capabilities`, the
 * same `org.fn_member_capabilities` set the save checks — and, under the Business Pro gate, a ceiling
 * field with nothing stored (`SpendLimitRow`). `workspace.contract.test.ts` pins both to the SQL text;
 * the save still refuses either on its own.
 *
 * Type-only imports from the SSOT and the refusal-copy leaf, so `deno test` loads it and an island
 * imports it without the console's stylesheets.
 */

// #region Shapes
/** One fact on a MetaLine — structurally the display package's `MetaLineEntry`. */
export type MetaFact = string | { text: string; tabular?: boolean };

/** One member's envelope as the editor holds it. */
export interface LimitDraft {
	canSpend: boolean;
	/** The rolling ceiling in minor units; `null` is none. */
	limitMinor: number | null;
	/** The per-purchase ceiling in minor units; `null` is none. */
	perTransactionMinor: number | null;
	period: SpendPeriod;
}

/** The editor's whole draft, seeded from the saved policy. */
export interface SpendDraft {
	/** The wallet's own threshold in minor units; `null` is off (the platform default governs). */
	thresholdMinor: number | null;
	/** Every member who would hold `approve_spend` — the ones the viewer cannot change included. */
	approverIds: readonly string[];
	/** Every member who would hold `contribute_funds`. */
	contributorIds: readonly string[];
	/** Envelopes by member id. */
	limits: Readonly<Record<string, LimitDraft>>;
}

/** The envelopes the server priced for a draft, and which draft it priced. */
export interface PreviewState {
	/** {@link patchSignature} of the limits patch that was priced. */
	signature: string;
	/** The priced envelopes, by member id. */
	limits: Readonly<Record<string, SpendLimit>>;
}

/** What a limits row draws. */
export interface RowView {
	/**
	 * The envelope to draw — the saved one, or the server's pricing of the draft. `null` while a draft
	 * waits for its price: the row then says so instead of drawing a figure that is not the draft's.
	 */
	shown: SpendLimit | null;
	/** The row differs from what is saved. */
	draft: boolean;
	/** The draft's price has not arrived. */
	pricing: boolean;
}

/** The marker a drafted row carries until it is saved. */
export const DRAFT_NOTE = "Not saved yet";
/** What a drafted row says while its price is on the way. */
export const PRICING_NOTE = "Pricing the change…";
/** What a drafted row says when the preview could not price it. */
export const PREVIEW_FAILED = "Couldn't price this change";
// #endregion

// #region The draft
/** A saved envelope as a draft row. */
export function limitDraftOf(limit: SpendLimit): LimitDraft {
	return {
		canSpend: limit.canSpend,
		limitMinor: limit.limitMinor,
		perTransactionMinor: limit.perTransactionMinor,
		period: limit.period,
	};
}

/** The draft a saved policy starts as. */
export function draftOf(policy: BusinessSpendPolicy): SpendDraft {
	return {
		thresholdMinor: policy.approvalThresholdMinor,
		approverIds: [...policy.approverIds],
		contributorIds: [...policy.contributorIds],
		limits: Object.fromEntries(policy.limits.map((l) => [l.memberId, limitDraftOf(l)])),
	};
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	const left = new Set(a);
	const right = new Set(b);
	return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * One row's patch: only the keys that moved. A key that did not move must not travel — restating a
 * stored ceiling is a ceiling being SET, which Business Free refuses (BB7). `null` when nothing moved.
 */
export function limitPatchOf(saved: SpendLimit, draft: LimitDraft): SpendLimitPatch | null {
	const patch: SpendLimitPatch = { memberId: saved.memberId };
	let moved = false;
	if (draft.canSpend !== saved.canSpend) {
		patch.canSpend = draft.canSpend;
		moved = true;
	}
	if (draft.limitMinor !== saved.limitMinor) {
		patch.limitMinor = draft.limitMinor;
		moved = true;
	}
	if (draft.perTransactionMinor !== saved.perTransactionMinor) {
		patch.perTransactionMinor = draft.perTransactionMinor;
		moved = true;
	}
	if (draft.period !== saved.period) {
		patch.period = draft.period;
		moved = true;
	}
	return moved ? patch : null;
}

/**
 * The limits entries a draft would save — only for the rows the server said the viewer may change
 * (`editableMemberIds`: never the owner, never themselves), each carrying only what moved.
 */
export function limitsPatch(saved: BusinessSpendPolicy, draft: SpendDraft): SpendLimitPatch[] {
	const byId = new Map(saved.limits.map((l) => [l.memberId, l]));
	return saved.editableMemberIds.flatMap((id) => {
		const row = byId.get(id);
		const next = draft.limits[id];
		const patch = row && next ? limitPatchOf(row, next) : null;
		return patch ? [patch] : [];
	});
}

/** A stable key for a limits patch, so a preview answer is matched to the draft it priced. */
export function patchSignature(limits: readonly SpendLimitPatch[]): string {
	return JSON.stringify(limits);
}

/**
 * The one save a draft makes, or `null` when nothing differs from what is saved. The threshold and the
 * grant sets travel only when they changed; a grant set travels whole (the members the viewer cannot
 * change at their saved state, so the database sees no change to them).
 */
export function draftPatch(
	workspaceId: string,
	saved: BusinessSpendPolicy,
	draft: SpendDraft,
): UpdateSpendInput | null {
	const patch: UpdateSpendInput = { workspaceId, currency: saved.currency };
	let changed = false;
	if (draft.thresholdMinor !== saved.approvalThresholdMinor) {
		patch.approvalThresholdMinor = draft.thresholdMinor;
		changed = true;
	}
	if (!sameSet(draft.approverIds, saved.approverIds)) {
		patch.approverIds = [...draft.approverIds];
		changed = true;
	}
	if (!sameSet(draft.contributorIds, saved.contributorIds)) {
		patch.contributorIds = [...draft.contributorIds];
		changed = true;
	}
	const limits = limitsPatch(saved, draft);
	if (limits.length > 0) {
		patch.limits = limits;
		changed = true;
	}
	return changed ? patch : null;
}

/** Whether the draft differs from what is saved. */
export function isDirty(saved: BusinessSpendPolicy, draft: SpendDraft): boolean {
	return draftPatch("", saved, draft) !== null;
}

function sameLimitDraft(a: LimitDraft, b: LimitDraft): boolean {
	return a.canSpend === b.canSpend && a.limitMinor === b.limitMinor &&
		a.perTransactionMinor === b.perTransactionMinor && a.period === b.period;
}

/**
 * A draft carried across a re-read: what the reader changed since `before` stays changed; everything
 * else follows the new saved state. `before` is what the re-read answers — the saved policy's draft
 * for a decision or a withdrawal (so a decision that moved somebody's spend re-reads their row instead
 * of leaving it on the old figures, BD3), or the draft a save SENT (so the save's answer replaces what
 * was sent and keeps what the reader typed while it was on its way).
 */
export function rebaseDraft(
	before: SpendDraft,
	after: BusinessSpendPolicy,
	draft: SpendDraft,
): SpendDraft {
	const next = draftOf(after);
	return {
		thresholdMinor: draft.thresholdMinor === before.thresholdMinor
			? next.thresholdMinor
			: draft.thresholdMinor,
		approverIds: sameSet(draft.approverIds, before.approverIds)
			? next.approverIds
			: [...draft.approverIds],
		contributorIds: sameSet(draft.contributorIds, before.contributorIds)
			? next.contributorIds
			: [...draft.contributorIds],
		limits: Object.fromEntries(after.limits.map((row) => {
			const was = before.limits[row.memberId];
			const mine = draft.limits[row.memberId];
			const kept = was && mine && !sameLimitDraft(was, mine);
			return [row.memberId, kept ? mine : next.limits[row.memberId]];
		})),
	};
}
// #endregion

// #region A limits row
/**
 * What a limits row draws. With no draft, the saved envelope. With a draft, the server's pricing of it
 * — matched to the exact draft by its signature — or nothing yet. Never a server object with a field
 * patched in: that is how an unlimited member being given a ceiling once drew what they had spent as
 * the ceiling (BUSINESSES_AUDIT BD2).
 */
export function rowView(
	saved: SpendLimit,
	draft: LimitDraft | undefined,
	preview: PreviewState | null,
	signature: string,
): RowView {
	const patch = draft ? limitPatchOf(saved, draft) : null;
	if (!patch) return { shown: saved, draft: false, pricing: false };
	const priced = preview && preview.signature === signature
		? preview.limits[saved.memberId]
		: undefined;
	return priced
		? { shown: priced, draft: true, pricing: false }
		: { shown: null, draft: true, pricing: true };
}

/** The ceiling a row draws: the server's own formatted cap, or none. Never the spent figure. */
export function ceilingOf(limit: Pick<SpendLimit, "limit">): MoneyView | null {
	return limit.limit;
}

const PERIOD_PHRASE: Readonly<Record<SpendPeriod, string>> = {
	weekly: "/ week",
	monthly: "/ month",
	total: "in total",
};

/** The period choices, in the order a reader thinks of them. */
export const PERIOD_OPTIONS: ReadonlyArray<{ label: string; value: SpendPeriod }> = [
	{ label: "Weekly", value: "weekly" },
	{ label: "Monthly", value: "monthly" },
	{ label: "In total", value: "total" },
];

/** "/ month" · "/ week" · "in total" — the window a ceiling is per. */
export function periodPhrase(period: SpendPeriod): string {
	return PERIOD_PHRASE[period];
}

/**
 * A member's envelope in one line: "Spending off" · "US$500.00 / month · US$100.00 per purchase" ·
 * "No ceiling" — every figure the server's `display`, set tabular.
 */
export function envelopeLine(
	limit: Pick<SpendLimit, "canSpend" | "limit" | "perTransaction" | "period">,
): MetaFact[] {
	if (!limit.canSpend) return ["Spending off"];
	const ceiling = ceilingOf(limit);
	const facts: MetaFact[] = [
		ceiling
			? { text: `${ceiling.display} ${periodPhrase(limit.period)}`, tabular: true }
			: "No ceiling",
	];
	if (limit.perTransaction) {
		facts.push({ text: `${limit.perTransaction.display} per purchase`, tabular: true });
	}
	return facts;
}

/** A row's meter: the share of the ceiling used, its tone, and the two figures under it. */
export interface MeterView {
	/** 0–100, from the server's `usedFraction`. */
	percent: number;
	/**
	 * Amber from four-fifths used — never red: using one's whole allowance is the tool working. A
	 * drafted row's meter is `secondary`: it prices a change that is not saved yet ({@link rowFace}).
	 */
	severity: "primary" | "warning" | "secondary";
	caption: MetaFact[];
}

/** The meter for a row, or `null` when there is no ceiling to measure against (or no spending). */
export function meterOf(
	limit: Pick<SpendLimit, "canSpend" | "limit" | "usedFraction" | "spent" | "remaining">,
): MeterView | null {
	if (!limit.canSpend || !limit.limit) return null;
	const fraction = Math.max(0, Math.min(1, limit.usedFraction));
	return {
		percent: Math.round(fraction * 100),
		severity: fraction >= 0.8 ? "warning" : "primary",
		caption: [
			{ text: `${limit.spent.display} spent`, tabular: true },
			limit.remaining ? { text: `${limit.remaining.display} left`, tabular: true } : "",
		].filter((fact) => fact !== ""),
	};
}

/** What a limits row shows: its envelope line and its meter. */
export interface RowFace {
	facts: MetaFact[];
	meter: MeterView | null;
}

/**
 * A limits row's face. Saved: the envelope and its meter. Drafted and priced: "Not saved yet" first,
 * then the server's price of THAT draft, its meter in the muted `secondary` ramp — the stale marker
 * the figures carry until the save. Drafted and not priced yet (or the preview failed): no figure at
 * all, so nothing on the row can be read as the draft's ceiling — what the member spent included
 * (BUSINESSES_AUDIT BD2).
 */
export function rowFace(view: RowView, previewFailed: boolean): RowFace {
	if (!view.shown) {
		return { facts: [previewFailed ? PREVIEW_FAILED : PRICING_NOTE, DRAFT_NOTE], meter: null };
	}
	const meter = meterOf(view.shown);
	if (!view.draft) return { facts: envelopeLine(view.shown), meter };
	return {
		facts: [DRAFT_NOTE, ...envelopeLine(view.shown)],
		meter: meter ? { ...meter, severity: "secondary" } : null,
	};
}
// #endregion

// #region The grant pickers
/** The two grants the pickers edit. */
export type SpendGrant = "approve_spend" | "contribute_funds";

/** One picker row. */
export interface GrantOption {
	value: string;
	label: string;
	disabled?: boolean;
	description?: string;
}

/** A picker: the rows the viewer may change, the holders they may not, and the current picks. */
export interface GrantView {
	options: GrantOption[];
	/** Holders the viewer cannot change — the owner (always), themselves, anyone they do not outrank. */
	fixed: string[];
	/** The picked rows among {@link options}. */
	value: string[];
}

/** The ids a grant is saved to on a policy. */
export function savedGrant(policy: BusinessSpendPolicy, grant: SpendGrant): readonly string[] {
	return grant === "approve_spend" ? policy.approverIds : policy.contributorIds;
}

/**
 * A picker over the members the server said the viewer may change. A row whose member does not hold
 * the grant is disabled when the viewer does not hold it either — nobody grants what they do not hold
 * (the save refuses it); taking it away stays possible.
 */
export function grantView(
	members: readonly Pick<WorkspaceMember, "id" | "name" | "rolePreset" | "state">[],
	policy: BusinessSpendPolicy,
	draftIds: readonly string[],
	grant: SpendGrant,
	viewer: { memberId: string; capabilities: readonly WorkspaceCapability[] },
): GrantView {
	const editable = new Set(policy.editableMemberIds);
	const saved = new Set(savedGrant(policy, grant));
	const canGrant = viewer.capabilities.includes(grant);
	const byId = new Map(members.map((m) => [m.id, m]));
	const options = policy.editableMemberIds.flatMap((id) => {
		const member = byId.get(id);
		if (!member) return [];
		const locked = !canGrant && !saved.has(id);
		return [{
			value: id,
			label: member.name,
			...(locked
				? { disabled: true, description: "You can't give a permission you don't hold" }
				: {}),
		}];
	});
	const fixed = members
		.filter((m) => m.state === "active" && !editable.has(m.id))
		.filter((m) => m.rolePreset === "owner" || saved.has(m.id))
		.sort((a, b) => Number(b.rolePreset === "owner") - Number(a.rolePreset === "owner"))
		.map((m) => {
			const self = m.id === viewer.memberId;
			if (m.rolePreset === "owner") return self ? "you (owner)" : `${m.name} (owner)`;
			return self ? "you" : m.name;
		});
	return { options, fixed, value: draftIds.filter((id) => editable.has(id)) };
}

/**
 * Who holds a grant, for a reader who may not change it: the owner first and marked, the reader as
 * "You", the rest by name.
 */
export function holderNames(
	members: readonly Pick<WorkspaceMember, "id" | "name" | "rolePreset">[],
	ids: readonly string[],
	viewerMemberId: string,
): string[] {
	const held = new Set(ids);
	return members
		.filter((m) => held.has(m.id))
		.sort((a, b) => Number(b.rolePreset === "owner") - Number(a.rolePreset === "owner"))
		.map((m) => {
			const self = m.id === viewerMemberId;
			if (m.rolePreset === "owner") return self ? "You (owner)" : `${m.name} (owner)`;
			return self ? "You" : m.name;
		});
}

/**
 * Whether a picker has a row the viewer can actually tick or untick — what a link to it promises. A
 * picker whose every row is disabled (an editor who does not hold the grant, and nobody in reach holds
 * it either) cannot fix "nobody can approve", so nothing should send the reader there (§3.11).
 */
export function hasPickable(view: Pick<GrantView, "options">): boolean {
	return view.options.some((option) => !option.disabled);
}

/** A picker's hint: who else holds the grant, out of the viewer's reach. Empty when nobody does. */
export function fixedHint(fixed: readonly string[], grant: SpendGrant): string {
	if (fixed.length === 0) return "";
	const doing = grant === "approve_spend" ? "approving" : "adding money";
	return `Also ${doing}: ${fixed.join(", ")}.`;
}

/** A picker's new picks folded into the whole grant set (the rows outside the picker unchanged). */
export function mergeGrant(
	draftIds: readonly string[],
	editableIds: readonly string[],
	picked: readonly string[],
): string[] {
	const editable = new Set(editableIds);
	return [
		...draftIds.filter((id) => !editable.has(id)),
		...picked.filter((id) => editable.has(id)),
	];
}
// #endregion

// #region The request queue
/** What a pending row offers the viewer. */
export type RequestAction = "decide" | "withdraw" | "none";

/** A pending row and its controls. */
export interface RequestRow {
	request: SpendRequest;
	action: RequestAction;
	/**
	 * The Approve button's tier: the FIRST decidable row's is tier 3 (`primary`, filled — one filled
	 * control per region, DESIGN_SYSTEM §B.8), every other row's tier 4 (`neutral`, outlined).
	 */
	approveTier: "primary" | "neutral";
	/** The viewer filed it. */
	own: boolean;
}

/**
 * The pending queue's rows: the viewer's own request offers Withdraw (nobody decides their own); anyone
 * else's offers Approve and Decline when the server says the viewer may decide (`viewerCan.decide`).
 */
export function requestRows(
	pending: readonly SpendRequest[],
	viewer: { memberId: string; canDecide: boolean },
): RequestRow[] {
	let first = true;
	return pending.map((request) => {
		const own = request.memberId === viewer.memberId;
		const action: RequestAction = own ? "withdraw" : viewer.canDecide ? "decide" : "none";
		const approveTier = action === "decide" && first ? "primary" : "neutral";
		if (action === "decide") first = false;
		return { request, action, approveTier, own };
	});
}

/** A pending row's facts: when it was raised, when it lapses, who it waits on. */
export function pendingLine(request: SpendRequest): MetaFact[] {
	return [
		request.raisedAt,
		request.expiresLabel ?? "",
		request.approvers.length > 0 ? `Waiting on ${approverList(request.approvers)}` : "",
	].filter((fact) => fact !== "");
}

/** A decided row's outcome: "Approved by Priya Raman · Today · Used" · "Withdrawn · Yesterday" … */
export function decidedLine(request: SpendRequest): MetaFact[] {
	const by = request.decidedBy ? ` by ${request.decidedBy}` : "";
	const when = request.decidedAt ?? "";
	switch (request.state) {
		case "approved":
			return [`Approved${by}`, when, request.consumed ? "Used" : ""].filter((f) => f !== "");
		case "declined":
			return [`Declined${by}`, when].filter((f) => f !== "");
		case "withdrawn":
			return ["Withdrawn", when].filter((f) => f !== "");
		case "expired":
			return ["Expired"];
		default:
			return [];
	}
}

/** The two queue tabs. */
export const REQUEST_TABS = ["pending", "decided"] as const;
/** A queue tab. */
export type RequestTab = (typeof REQUEST_TABS)[number];

/** Each tab's empty state. */
export const REQUEST_EMPTY: Readonly<Record<RequestTab, string>> = {
	pending:
		"Nothing is waiting on a decision. Spending above someone's limit will appear here instead of being refused.",
	decided:
		"Nothing has been decided yet. Approved, declined, expired and withdrawn requests appear here.",
};

/** What a queue control set out to do. */
export type QueueAct = "approve" | "decline" | "withdraw";

/** The queue write in flight: which request, and which of its controls was pressed. */
export interface QueueBusy {
	id: string;
	act: QueueAct;
}

/**
 * A queue control's element id — how focus returns to the control that was pressed when its write is
 * refused (the control is disabled while the write flies, which drops focus to the page).
 */
export function queueControlId(requestId: string, act: QueueAct): string {
	return `wsp-request-${requestId}-${act}`;
}

const SETTLED_AS: Readonly<Record<QueueAct, string>> = {
	approve: "Approved.",
	decline: "Declined.",
	withdraw: "Request withdrawn.",
};

/**
 * What the live region says once a decision or a withdrawal has been re-read: the state the server
 * left the request in, not the control that was pressed. Both doors (`decide_spend_approval`,
 * `withdraw_spend_approval`) mark a request that lapsed while the page was open `expired` and answer
 * success, so "Approved." over a row the Decided tab shows as Expired would be false. Falls back to
 * the act when the re-read does not carry the row.
 */
export function settledNote(
	policy: Pick<BusinessSpendPolicy, "approvals"> | null | undefined,
	requestId: string,
	act: QueueAct,
): string {
	switch (policy?.approvals.decided.find((r) => r.id === requestId)?.state) {
		case "expired":
			return "That request had already expired.";
		case "approved":
			return SETTLED_AS.approve;
		case "declined":
			return SETTLED_AS.decline;
		case "withdrawn":
			return SETTLED_AS.withdraw;
		default:
			return SETTLED_AS[act];
	}
}
// #endregion

// #region A refused save
/** A section of the Spend editor — where a refusal of its save is said. */
export type SpendSection = "threshold" | "grants" | "limits";

/** A refused save, placed beside what it concerns rather than under the whole page. */
export interface SaveRefusal {
	section: SpendSection;
	/**
	 * The field it names, drawn as that field's own FormControl error; `null` for a refusal said as a
	 * notice at the top of {@link section}.
	 */
	field: "threshold" | "approvers" | "contributors" | null;
	/** The limits row it names (a `limits.<i>.*` error), so the editor can open that row. */
	memberId: string | null;
	text: string;
}

/** A save answer's error keys, by their first path segment: the section and the field each names. */
const REFUSED_FIELD: Readonly<
	Record<string, { section: SpendSection; field: SaveRefusal["field"] }>
> = {
	approvalThresholdMinor: { section: "threshold", field: "threshold" },
	approverIds: { section: "grants", field: "approvers" },
	contributorIds: { section: "grants", field: "contributors" },
	limits: { section: "limits", field: null },
};

/** What a failed save says when the answer carries no words at all. */
export const SAVE_FAILED = "Couldn't save the spend policy.";

/**
 * Where a refused save is said. A field-keyed error (the route's Zod 422, or the database's
 * `field: reason` 22023) goes to the field — or, for a limits row, to the Member limits section with
 * that row named. A refusal that names no field (a 403, a 409) goes to the first section the save
 * changed, in page order, so it is read beside what was edited and never only under the queue.
 */
export function saveRefusal(
	patch: Pick<
		UpdateSpendInput,
		"approvalThresholdMinor" | "approverIds" | "contributorIds" | "limits"
	>,
	answer: { message?: string | null; errors?: Readonly<Record<string, string>> | null },
): SaveRefusal {
	for (const [key, text] of Object.entries(answer.errors ?? {})) {
		const [root, index] = key.split(".");
		const placed = REFUSED_FIELD[root];
		if (!placed || !text) continue;
		const row = root === "limits" && index !== undefined
			? patch.limits?.[Number(index)]?.memberId ?? null
			: null;
		return { ...placed, memberId: row, text };
	}
	// An error keyed to no field of this form is still more specific than the route's general
	// "Check the highlighted fields." — which would highlight nothing here.
	const text = Object.values(answer.errors ?? {}).find(Boolean) || answer.message || SAVE_FAILED;
	const section: SpendSection = patch.approvalThresholdMinor !== undefined
		? "threshold"
		: patch.approverIds !== undefined || patch.contributorIds !== undefined
		? "grants"
		: "limits";
	return { section, field: null, memberId: null, text };
}
// #endregion

// #region Notices
/** A notice: its sentence, one supporting fact, one link, or what to ask for instead. */
export interface NoticeView {
	sentence: string;
	meta: string | null;
	link: { label: string; href: string } | null;
	ask: string | null;
}

/**
 * The KYB notice for an approver of a business that is not verified yet: they hold `approve_spend`
 * but the server says they may not decide (`viewerCan.decide`), so the queue offers no Approve. Worded
 * by the refusal map's `kyb_required` in its approver form (`deciding` — Decisions #243, #246: what
 * waits for them is deciding, not paying), linked to the Verification module (BU4) only for a viewer
 * the module admits. `null` for anyone else.
 */
export function decideNotice(input: {
	kind: WorkspaceKind;
	handle: string;
	business: string;
	capabilities: readonly WorkspaceCapability[];
	canDecide: boolean;
	kybStatus: string | null;
}): NoticeView | null {
	if (input.canDecide || !input.capabilities.includes("approve_spend")) return null;
	const copy = BUSINESS_REFUSAL_COPY.kyb_required;
	const ctx = { business: input.business, kybStatus: input.kybStatus, deciding: true };
	const link = canOpenVerification(input.kind, input.capabilities) && copy.action
		? { label: copy.action(ctx), href: workspaceHref(input.kind, input.handle, "verification") }
		: null;
	return {
		sentence: copy.sentence(ctx),
		meta: null,
		link,
		ask: link ? null : copy.ask(ctx),
	};
}

/** The in-page address of the approvers picker — what "Choose approvers" lands on. */
export const APPROVERS_PICKER_ID = "wsp-spend-approvers";

/**
 * The warning that nobody besides the owner approves (`approverGap`, decided in SQL): the owner's own
 * spend over the threshold or a limit then has nobody to decide it (nobody decides their own request —
 * Decision #239 (e)). Shown to the policy's editors, who can fix it — with a link to the picker when it
 * has anybody in it; a member's own requests still reach the owner, so it is not theirs to read.
 */
export function gapNotice(input: {
	approverGap: boolean;
	editPolicy: boolean;
	viewerIsOwner: boolean;
	pickable: boolean;
}): NoticeView | null {
	if (!input.approverGap || !input.editPolicy) return null;
	return {
		sentence: input.viewerIsOwner
			? "Nobody besides you can approve spending, so your own spending over the threshold or a limit has nobody to decide it."
			: "Nobody besides the owner can approve spending, so the owner's own spending over the threshold or a limit has nobody to decide it.",
		meta: null,
		link: input.pickable ? { label: "Choose approvers", href: `#${APPROVERS_PICKER_ID}` } : null,
		ask: input.pickable ? null : "Invite a member who can approve spending.",
	};
}

/**
 * The Business Pro notice: setting a threshold or a ceiling is `pooled_wallet_full`, which this
 * business's plan does not include (the server's `limitsPlanGated`, or a save refused 402). Worded by
 * the refusal map's `entitlement`. "See plans" is withheld — no surface lists Business Pro yet
 * (Decision #246) — so the owner reads that changing plans is not available, anyone else whom to ask.
 * Only the policy's editors read it: to a reader who may not set a threshold or a ceiling at all, a
 * plan refusal answers a question they never had (as {@link gapNotice}).
 */
export function planNotice(input: {
	gated: boolean;
	editPolicy: boolean;
	business: string;
	viewerIsOwner: boolean;
}): NoticeView | null {
	if (!input.gated || !input.editPolicy) return null;
	const copy = BUSINESS_REFUSAL_COPY.entitlement;
	return {
		sentence: copy.sentence({ business: input.business }),
		meta: input.viewerIsOwner ? "Changing plans isn't available yet." : copy.ask({}),
		link: null,
		ask: null,
	};
}

/**
 * The MetaLine under the threshold field: what an empty field means — the platform's default (its
 * figure tabular), or no threshold at all.
 */
export function thresholdDefault(
	policy: Pick<BusinessSpendPolicy, "platformThreshold">,
): MetaFact[] {
	return policy.platformThreshold
		? [
			"Empty uses the platform's default",
			{ text: policy.platformThreshold.display, tabular: true },
		]
		: ["Empty means no threshold"];
}

/** The threshold for a reader who may not change it. */
export function thresholdLine(
	policy: Pick<BusinessSpendPolicy, "approvalThreshold" | "platformThreshold">,
): MetaFact[] {
	if (policy.approvalThreshold) return [{ text: policy.approvalThreshold.display, tabular: true }];
	if (policy.platformThreshold) {
		return [{ text: policy.platformThreshold.display, tabular: true }, "the platform's default"];
	}
	return ["No threshold"];
}
// #endregion
