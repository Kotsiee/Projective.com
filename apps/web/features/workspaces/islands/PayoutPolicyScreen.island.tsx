import type { JSX } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { batch, useComputed, useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import { InlineNotice } from "@projective/ui/feedback";
import { SplitRuleType } from "@projective/types/finance";
import {
	type SplitStake,
	type TeamPayoutPolicy,
	type TeamSplitPreview,
	type WorkspaceDetail,
	workspaceHref,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { publishDetail, saveState } from "../core/workspace-state.ts";
import { mayViewModule } from "../core/module-registry.tsx";
import { usePolicyBridge } from "../hooks/usePolicyBridge.ts";
import {
	blockNotice,
	bpToPercent,
	defaultPreviewMinor,
	draftFrom,
	evenStakes,
	isEvenSplit,
	lockedNotice,
	payoutDirty,
	type PayoutDraft,
	payoutEditable,
	type PayoutSaved,
	payoutSections,
	percentToBp,
	PREVIEW_MAX_MINOR,
	refusalMayHaveSaved,
	refusalNotice,
	restoreWhole,
	ruleProblems,
	saveBlock,
	saveBody,
	type SaveNotice,
	selectTemplate,
	templateChoices,
	withHeld,
	withSegments,
} from "../core/payout-model.ts";
import { PayoutRuleSection, PlansLink } from "../components/PayoutRuleSection.tsx";
import { MemberStakesSection } from "../components/MemberStakesSection.tsx";
import { PayoutPreview } from "../components/PayoutPreview.tsx";
import { VaultAccessList } from "../components/VaultAccessList.tsx";

/**
 * PayoutPolicyScreen — a team's Payouts module (`/teams/:teamHandle/payouts`, Teams work order C4):
 * how a released stage payout divides, and who may move the money it leaves in the vault.
 *
 * Four sections, separated by space and one hairline, nothing boxed:
 *   - **Split rule** — the template the release plan applies first (Co-op · Finder's fee · Benevolent
 *     dictator) and its cuts, as basis points typed in percent. A template the team's plan does not
 *     unlock is offered disabled beside a "See plans" link (Decision #234).
 *   - **Member stakes** — the ui `SplitBar` over the active members, the tabular legend and the hold
 *     toggles; gone under Benevolent dictator, which pays everything to the Team Vault.
 *   - **Preview** — an amount and the ledger `finance.preview_team_split` answers for it: every cut
 *     from the server, the total equal to the amount.
 *   - **Who can move money** — each member's vault capabilities, read-only, with a link to Roles.
 *
 * The page has no Save of its own: the footer rig's tier-3 Save (wallet configuration, never the amber
 * money tier) and Discard answer through `usePolicyBridge`, which mirrors `dirty` into the rig with a
 * signal effect. A Save sends the changed rule and the changed stakes in ONE request, adopts the
 * re-read detail the route answers with, and re-prices the Preview; a refusal is an InlineNotice under
 * the page head, and a refusal that may have saved the rule before the stakes failed re-reads the
 * detail so the stored rule stops reading as unsaved. Every rule the page follows is a pure function in
 * `core/payout-model.ts`.
 */

export interface PayoutPolicyScreenProps {
	workspace: WorkspaceDetail;
	policy: TeamPayoutPolicy;
}

/** A template value from the SelectButton, read as a template (an unknown value is Co-op). */
function asRuleType(value: string | string[]): SplitRuleType {
	const parsed = SplitRuleType.safeParse(Array.isArray(value) ? value[0] : value);
	return parsed.success ? parsed.data : "co_op";
}

export default function PayoutPolicyScreen(props: PayoutPolicyScreenProps): JSX.Element {
	const ws = props.workspace;
	const editable = payoutEditable(ws.viewerCapabilities.includes("manage_finances"), ws.status);
	const ownerId = ws.members.find((m) => m.rolePreset === "owner")?.id ?? null;
	const financeHref = mayViewModule("finance", ws.kind, ws.viewerCapabilities)
		? workspaceHref(ws.kind, ws.handle, "finance")
		: null;
	const rolesHref = mayViewModule("roles", ws.kind, ws.viewerCapabilities)
		? workspaceHref(ws.kind, ws.handle, "roles")
		: null;

	// #region State — the saved policy and the draft
	/** The server's latest policy, replaced wholesale by every successful save. */
	const policy = useSignal<TeamPayoutPolicy>(props.policy);
	const saved = useComputed<PayoutSaved>(() => ({
		rule: policy.value.rule,
		stakes: policy.value.stakes,
	}));
	const opening = useMemo(
		() => draftFrom({ rule: props.policy.rule, stakes: props.policy.stakes }),
		[],
	);
	const ruleType = useSignal<string | string[]>(opening.ruleType);
	const vaultPct = useSignal<number | null>(bpToPercent(opening.vaultBp));
	const finderId = useSignal<string>(opening.finderUserId ?? "");
	const finderPct = useSignal<number | null>(
		opening.finderBp === null ? null : bpToPercent(opening.finderBp),
	);
	const stakes = useSignal<readonly SplitStake[]>(opening.stakes);

	const draft = useComputed<PayoutDraft>(() => ({
		ruleType: asRuleType(ruleType.value),
		vaultBp: percentToBp(vaultPct.value),
		finderUserId: finderId.value || null,
		finderBp: finderPct.value === null ? null : percentToBp(finderPct.value),
		stakes: stakes.value,
	}));
	const dirty = useComputed(() => payoutDirty(draft.value, saved.value));
	/** A Save was attempted — the rule's field problems paint from here on. */
	const attempted = useSignal(false);
	const notice = useSignal<SaveNotice | null>(null);

	/** Put a whole draft into the bound controls. */
	function load(next: PayoutDraft): void {
		batch(() => {
			ruleType.value = next.ruleType;
			vaultPct.value = bpToPercent(next.vaultBp);
			finderId.value = next.finderUserId ?? "";
			finderPct.value = next.finderBp === null ? null : bpToPercent(next.finderBp);
			stakes.value = next.stakes;
		});
	}

	function touched(): void {
		notice.value = null;
	}
	// #endregion

	// #region Preview
	const currency = policy.value.currency;
	const amount = useSignal<number | null>(defaultPreviewMinor(currency));
	const preview = useSignal<TeamSplitPreview | null>(null);
	const previewError = useSignal<string | null>(null);
	/** Starts true: the opening amount is priced as soon as the island hydrates. */
	const pricing = useSignal(true);
	/** Bumped to price the same amount again — after a save, or a retry. */
	const previewRev = useSignal(0);
	const ticket = useRef(0);
	const primed = useRef(false);

	async function price(minor: number): Promise<void> {
		const mine = ++ticket.current;
		pricing.value = true;
		const res = await WorkspaceService.previewPayout({
			workspaceId: ws.id,
			amountMinor: minor,
			currency,
		});
		if (mine !== ticket.current) return;
		batch(() => {
			pricing.value = false;
			if (res.ok && res.data) {
				preview.value = res.data;
				previewError.value = null;
			} else {
				previewError.value = res.message ?? "That amount couldn't be priced just now.";
			}
		});
	}

	// The first price goes at once; a typed amount waits for the reader to pause.
	useSignalEffect(() => {
		const minor = amount.value;
		void previewRev.value;
		if (minor === null || minor < 1 || minor > PREVIEW_MAX_MINOR) {
			ticket.current++;
			batch(() => {
				preview.value = null;
				pricing.value = false;
				previewError.value = minor !== null && minor > PREVIEW_MAX_MINOR
					? "Preview a smaller amount."
					: null;
			});
			return;
		}
		const delay = primed.current ? 350 : 0;
		primed.current = true;
		const timer = setTimeout(() => void price(minor), delay);
		return () => clearTimeout(timer);
	});
	// #endregion

	// #region Save and Discard — the footer rig's, through the bridge
	async function save(): Promise<void> {
		if (!editable || !dirty.peek()) return;
		const current = draft.peek();
		const base = saved.peek();
		const block = saveBlock(current, base, policy.peek().unlockedTemplates);
		if (block) {
			batch(() => {
				attempted.value = true;
				notice.value = blockNotice(block);
				saveState.value = "error";
			});
			return;
		}
		const body = saveBody(ws.id, current, base);
		if (!body) return;
		batch(() => {
			saveState.value = "saving";
			notice.value = null;
		});
		const res = await WorkspaceService.updatePayout(body);
		if (!res.ok || !res.data) {
			batch(() => {
				saveState.value = "error";
				notice.value = refusalNotice(res, current.ruleType, ws.name);
			});
			if (refusalMayHaveSaved(body)) await rebase();
			return;
		}
		publishDetail(res.data);
		const next = res.data.payout;
		batch(() => {
			if (next) {
				policy.value = next;
				load(draftFrom({ rule: next.rule, stakes: next.stakes }));
			}
			attempted.value = false;
			saveState.value = "saved";
			previewRev.value++;
		});
	}

	/**
	 * After a refusal that may have landed part of the Save (the rule saved, the stakes refused), measure
	 * the draft against what is stored now: the re-read detail becomes the saved baseline, the draft
	 * stays as typed, and the Preview re-prices the stored split. A failed re-read leaves both alone.
	 */
	async function rebase(): Promise<void> {
		const reread = await WorkspaceService.detail(ws.kind, ws.id);
		const next = reread.ok ? reread.data?.payout : null;
		if (!reread.ok || !reread.data || !next) return;
		publishDetail(reread.data);
		batch(() => {
			policy.value = next;
			previewRev.value++;
		});
	}

	/** Return every field to the last saved split. */
	function discard(): void {
		batch(() => {
			load(draftFrom(saved.peek()));
			attempted.value = false;
			notice.value = null;
		});
	}

	usePolicyBridge({ dirty, save, discard });
	// #endregion

	// #region Render
	const d = draft.value;
	const p = policy.value;
	const unlocked = p.unlockedTemplates;
	const sections = payoutSections(d.ruleType);
	const problems = attempted.value ? ruleProblems(d) : {};

	return (
		<div class="wsp" data-kind="team">
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" data-i={0}>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title">Payouts</h1>
							<p class="wsp-pagehead__note">
								How a released stage payout divides — the platform fee, then the split rule's cuts,
								then the members' stakes — and who can move what the Team Vault keeps.
							</p>
						</div>
						{!editable && (
							<p class="wsp-payout__meta">
								{ws.status === "archived"
									? "This team is archived. Restore it to change how it splits its payouts."
									: "Only members who manage the team's finances can change its split."}
							</p>
						)}
						{notice.value && (
							<div class="wsp-payout__gate">
								<InlineNotice
									assertive
									align="start"
									class="wsp-payout__notice"
									text={notice.value.text}
								/>
								{notice.value.plans && <PlansLink />}
							</div>
						)}
					</div>
				</section>

				<div class="wsp-band wsp-band--page wsp-band--tail" data-i={1}>
					<div class="wsp-band__inner">
						<div class="wsp-payout">
							{sections.map((key) => {
								switch (key) {
									case "rule":
										return (
											<PayoutRuleSection
												key={key}
												ruleType={ruleType}
												current={d.ruleType}
												vaultPct={vaultPct}
												finderId={finderId}
												finderPct={finderPct}
												choices={templateChoices(unlocked, saved.value.rule.ruleType)}
												members={d.stakes}
												editable={editable}
												paramsLocked={!unlocked.includes(d.ruleType)}
												notice={lockedNotice(unlocked, saved.value.rule.ruleType)}
												problems={problems}
												financeHref={financeHref}
												onTemplate={(value) => {
													load(
														selectTemplate(draft.peek(), asRuleType(value), saved.peek(), unlocked),
													);
													touched();
												}}
												onEdit={touched}
											/>
										);
									case "stakes":
										return (
											<MemberStakesSection
												key={key}
												stakes={d.stakes}
												editable={editable}
												onSegments={(next) => {
													stakes.value = withSegments(stakes.peek(), next);
													touched();
												}}
												onToggleHold={(memberId, held) => {
													stakes.value = withHeld(stakes.peek(), memberId, held);
													touched();
												}}
												onRebalance={() => {
													stakes.value = restoreWhole(stakes.peek());
													touched();
												}}
												onEven={isEvenSplit(d.stakes, ownerId) ? null : () => {
													stakes.value = evenStakes(stakes.peek(), ownerId);
													touched();
												}}
											/>
										);
									case "preview":
										return (
											<PayoutPreview
												key={key}
												currency={currency}
												amount={amount}
												preview={preview.value}
												pricing={pricing.value}
												error={previewError.value}
												stale={dirty.value}
												onRetry={() => {
													previewRev.value++;
												}}
											/>
										);
									case "access":
										return <VaultAccessList key={key} rows={p.vaultAccess} rolesHref={rolesHref} />;
								}
							})}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
	// #endregion
}
