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
	type SplitModel,
	type SplitStake,
	type TeamPayoutPolicy,
	type WorkspaceDetail,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { policyDirty, publishDetail, saveRequested, saveState } from "../core/workspace-state.ts";
import { SplitBar } from "../components/SplitBar.tsx";
import { SplitLegend } from "../components/SplitLegend.tsx";
import { PolicyAmount } from "../components/PolicyAmount.tsx";

/**
 * PayoutPolicyScreen — the team side of money: it comes IN, then it splits.
 *
 * **The split bar's promise is that the dividers ARE the total.** Move one share and the others absorb
 * the difference, so the bar can never show a split that does not sum to 100% — enforced by the SSOT's
 * `rebalanceSplit`, which this screen calls rather than reimplementing. Two implementations of that
 * arithmetic would eventually disagree, and the one on screen would be the one nobody tested.
 *
 * **A held share is immovable and is not redistributed.** Holding somebody's slice means "decide this
 * one by hand", so silently paying it to everyone else would be the opposite of what the control says.
 *
 * **The projection is the point, not the percentages.** "Ravi receives £412.50 of the next release" is
 * a fact somebody can check; "27.5%" is homework. Every figure is a server-computed `MoneyView` — this
 * screen never multiplies money, so a stale projection is marked stale rather than recalculated
 * locally into a number that looks authoritative and is not.
 *
 * Save lives in the FOOTER band: this island watches the `saveRequested` pulse instead of owning a
 * button, so there is exactly one Save on the surface.
 */

export interface PayoutPolicyScreenProps {
	workspace: WorkspaceDetail;
	policy: TeamPayoutPolicy;
}

export default function PayoutPolicyScreen(props: PayoutPolicyScreenProps): JSX.Element {
	const ws = props.workspace;
	const held = new Set(ws.viewerCapabilities);
	const canEdit = held.has("manage_finances");

	const stakes = useSignal<SplitStake[]>([...props.policy.stakes]);
	const model = useSignal<SplitModel>(props.policy.model);
	const autoDistribute = useSignal(props.policy.autoDistribute);
	const highlight = useSignal<string | null>(null);
	const error = useSignal<string | null>(null);
	/** Which stakes have moved since the last save — their projections are stale until it lands. */
	const changed = useSignal<string[]>([]);

	/**
	 * The last SAVED state, which is what "unsaved changes" is measured against.
	 *
	 * It has to be a signal rather than `props.policy`: the prop is the SSR snapshot and never moves, so
	 * comparing against it would leave the surface permanently dirty after a successful save — the footer
	 * would keep offering a Save that has already happened, which teaches the reader to distrust it.
	 */
	const baseline = useSignal({
		stakes: props.policy.stakes.map((s) => ({
			memberId: s.memberId,
			shareBp: s.shareBp,
			held: s.held,
		})),
		model: props.policy.model,
		autoDistribute: props.policy.autoDistribute,
	});

	const balanced = useComputed(() => splitIsBalanced(stakes.value));
	const drift = useComputed(() => splitDriftBp(stakes.value));

	const dirty = useComputed(() => {
		const base = baseline.value;
		return model.value !== base.model ||
			autoDistribute.value !== base.autoDistribute ||
			stakes.value.some((s, i) =>
				s.shareBp !== base.stakes[i]?.shareBp || s.held !== base.stakes[i]?.held
			);
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
		model.value = "custom";
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
			model: model.value,
			stakes: stakes.value.map((s) => ({
				memberId: s.memberId,
				shareBp: s.shareBp,
				held: s.held,
			})),
			autoDistribute: autoDistribute.value,
		});
		if (!res.ok || !res.data) {
			saveState.value = "error";
			error.value = res.message ?? "Could not save the split.";
			return;
		}
		saveState.value = "saved";
		changed.value = [];
		publishDetail(res.data.workspace);
		// Adopt the server's own projection as the new baseline, so the surface stops reporting a change
		// that has landed AND the displayed amounts are the freshly re-priced ones rather than the stale
		// figures the edits were made against.
		const saved = res.data.workspace.payout;
		if (saved) {
			stakes.value = [...saved.stakes];
			model.value = saved.model;
			autoDistribute.value = saved.autoDistribute;
			baseline.value = {
				stakes: saved.stakes.map((s) => ({
					memberId: s.memberId,
					shareBp: s.shareBp,
					held: s.held,
				})),
				model: saved.model,
				autoDistribute: saved.autoDistribute,
			};
		} else {
			baseline.value = {
				stakes: stakes.value.map((s) => ({
					memberId: s.memberId,
					shareBp: s.shareBp,
					held: s.held,
				})),
				model: model.value,
				autoDistribute: autoDistribute.value,
			};
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
								<span class="wsp-split__against">
									Priced against the next release of{" "}
									<PolicyAmount value={props.policy.projectedRelease} size="key" />{" "}
									<Tooltip
										content="The platform fee is already deducted from this figure"
										placement="top"
									>
										<span class="wsp-split__fee">
											after <PolicyAmount value={props.policy.platformFee} size="micro" muted /> fee
										</span>
									</Tooltip>
								</span>
							</div>

							<div class="wsp-split__model" role="group" aria-label="Split model">
								{(["equal", "by_role", "custom"] as const).map((m) => (
									<button
										key={m}
										type="button"
										class="wsp-split__modelbtn"
										data-on={model.value === m ? "true" : undefined}
										aria-pressed={model.value === m}
										disabled={!canEdit}
										onClick={() => {
											model.value = m;
										}}
									>
										{m === "equal" ? "Equal" : m === "by_role" ? "By role" : "Custom"}
									</button>
								))}
							</div>

							<SplitBar
								stakes={stakes.value}
								onMove={canEdit ? move : undefined}
								highlightId={highlight.value}
								changedIds={changed.value}
								readOnly={!canEdit}
							/>

							<SplitLegend
								stakes={stakes.value}
								releaseLabel={props.policy.projectedRelease.display}
								onToggleHold={canEdit ? toggleHold : undefined}
								onHighlight={(id) => {
									highlight.value = id;
								}}
								changedIds={changed.value}
								readOnly={!canEdit}
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

							<label class="wsp-split__auto">
								<input
									type="checkbox"
									checked={autoDistribute.value}
									disabled={!canEdit}
									onChange={(e) => {
										autoDistribute.value = (e.target as HTMLInputElement).checked;
									}}
								/>{" "}
								Distribute automatically when a stage is released
								<span class="wsp-split__auto-note">
									Off means a release lands in the vault and waits for someone to push it out.
								</span>
							</label>

							{error.value && <p class="wsp-create__error" role="alert">{error.value}</p>}
						</div>
					</div>
				</section>

				{props.policy.templates.length > 0 && (
					<section
						class="wsp-band wsp-band--plain wsp-band--tail"
						style={styleVars({ "--wsp-i": 2 })}
					>
						<div class="wsp-band__inner">
							<div class="wsp-split__templates">
								<h2 class="wsp-band__title">Saved templates</h2>
								{props.policy.templates.map((t) => (
									<button
										key={t.id}
										type="button"
										class="wsp-split__template"
										data-on={t.isDefault ? "true" : undefined}
										disabled={!canEdit}
										onClick={() => {
											stakes.value = [...t.stakes];
											model.value = t.model;
											changed.value = t.stakes.map((s) => s.memberId);
										}}
									>
										{t.name}
										{t.isDefault ? " · default" : ""}
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
