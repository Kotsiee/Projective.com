import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import { Tooltip } from "@projective/ui/feedback";
import { styleVars } from "@ui/core/style.ts";
import {
	rebalanceSplit,
	splitDriftBp,
	splitIsBalanced,
	type SplitStake,
	type TeamPayoutPolicy,
	type WorkspaceDetail,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { policyDirty, publishDetail, saveRequested, saveState } from "../core/workspace-state.ts";
import { splitModelOf } from "../core/workspace-model.ts";
import { SplitBar } from "../components/SplitBar.tsx";
import { SplitLegend } from "../components/SplitLegend.tsx";
import { PolicyAmount } from "../components/PolicyAmount.tsx";

/**
 * PayoutPolicyScreen — the team side of money: it comes IN, then it splits.
 *
 * **The split bar's promise is that the dividers ARE the total.** Move one share and the others absorb
 * the difference, so the bar can never show a split that does not sum to 100% — enforced by the SSOT's
 * `rebalanceSplit`, which this screen calls rather than reimplementing.
 *
 * **A held share is immovable and is not redistributed.** Holding somebody's slice means "decide this
 * one by hand", so silently paying it to everyone else would be the opposite of what the control says.
 *
 * **The projection is the point, not the percentages — when there is one.** "Ravi receives £412.50 of
 * the next release" is a fact somebody can check; it is priced server-side against the team's oldest
 * held escrow. When nothing is held there is no next release to price, and the screen says so rather
 * than printing a column of zeroes that reads like a payout. The vault's cut is taken before the split
 * and is shown as the rate, plus its amount when a release is held.
 *
 * Save lives in the FOOTER band: this island watches the `saveRequested` pulse instead of owning a
 * button, so there is exactly one Save on the surface.
 */

export interface PayoutPolicyScreenProps {
	workspace: WorkspaceDetail;
	policy: TeamPayoutPolicy;
}

/** The persisted facts of a split — what "unsaved changes" is measured against. */
function savedShape(
	stakes: readonly SplitStake[],
): { memberId: string; shareBp: number; held: boolean }[] {
	return stakes.map((s) => ({ memberId: s.memberId, shareBp: s.shareBp, held: s.held }));
}

/** Percent from basis points, one decimal place at most. */
function pct(bp: number): string {
	return `${Math.round(bp / 10) / 10}%`;
}

export default function PayoutPolicyScreen(props: PayoutPolicyScreenProps): JSX.Element {
	const ws = props.workspace;
	const held = new Set(ws.viewerCapabilities);
	const canEdit = held.has("manage_finances");

	/** The server's latest policy — replaced wholesale by every successful save. */
	const policy = useSignal<TeamPayoutPolicy>(props.policy);
	const stakes = useSignal<SplitStake[]>([...props.policy.stakes]);
	const highlight = useSignal<string | null>(null);
	const error = useSignal<string | null>(null);
	/** Which stakes have moved since the last save — their projections are stale until it lands. */
	const changed = useSignal<string[]>([]);

	/**
	 * The last SAVED state. A signal rather than `props.policy`: the prop is the SSR snapshot and never
	 * moves, so comparing against it would leave the surface permanently dirty after a successful save.
	 */
	const baseline = useSignal(savedShape(props.policy.stakes));

	const balanced = useComputed(() => splitIsBalanced(stakes.value));
	const drift = useComputed(() => splitDriftBp(stakes.value));
	const model = useComputed(() => splitModelOf(stakes.value));
	const release = policy.value.projectedRelease;

	const dirty = useComputed(() => {
		const base = baseline.value;
		return stakes.value.some((s, i) => s.shareBp !== base[i]?.shareBp || s.held !== base[i]?.held);
	});

	// Publish dirtiness so the footer band can offer Save — it cannot see this island's state directly.
	useEffect(() => {
		policyDirty.value = dirty.value;
		return () => {
			policyDirty.value = false;
		};
	}, [dirty.value]);

	/** Move one share; the SSOT holds the 100% invariant and respects held stakes. */
	function move(memberId: string, nextBp: number): void {
		if (!canEdit) return;
		stakes.value = rebalanceSplit(stakes.value, memberId, nextBp);
		if (!changed.value.includes(memberId)) changed.value = [...changed.value, memberId];
		error.value = null;
	}

	function toggleHold(memberId: string, nextHeld: boolean): void {
		if (!canEdit) return;
		stakes.value = stakes.value.map((s) => s.memberId === memberId ? { ...s, held: nextHeld } : s);
		error.value = null;
	}

	async function save(): Promise<void> {
		if (!dirty.value) return;
		if (!balanced.value) {
			const over = drift.value > 0;
			error.value = `The shares add up to ${over ? "more" : "less"} than 100% — ${
				Math.abs(drift.value / 100).toFixed(2)
			}% ${over ? "over" : "short"}.`;
			saveState.value = "error";
			return;
		}
		saveState.value = "saving";
		error.value = null;
		const res = await WorkspaceService.updatePayout({
			workspaceId: ws.id,
			stakes: savedShape(stakes.value),
		});
		if (!res.ok || !res.data) {
			saveState.value = "error";
			error.value = res.errors?.stakes ?? res.message ?? "Could not save the split.";
			return;
		}
		saveState.value = "saved";
		changed.value = [];
		publishDetail(res.data);
		// Adopt the server's own projection as the new baseline, so the surface stops reporting a change
		// that has landed AND the displayed amounts are the freshly re-priced ones.
		const saved = res.data.payout;
		if (saved) {
			policy.value = saved;
			stakes.value = [...saved.stakes];
			baseline.value = savedShape(saved.stakes);
		} else {
			baseline.value = savedShape(stakes.value);
		}
	}

	// The footer band's Save is a pulse, not a callback — see the module header.
	useEffect(() => {
		if (saveRequested.value > 0) void save();
	}, [saveRequested.value]);

	return (
		<div class="wsp" data-kind="team">
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" style={styleVars({ "--wsp-i": 0 })}>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title">Payouts and splits</h1>
							<p class="wsp-pagehead__note">
								When a stage is released, this is how it divides. Drag a divider or use the arrow
								keys — the shares always add up to the whole.
							</p>
						</div>
					</div>
				</section>

				<section class="wsp-band wsp-band--money" style={styleVars({ "--wsp-i": 1 })}>
					<div class="wsp-band__inner">
						<div class="wsp-split">
							<div class="wsp-split__head">
								{release
									? (
										<span class="wsp-split__against">
											Priced against the next release of <PolicyAmount value={release} size="key" />
											{policy.value.platformFee && (
												<>
													{" "}
													<Tooltip
														content="The platform fee is already deducted from this figure"
														placement="top"
													>
														<span class="wsp-split__fee">
															after{" "}
															<PolicyAmount value={policy.value.platformFee} size="micro" muted />
															{" "}
															fee
														</span>
													</Tooltip>
												</>
											)}
										</span>
									)
									: (
										<span class="wsp-split__against">
											No release is held yet. The split below applies to the next one, and each
											person's amount appears here once a stage is funded.
										</span>
									)}
							</div>

							<p class="wsp-split__vault">
								{model.value === "equal" ? "An even split" : "A custom split"} · the vault keeps
								{" "}
								<span class="wsp-num">{pct(policy.value.vaultBp)}</span>{" "}
								of every release before it divides
								{policy.value.vaultCut && (
									<>
										{" "}— <PolicyAmount value={policy.value.vaultCut} size="micro" muted />{" "}
										of this one
									</>
								)}
								.
							</p>

							<SplitBar
								stakes={stakes.value}
								onMove={canEdit ? move : undefined}
								highlightId={highlight.value}
								changedIds={changed.value}
								readOnly={!canEdit}
								priced={release !== null}
							/>

							<SplitLegend
								stakes={stakes.value}
								releaseLabel={release?.display}
								onToggleHold={canEdit ? toggleHold : undefined}
								onHighlight={(id) => {
									highlight.value = id;
								}}
								changedIds={changed.value}
								readOnly={!canEdit}
								priced={release !== null}
							/>

							{!balanced.value && (
								<p class="wsp-split__drift" role="status">
									<span class="wsp-split__drift-text">
										{drift.value > 0 ? "Over" : "Short"} by{" "}
										{Math.abs(drift.value / 100).toFixed(2)}% — it cannot be saved until it
										balances.
									</span>
								</p>
							)}

							{error.value && <p class="wsp-create__error" role="alert">{error.value}</p>}
						</div>
					</div>
				</section>

				{canEdit && policy.value.templates.length > 0 && (
					<section
						class="wsp-band wsp-band--plain wsp-band--tail"
						style={styleVars({ "--wsp-i": 2 })}
					>
						<div class="wsp-band__inner">
							<div class="wsp-split__templates">
								<h2 class="wsp-band__title">Quick splits</h2>
								{policy.value.templates.map((t) => (
									<button
										key={t.id}
										type="button"
										class="wsp-split__template"
										data-on={t.isDefault ? "true" : undefined}
										onClick={() => {
											stakes.value = [...t.stakes];
											changed.value = t.stakes.map((s) => s.memberId);
											error.value = null;
										}}
									>
										{t.name}
										{t.isDefault ? " · current" : ""}
									</button>
								))}
							</div>
						</div>
					</section>
				)}
			</div>
		</div>
	);
}
