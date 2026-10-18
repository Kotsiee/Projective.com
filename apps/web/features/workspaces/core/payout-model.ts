import { currencyExponent, SplitRuleType, type VaultCapability } from "@projective/types/finance";
import {
	splitDriftBp,
	type SplitPreviewLine,
	type SplitRuleInput,
	type SplitStake,
	type TeamSplitPreview,
	type TeamSplitRule,
	type UpdatePayoutInput,
	type VaultAccess,
	type WorkspaceStatus,
} from "@projective/types/workspace";
import {
	bpToPercent,
	formatSplitPercent,
	SPLIT_TOTAL_BP,
	type SplitSegment,
} from "@ui/fields/core/split-bar-model.ts";

/**
 * payout-model — the team Payouts module (`/teams/:teamHandle/payouts`, Teams work order C4) as pure
 * functions of the saved policy and the reader's draft.
 *
 * The screen edits two stored facts in one Save: the split RULE (`finance.save_split_rule` — co_op ·
 * finders_fee · benevolent_dictator, with its vault and finder cuts) and the members' STAKES
 * (`finance.save_team_split`). Everything the screen decides — what the draft is, whether it differs
 * from what is saved, what a Save sends, what a refused Save re-reads, which sections render, which
 * templates the team's plan unlocks, what the drift notice offers and how the Preview ledger reads — is
 * decided here, so `deno test` pins it without a DOM.
 *
 * Percentages are basis points everywhere they are stored (1 bp = 0.01%); the one conversion between
 * the two is {@link percentToBp} / {@link bpToPercent}. Money is never computed here: the Preview's
 * figures, total included, are the server's (`finance.preview_team_split`).
 */

// #region Basis points ⇄ percent
/** Basis points in one percent. */
export const BP_PER_PERCENT = 100;

/**
 * A percentage as typed (two decimals at most) to integer basis points, clamped to 0–10 000. The
 * product is rounded on its decimal form (`12.345 × 100` is `1234.4999…` in binary), so a typed
 * `12.345` stores `1235` and every two-decimal percentage stores exactly. Empty or not a number is 0.
 */
export function percentToBp(percent: number | null | undefined): number {
	if (percent === null || percent === undefined || !Number.isFinite(percent)) return 0;
	const bp = Math.round(Number((percent * BP_PER_PERCENT).toFixed(6)));
	return Math.min(SPLIT_TOTAL_BP, Math.max(0, bp));
}

/** Basis points to a percentage number with two decimals (`4250` → `42.5`) — the ui's own helper. */
export { bpToPercent };

/** Basis points as display text with exactly two decimals (`4250` → `"42.50%"`). */
export function formatBp(bp: number): string {
	return formatSplitPercent(bp);
}
// #endregion

// #region Templates
/** The three split templates, in the order the database's enum (and the SelectButton) lists them. */
export const TEMPLATE_ORDER: readonly SplitRuleType[] = SplitRuleType.options;

/** Each template's name. */
export const TEMPLATE_LABEL: Readonly<Record<SplitRuleType, string>> = {
	co_op: "Co-op",
	finders_fee: "Finder's fee",
	benevolent_dictator: "Benevolent dictator",
};

/**
 * One sentence per template, after finance-model.md §5 "Default ruleset templates". Co-op is worded as
 * the release plan runs it (`finance.fn_team_split_plan`: the vault's cut, then each member's stake of
 * the rest), which the stakes editor below it can make uneven; finance-model §5 words Co-op as an equal
 * split, `(100% − Vault%) / N members`. Which of the two Co-op means is open for an owner ruling.
 */
export const TEMPLATE_SENTENCE: Readonly<Record<SplitRuleType, string>> = {
	co_op: "The Team Vault takes its cut, then the rest is split across the members by their stakes.",
	finders_fee:
		"A fixed percentage goes first to the member who originated the project; the Team Vault takes its cut and the rest is split across the members.",
	benevolent_dictator: "Everything is paid to the Team Vault; distribute it from Finance.",
};

/** One SelectButton option: a template, whether the team's plan unlocks it, whether it can be chosen. */
export interface TemplateChoice {
	value: SplitRuleType;
	label: string;
	/** The team's plan does not carry its `split_template_<type>` flag. */
	locked: boolean;
	/**
	 * Not selectable: locked, unless it is the SAVED template — a team that dropped to Team Free keeps
	 * applying it (the gate binds the write alone, Decision #234), so the reader can always return to it.
	 */
	disabled: boolean;
}

/** The template choices, in template order. */
export function templateChoices(
	unlocked: readonly SplitRuleType[],
	saved: SplitRuleType,
): TemplateChoice[] {
	return TEMPLATE_ORDER.map((value) => {
		const locked = !unlocked.includes(value);
		return { value, label: TEMPLATE_LABEL[value], locked, disabled: locked && value !== saved };
	});
}

/**
 * The plan notice beside the templates, or `null` when the plan unlocks all of them. It names what is
 * locked; when the SAVED template is one of them it says the team keeps paying out by it but cannot
 * change it.
 */
export function lockedNotice(
	unlocked: readonly SplitRuleType[],
	saved: SplitRuleType,
): string | null {
	const locked = TEMPLATE_ORDER.filter((type) => !unlocked.includes(type));
	if (locked.length === 0) return null;
	if (locked.includes(saved)) {
		return `This team still pays out by ${TEMPLATE_LABEL[saved]}, but changing it needs Pro Team.`;
	}
	const names = locked.map((type) => TEMPLATE_LABEL[type]);
	const list = names.length === 1
		? names[0]
		: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
	return `${list} ${names.length === 1 ? "is" : "are"} part of Pro Team.`;
}

/** Which parameters a template takes: a vault cut (co_op, finders_fee) and a finder (finders_fee). */
export function ruleFields(ruleType: SplitRuleType): { vault: boolean; finder: boolean } {
	return {
		vault: ruleType !== "benevolent_dictator",
		finder: ruleType === "finders_fee",
	};
}
// #endregion

// #region The draft
/** The editor's working copy of the split: the rule's parameters and the members' stakes. */
export interface PayoutDraft {
	ruleType: SplitRuleType;
	/** The vault's cut under co_op / finders_fee, bp. (benevolent_dictator stores 10 000 itself.) */
	vaultBp: number;
	/** The finder's user id under finders_fee; `null` until chosen. */
	finderUserId: string | null;
	/** The finder's cut under finders_fee, bp; `null` until entered. */
	finderBp: number | null;
	stakes: readonly SplitStake[];
}

/** What the draft is measured against — the saved rule and stakes from the latest detail. */
export interface PayoutSaved {
	rule: TeamSplitRule;
	stakes: readonly SplitStake[];
}

/**
 * The draft a saved policy opens with. A saved benevolent_dictator reports a vault cut of 10 000, which
 * is that template's whole meaning, not a cut to carry into another one — so the draft's vault cut
 * starts at 0 there.
 */
export function draftFrom(saved: PayoutSaved): PayoutDraft {
	const rule = saved.rule;
	return {
		ruleType: rule.ruleType,
		vaultBp: rule.ruleType === "benevolent_dictator" ? 0 : rule.vaultBp,
		finderUserId: rule.ruleType === "finders_fee" ? rule.finderUserId : null,
		finderBp: rule.ruleType === "finders_fee" ? rule.finderBp : null,
		stakes: saved.stakes,
	};
}

/**
 * Choose a template. Returning to the SAVED template restores its saved parameters when the plan no
 * longer unlocks it — its parameters cannot change on this plan, so a cut edited under another template
 * must not ride back into it.
 */
export function selectTemplate(
	draft: PayoutDraft,
	ruleType: SplitRuleType,
	saved: PayoutSaved,
	unlocked: readonly SplitRuleType[],
): PayoutDraft {
	if (ruleType === saved.rule.ruleType && !unlocked.includes(ruleType)) {
		return { ...draftFrom(saved), stakes: draft.stakes };
	}
	return { ...draft, ruleType };
}

/** Whether the draft's rule differs from the saved one — only the parameters its template uses count. */
export function ruleChanged(draft: PayoutDraft, saved: TeamSplitRule): boolean {
	if (draft.ruleType !== saved.ruleType) return true;
	switch (draft.ruleType) {
		case "co_op":
			return draft.vaultBp !== saved.vaultBp;
		case "finders_fee":
			return draft.vaultBp !== saved.vaultBp || draft.finderUserId !== saved.finderUserId ||
				draft.finderBp !== saved.finderBp;
		case "benevolent_dictator":
			return false;
	}
}

/** Whether two stake lists differ — order, membership, any share or any hold. */
export function stakesChanged(a: readonly SplitStake[], b: readonly SplitStake[]): boolean {
	if (a.length !== b.length) return true;
	return a.some((s, i) =>
		s.memberId !== b[i].memberId || s.shareBp !== b[i].shareBp || s.held !== b[i].held
	);
}

/**
 * How the Member stakes section renders under a template: the split bar, or — under
 * benevolent_dictator, where the plan pays no stake — one line saying everything goes to the vault.
 */
export function stakesMode(ruleType: SplitRuleType): "split" | "vault" {
	return ruleType === "benevolent_dictator" ? "vault" : "split";
}

/** The page's sections, in order. */
export type PayoutSectionKey = "rule" | "stakes" | "preview" | "access";

/**
 * The page's zones under a template: Split rule · Member stakes · Preview · Who can move money — with
 * Member stakes gone under benevolent_dictator, where the rule section says instead that everything is
 * paid to the Team Vault.
 */
export function payoutSections(ruleType: SplitRuleType): PayoutSectionKey[] {
	return stakesMode(ruleType) === "split"
		? ["rule", "stakes", "preview", "access"]
		: ["rule", "preview", "access"];
}

/**
 * Whether the draft holds unsaved changes. A stake moved and then hidden by choosing
 * benevolent_dictator is not a change the reader can see, so it does not count — and is not sent.
 */
export function payoutDirty(draft: PayoutDraft, saved: PayoutSaved): boolean {
	return ruleChanged(draft, saved.rule) ||
		(stakesMode(draft.ruleType) === "split" && stakesChanged(draft.stakes, saved.stakes));
}
// #endregion

// #region Validation and the save
/** What stops the draft's rule from saving, per field. Empty when it can save. */
export interface RuleProblems {
	finder?: string;
	finderCut?: string;
}

/** The rule checks `finance.save_split_rule` would make, made before the request. */
export function ruleProblems(draft: PayoutDraft): RuleProblems {
	if (draft.ruleType !== "finders_fee") return {};
	const problems: RuleProblems = {};
	if (!draft.finderUserId) problems.finder = "Choose the member who found the project.";
	if (draft.finderBp === null || draft.finderBp < 1) {
		problems.finderCut = "Give the finder a cut of at least 0.01%.";
	} else if (draft.finderBp + draft.vaultBp > SPLIT_TOTAL_BP) {
		problems.finderCut = "The finder's and the Vault's cuts together can't pass 100%.";
	}
	return problems;
}

/** Whether a problem set is empty. */
export function hasProblems(problems: RuleProblems): boolean {
	return Object.values(problems).some(Boolean);
}

/** The rule as `POST /api/workspace/payout` takes it, or `null` while it has a problem. */
export function ruleInputOf(draft: PayoutDraft): SplitRuleInput | null {
	if (hasProblems(ruleProblems(draft))) return null;
	switch (draft.ruleType) {
		case "co_op":
			return { ruleType: "co_op", vaultBp: draft.vaultBp };
		case "finders_fee":
			return {
				ruleType: "finders_fee",
				vaultBp: draft.vaultBp,
				finderUserId: draft.finderUserId!,
				finderBp: draft.finderBp!,
			};
		case "benevolent_dictator":
			return { ruleType: "benevolent_dictator" };
	}
}

/** Why a Save cannot go yet, as the notice words it; `null` when it can. */
export type SaveBlock =
	| { reason: "rule"; problems: RuleProblems }
	| { reason: "locked"; ruleType: SplitRuleType }
	| { reason: "drift"; driftBp: number; restorable: boolean }
	| null;

/**
 * What stands between the draft and a Save: a rule problem, a changed template the plan does not
 * unlock (the server would answer 402), or visible stakes that do not total 100%.
 */
export function saveBlock(
	draft: PayoutDraft,
	saved: PayoutSaved,
	unlocked: readonly SplitRuleType[],
): SaveBlock {
	if (ruleChanged(draft, saved.rule)) {
		if (!unlocked.includes(draft.ruleType)) return { reason: "locked", ruleType: draft.ruleType };
		const problems = ruleProblems(draft);
		if (hasProblems(problems)) return { reason: "rule", problems };
	}
	if (stakesMode(draft.ruleType) === "split" && stakesChanged(draft.stakes, saved.stakes)) {
		const drift = splitDriftBp(draft.stakes);
		if (drift !== 0) {
			return { reason: "drift", driftBp: drift, restorable: canRestoreWhole(draft.stakes) };
		}
	}
	return null;
}

/** What a Save that cannot go says, and whether the fix is a plan. */
export interface SaveNotice {
	text: string;
	/** Offer the plans link — the refusal is the plan gate. */
	plans: boolean;
}

/** The notice for a {@link SaveBlock}. */
export function blockNotice(block: NonNullable<SaveBlock>): SaveNotice {
	switch (block.reason) {
		case "locked":
			return { text: `${TEMPLATE_LABEL[block.ruleType]} is part of Pro Team.`, plans: true };
		case "rule":
			return { text: "Choose the finder and their cut before you save.", plans: false };
		case "drift":
			return {
				text: block.restorable
					? "Rebalance the stakes to 100% before you save."
					: "Release a held stake and rebalance the stakes to 100% before you save.",
				plans: false,
			};
	}
}

/**
 * The notice for a refused Save, from the route's soft result: the plan gate (`402`,
 * `details.reason = "entitlement"`) names the template and offers the plans; anything else says the
 * database's own sentence — a field-keyed one first, since the route keys a refusal to the input that
 * carried it.
 */
export function refusalNotice(
	result: {
		message?: string;
		errors?: Record<string, string>;
		details?: Record<string, unknown>;
	},
	ruleType: SplitRuleType,
	teamName: string,
): SaveNotice {
	if (result.details?.reason === "entitlement") {
		return {
			text: `${TEMPLATE_LABEL[ruleType]} is part of Pro Team, which ${teamName} isn't on.`,
			plans: true,
		};
	}
	const field = Object.values(result.errors ?? {}).find((text) => text.trim().length > 0);
	return {
		text: field ?? result.message ?? "The split couldn't be saved. Try again.",
		plans: false,
	};
}

/**
 * The ONE request a Save sends — the rule when it changed, the stakes when they changed (and show),
 * both in one body (the route writes the rule first, Decision #234). `null` when nothing would change.
 * An unchanged rule is never re-sent: each save of it retires the stored row and audits a new one.
 */
export function saveBody(
	workspaceId: string,
	draft: PayoutDraft,
	saved: PayoutSaved,
): UpdatePayoutInput | null {
	const rule = ruleChanged(draft, saved.rule) ? ruleInputOf(draft) : null;
	const stakes = stakesMode(draft.ruleType) === "split" && stakesChanged(draft.stakes, saved.stakes)
		? draft.stakes.map((s) => ({ memberId: s.memberId, shareBp: s.shareBp, held: s.held }))
		: null;
	if (!rule && !stakes) return null;
	return {
		workspaceId,
		...(rule ? { rule } : {}),
		...(stakes ? { stakes } : {}),
	};
}

/**
 * Whether a REFUSED Save may still have changed what is stored, so the island must re-read the detail
 * and measure the draft against it. The route writes the rule, then the stakes, each RPC its own
 * transaction (Decision #234), so a body carrying both can come back refused with its rule already
 * saved. Re-basing on the re-read keeps the draft as typed while the saved rule stops reading as
 * unsaved — and is never sent again.
 */
export function refusalMayHaveSaved(body: UpdatePayoutInput): boolean {
	return body.rule !== undefined && body.stakes !== undefined;
}

/**
 * Whether the screen may edit: the reader holds `manage_finances` (the module's gate, so normally
 * yes) and the team is not archived (`finance.save_split_rule` refuses an archived team).
 */
export function payoutEditable(canManage: boolean, status: WorkspaceStatus): boolean {
	return canManage && status !== "archived";
}
// #endregion

// #region Stakes and the split bar
/** The stakes as SplitBar segments, in roster order (`key` is the member id). */
export function segmentsOf(stakes: readonly SplitStake[]): SplitSegment[] {
	return stakes.map((s) => ({ key: s.memberId, label: s.name, bp: s.shareBp, held: s.held }));
}

/** Apply a SplitBar change back onto the stakes, by member id. */
export function withSegments(
	stakes: readonly SplitStake[],
	segments: readonly SplitSegment[],
): SplitStake[] {
	const next = new Map(segments.map((s) => [s.key, s.bp]));
	return stakes.map((s) => {
		const bp = next.get(s.memberId);
		return bp === undefined || bp === s.shareBp ? s : { ...s, shareBp: bp };
	});
}

/** Hold or release one stake. A held stake's dividers lock, and a departure never redistributes it. */
export function withHeld(
	stakes: readonly SplitStake[],
	memberId: string,
	held: boolean,
): SplitStake[] {
	return stakes.map((s) => (s.memberId === memberId && s.held !== held ? { ...s, held } : s));
}

/**
 * Whether {@link restoreWhole} can bring the split back to 100% as it stands: at least one stake is
 * unheld and the held stakes alone do not pass 100%. When it cannot, only releasing a hold can — so
 * the drift notice offers no Rebalance action that would do nothing (§3.11).
 */
export function canRestoreWhole(stakes: readonly SplitStake[]): boolean {
	const heldBp = stakes.reduce((sum, s) => sum + (s.held ? s.shareBp : 0), 0);
	return stakes.some((s) => !s.held) && heldBp <= SPLIT_TOTAL_BP;
}

/**
 * Whether the drift notice offers its "Rebalance to 100%" action: the split drifted, the reader may
 * edit, and {@link restoreWhole} would actually change it.
 */
export function offersRebalance(stakes: readonly SplitStake[], editable: boolean): boolean {
	return editable && splitDriftBp(stakes) !== 0 && canRestoreWhole(stakes);
}

/**
 * Bring a drifted split back to exactly 100% without touching a held stake: the unheld stakes are
 * scaled in proportion to what they hold (evenly when they hold nothing), floored, and the rounding
 * remainder goes to the largest of them — the rule the departure rebalance uses. Returned unchanged
 * when {@link canRestoreWhole} says it cannot, which only releasing a hold can fix.
 */
export function restoreWhole(stakes: readonly SplitStake[]): SplitStake[] {
	if (!canRestoreWhole(stakes)) return [...stakes];
	const heldBp = stakes.reduce((sum, s) => sum + (s.held ? s.shareBp : 0), 0);
	const target = SPLIT_TOTAL_BP - heldBp;
	const open = stakes.filter((s) => !s.held);
	const current = open.reduce((sum, s) => sum + s.shareBp, 0);
	const scaled = new Map<string, number>();
	for (const s of open) {
		scaled.set(
			s.memberId,
			current > 0 ? Math.floor((s.shareBp * target) / current) : Math.floor(target / open.length),
		);
	}
	const placed = [...scaled.values()].reduce((sum, bp) => sum + bp, 0);
	let largest = open[0].memberId;
	for (const s of open) if (scaled.get(s.memberId)! > scaled.get(largest)!) largest = s.memberId;
	scaled.set(largest, scaled.get(largest)! + (target - placed));
	return stakes.map((s) => (s.held ? s : { ...s, shareBp: scaled.get(s.memberId)! }));
}

/**
 * Co-op's own shape (finance-model §5, "(100% − Vault%) / N members"): every unheld stake the same,
 * the integer remainder on the owner — or on the first unheld stake when the owner's is held — exactly
 * as the server's even template places it. Held stakes keep their share.
 */
export function evenStakes(
	stakes: readonly SplitStake[],
	ownerMemberId: string | null,
): SplitStake[] {
	const open = stakes.filter((s) => !s.held);
	const target = SPLIT_TOTAL_BP - stakes.reduce((sum, s) => sum + (s.held ? s.shareBp : 0), 0);
	if (open.length === 0 || target < 0) return [...stakes];
	const base = Math.floor(target / open.length);
	const remainderTo = open.some((s) => s.memberId === ownerMemberId)
		? ownerMemberId
		: open[0].memberId;
	return stakes.map((s) => {
		if (s.held) return s;
		const bp = base + (s.memberId === remainderTo ? target - base * open.length : 0);
		return bp === s.shareBp ? s : { ...s, shareBp: bp };
	});
}

/** Whether the split is already even — what {@link evenStakes} would produce. */
export function isEvenSplit(stakes: readonly SplitStake[], ownerMemberId: string | null): boolean {
	return !stakesChanged(stakes, evenStakes(stakes, ownerMemberId));
}

/**
 * The drift notice's sentence for a split that does not total 100%. When the held stakes block a
 * rebalance (`restorable` false), it says what will: releasing a hold.
 */
export function driftSentence(drift: number, restorable = true): string {
	const total = formatBp(SPLIT_TOTAL_BP + drift);
	const fix = restorable
		? "Rebalance them before you save."
		: "Release a held stake, then rebalance them before you save.";
	return drift < 0
		? `The stakes add up to ${total}, not 100% — a member left and their share was not spread. ${fix}`
		: `The stakes add up to ${total}, more than 100%. ${fix}`;
}

/** The legend's facts: each member and their share, a held stake marked so. */
export function legendItems(stakes: readonly SplitStake[]): { text: string; tabular: true }[] {
	return stakes.map((s) => ({
		text: `${s.name} ${formatBp(s.shareBp)}${s.held ? " held" : ""}`,
		tabular: true,
	}));
}
// #endregion

// #region Preview
/** The largest amount the Preview prices, in minor units — `finance.preview_team_split`'s ceiling. */
export const PREVIEW_MAX_MINOR = 1_000_000_000_000;

/** The Preview's opening amount: 1,000 in the team's currency, in its minor units. */
export function defaultPreviewMinor(currency: string): number {
	return 1_000 * 10 ** currencyExponent(currency);
}

/** One rendered row of the Preview ledger. */
export interface LedgerRow {
	key: string;
	kind: SplitPreviewLine["kind"] | "total";
	label: string;
	/** The cut's rate (`"5.00%"`), or `null` for dust and the total. */
	rate: string | null;
	amount: SplitPreviewLine["amount"];
}

/** A preview line's label: what the cut is and, for a person's, who it pays. */
export function lineLabel(line: SplitPreviewLine): string {
	switch (line.kind) {
		case "fee":
			return "Platform fee";
		case "finder":
			return line.name ? `Finder · ${line.name}` : "Finder";
		case "vault":
			return "Vault cut";
		case "member":
			return line.name ?? "Member";
		case "dust":
			return "Vault dust";
	}
}

/**
 * The ledger as rendered: every server line, in the plan's order, then the total row — the server's
 * own sum, which equals the amount priced. Nothing is added up here.
 */
export function ledgerRows(preview: TeamSplitPreview): LedgerRow[] {
	return [
		...preview.lines.map((line) => ({
			key: line.key,
			kind: line.kind,
			label: lineLabel(line),
			rate: line.bp === null ? null : formatBp(line.bp),
			amount: line.amount,
		})),
		{ key: "total", kind: "total", label: "Total", rate: null, amount: preview.total },
	];
}
// #endregion

// #region Who can move money
/** Each vault capability as the readout names it. */
export const VAULT_CAPABILITY_LABEL: Readonly<Record<VaultCapability, string>> = {
	view: "view",
	add_funds: "add funds",
	spend: "spend",
	distribute: "distribute",
	withdraw: "withdraw",
	manage_members: "manage members",
	manage_billing: "manage billing",
	approve_spend: "approve spend",
};

/** One member's readout: their vault capabilities as text, or a plain "no access" when they hold none. */
export function vaultAccessItems(row: VaultAccess): string[] {
	return row.capabilities.length === 0
		? ["no access"]
		: row.capabilities.map((cap) => VAULT_CAPABILITY_LABEL[cap]);
}
// #endregion
