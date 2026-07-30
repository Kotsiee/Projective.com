import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import { Tooltip } from "@projective/ui/feedback";
import { InputNumber } from "@projective/ui/fields";
import { styleVars } from "@ui/core/style.ts";
import {
	type BusinessSpendPolicy,
	kindCopy,
	type SpendLimit,
	type WorkspaceDetail,
} from "@projective/types/workspace";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { policyDirty, publishDetail, saveRequested, saveState } from "../core/workspace-state.ts";
import { type SpendLimitPatch, SpendLimitRow } from "../components/SpendLimitRow.tsx";
import { ApprovalQueue } from "../components/ApprovalQueue.tsx";
import { ContributionLedger } from "../components/ContributionLedger.tsx";
import { VerificationLock } from "../components/VerificationLock.tsx";
import { PolicyAmount } from "../components/PolicyAmount.tsx";

/**
 * SpendPolicyScreen — the business side of money: it comes in from members, then out as purchases.
 *
 * Three controls, in the order the questions actually arrive:
 *
 *  1. **Who may put money in**, and an attributable ledger of who did. A pooled wallet without
 *     attribution cannot answer "where did that go", which is how shared money becomes an argument.
 *  2. **Who may spend, and how much** — a per-member envelope, reusing the semantics of
 *     `finance.spending_limits` rather than a parallel notion of a limit.
 *  3. **What happens above the limit** — an approval, never a refusal. This is the part most spend
 *     controls get wrong: a hard no stops the work, so over-limit spending becomes a request that
 *     someone can grant.
 *
 * **The KYB gate locks operation, not configuration.** Before verification the policy is fully
 * editable and the wallet cannot move money — so the work of setting it up is not blocked on paperwork,
 * and the paperwork is visibly the thing standing between the two.
 *
 * Save is the footer band's, watched here as a pulse, so there is one Save on the surface.
 */

export interface SpendPolicyScreenProps {
	workspace: WorkspaceDetail;
	policy: BusinessSpendPolicy;
}

export default function SpendPolicyScreen(props: SpendPolicyScreenProps): JSX.Element {
	const ws = props.workspace;
	const copy = kindCopy(ws.kind);
	const held = new Set(ws.viewerCapabilities);
	const canEdit = held.has("manage_finances");
	const canApprove = held.has("approve_spend");

	const limits = useSignal<SpendLimit[]>([...props.policy.limits]);
	const threshold = useSignal<number | null>(props.policy.approvalThresholdMinor);
	const editingId = useSignal<string | null>(null);
	const busyId = useSignal<string | null>(null);
	const error = useSignal<string | null>(null);

	const verified = props.policy.verification === "verified";

	/**
	 * The last SAVED state, which is what "unsaved changes" is measured against. A signal rather than
	 * `props.policy`, because the prop is the SSR snapshot and never moves — comparing against it would
	 * leave the surface permanently dirty after a successful save.
	 */
	const baseline = useSignal({
		threshold: props.policy.approvalThresholdMinor,
		limits: props.policy.limits.map((l) => ({
			memberId: l.memberId,
			canSpend: l.canSpend,
			limitMinor: l.limitMinor,
			perTransactionMinor: l.perTransactionMinor,
		})),
	});

	const dirty = useComputed(() => {
		const base = baseline.value;
		return threshold.value !== base.threshold ||
			limits.value.some((l, i) => {
				const was = base.limits[i];
				return !was || l.canSpend !== was.canSpend || l.limitMinor !== was.limitMinor ||
					l.perTransactionMinor !== was.perTransactionMinor;
			});
	});

	// Publish dirtiness so the footer band can offer Save — it cannot see this island's state.
	useEffect(() => {
		policyDirty.value = dirty.value;
		return () => {
			policyDirty.value = false;
		};
	}, [dirty.value]);

	function patchLimit(patch: SpendLimitPatch): void {
		limits.value = limits.value.map((l) =>
			l.memberId === patch.memberId
				? {
					...l,
					canSpend: patch.canSpend,
					limitMinor: patch.limitMinor,
					perTransactionMinor: patch.perTransactionMinor,
				}
				: l
		);
		error.value = null;
	}

	async function save(): Promise<void> {
		if (!dirty.value) return;
		saveState.value = "saving";
		error.value = null;
		const res = await WorkspaceService.updateSpend({
			workspaceId: ws.id,
			approvalThresholdMinor: threshold.value,
			approverIds: props.policy.approverIds,
			contributorIds: props.policy.contributorIds,
			limits: limits.value.map((l) => ({
				memberId: l.memberId,
				canSpend: l.canSpend,
				limitMinor: l.limitMinor,
				perTransactionMinor: l.perTransactionMinor,
			})),
		});
		if (!res.ok || !res.data) {
			saveState.value = "error";
			error.value = res.message ?? "Could not save the spend policy.";
			return;
		}
		saveState.value = "saved";
		editingId.value = null;
		publishDetail(res.data.workspace);
		// Adopt the server's own projection as the new baseline: the surface stops reporting a change that
		// has landed, and the envelope meters show the server's recomputed `usedFraction` rather than the
		// figures the edits were made against.
		const saved = res.data.workspace.spend;
		if (saved) {
			limits.value = [...saved.limits];
			threshold.value = saved.approvalThresholdMinor;
		}
		baseline.value = {
			threshold: saved ? saved.approvalThresholdMinor : threshold.value,
			limits: (saved ? saved.limits : limits.value).map((l) => ({
				memberId: l.memberId,
				canSpend: l.canSpend,
				limitMinor: l.limitMinor,
				perTransactionMinor: l.perTransactionMinor,
			})),
		};
	}

	useEffect(() => {
		if (saveRequested.value > 0) void save();
	}, [saveRequested.value]);

	async function decide(requestId: string, approve: boolean): Promise<void> {
		busyId.value = requestId;
		error.value = null;
		const res = await WorkspaceService.decideSpend(ws.id, requestId, approve);
		busyId.value = null;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not record that decision.";
			return;
		}
		publishDetail(res.data.workspace);
	}

	const pendingCount = props.policy.requests.filter((r) => r.state === "pending").length;

	return (
		<div class="wsp" data-kind="business">
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" style={styleVars({ "--wsp-i": 0 })}>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							<h1 class="wsp-pagehead__title">Spending and approvals</h1>
							<p class="wsp-pagehead__note">
								Several people fund the {copy.moneyNoun}{" "}
								and several spend from it. Set who may do which, how much they may spend alone, and
								what needs a second pair of eyes.
							</p>
						</div>
					</div>
				</section>

				{
					/*
					 * The KYB lock: rendered and actionable, never hidden. Configuration below stays editable —
					 * only moving money waits on verification.
					 */
				}
				<VerificationLock
					kind={ws.kind}
					verification={props.policy.verification}
					prompt={props.policy.verificationPrompt}
					href={`/${copy.plural}/${ws.id}/settings`}
					canManage={held.has("manage_settings")}
					tone="band"
				/>

				{pendingCount > 0 && (
					<section class="wsp-band wsp-band--plain" style={styleVars({ "--wsp-i": 1 })}>
						<div class="wsp-band__inner">
							<div class="wsp-band__head">
								<h2 class="wsp-band__title">
									{pendingCount === 1 ? "1 request waiting" : `${pendingCount} requests waiting`}
								</h2>
							</div>
							<div class="wsp-band__body">
								<ApprovalQueue
									requests={props.policy.requests}
									canApprove={canApprove && verified}
									busyId={busyId.value}
									onDecide={(id, approve) =>
										void decide(id, approve)}
									accessHref="/wallet/access"
								/>
							</div>
						</div>
					</section>
				)}

				<section class="wsp-band wsp-band--money" style={styleVars({ "--wsp-i": 2 })}>
					<div class="wsp-band__inner">
						<div class="wsp-spend">
							{/* #region Approval threshold */}
							<div class="wsp-spend__threshold">
								<label class="wsp-spend__threshold-field">
									<span class="wsp-create__label">Approval threshold</span>
									<InputNumber
										value={threshold.value === null ? null : threshold.value / 100}
										onValueChange={(v) => {
											threshold.value = v === null ? null : Math.round(v * 100);
										}}
										mode="currency"
										currency={props.policy.approvalThreshold?.currency ?? "GBP"}
										disabled={!canEdit}
										aria-label="Approval threshold"
									/>
								</label>
								<p class="wsp-spend__threshold-note">
									Spending at or above this becomes a request routed to an approver — it is never
									simply refused. Clear the field to let every permitted member spend up to their
									own limit unattended.
								</p>
								{props.policy.approverIds.length === 0 && threshold.value !== null && (
									<p class="wsp-create__error">
										Nobody can approve yet — give at least one member the approve-spend permission,
										or a request would have nowhere to go.
									</p>
								)}
							</div>
							{/* #endregion */}

							{/* #region Per-member envelopes */}
							<div class="wsp-spend__limits">
								<h2 class="wsp-band__title">Who may spend</h2>
								{limits.value.length === 0
									? (
										<p class="wsp-pagehead__meta">
											No members with a spend envelope yet.
										</p>
									)
									: limits.value.map((limit) => (
										<SpendLimitRow
											key={limit.memberId}
											limit={limit}
											editable={canEdit}
											editing={editingId.value === limit.memberId}
											onToggleEditing={(id) => {
												editingId.value = editingId.value === id ? null : id;
											}}
											onChange={patchLimit}
										/>
									))}
							</div>
							{/* #endregion */}

							{error.value && <p class="wsp-create__error" role="alert">{error.value}</p>}
						</div>
					</div>
				</section>

				<section
					class="wsp-band wsp-band--ledger wsp-band--tail"
					style={styleVars({ "--wsp-i": 3 })}
				>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title">Contributions and spending</h2>
							<Tooltip
								content="Every line is attributable to a person — that is what makes a shared wallet auditable"
								placement="left"
							>
								<span class="wsp-band__meta">
									<PolicyAmount
										value={props.policy.limits[0]?.spent ??
											{ minor: 0, currency: "GBP", display: "—", origin: null }}
										size="micro"
										muted
									/>
								</span>
							</Tooltip>
						</div>
						<div class="wsp-band__body">
							<ContributionLedger entries={props.policy.entries} limit={12} />
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}
