import type { JSX } from "preact";
import { batch, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "@web/features/projects/styles/fx-toolbar.css";
import "../styles/workspace.css";
import { FormControl, MoneyInput, Select } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { MetaLine } from "@projective/ui/display";
import { Icon, type IconName } from "@projective/ui/icons";
import {
	type BusinessSpendPolicy,
	canOpenVerification,
	walletHrefFor,
	type WorkspaceDetail,
	workspaceHref,
} from "@projective/types/workspace";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { publishDetail, saveState } from "../core/workspace-state.ts";
import { usePolicyBridge } from "../hooks/usePolicyBridge.ts";
import {
	APPROVERS_PICKER_ID,
	decideNotice,
	draftOf,
	draftPatch,
	fixedHint,
	gapNotice,
	grantView,
	hasPickable,
	holderNames,
	isDirty,
	limitAnchorOf,
	type LimitDraft,
	limitPatchOf,
	limitsPatch,
	mergeGrant,
	type NoticeView,
	patchSignature,
	planNotice,
	type PreviewState,
	type QueueAct,
	type QueueBusy,
	queueControlId,
	rebaseDraft,
	REQUEST_TABS,
	requestRows,
	rowView,
	type SaveRefusal,
	saveRefusal,
	settledNote,
	type SpendDraft,
	type SpendGrant,
	type SpendSection,
	thresholdDefault,
	thresholdLine,
} from "../core/spend-model.ts";
import type { WorkspaceResult } from "../types/results.ts";
import {
	isSimulatedRequest,
	simulateQueue,
	type SpendRequestsSimulation,
} from "../core/dev-spend.ts";
import { SpendLimitRow } from "../components/SpendLimitRow.tsx";
import { SpendGrantPicker } from "../components/SpendGrantPicker.tsx";
import { ApprovalQueue } from "../components/ApprovalQueue.tsx";
import { ContributionLedger } from "../components/ContributionLedger.tsx";
import { VerificationLock } from "../components/VerificationLock.tsx";

/**
 * SpendPolicyScreen — a business's Spend module (`/businesses/:h/spend`, BU2, Decision #246): who may
 * spend from the pooled wallet and how much, who signs off above that, and the requests waiting on it.
 *
 * Four sections, in the order the questions arrive, separated by space and one hairline — no boxes:
 *
 *  1. **Approval threshold** — spending at or above it needs a second person. Empty uses the platform's
 *     default. Setting one is Business Pro's (the server's `limitsPlanGated`).
 *  2. **Who can approve / who can add money** — two pickers over the members the SERVER said the viewer
 *     may change (`editableMemberIds`); the owner always can. A gap — nobody besides the owner approves —
 *     comes from the server too, and links to the picker.
 *  3. **Member limits** — each envelope in one line with a meter; edited inline, priced by the server's
 *     preview while the draft differs, never by patching a stored figure (BD2).
 *  4. **Requests** — Pending and Decided, always both. One filled Approve; the requester's own row offers
 *     Withdraw. An approver of a business still in KYB is sent to Verification instead.
 *
 * **Render from the server.** What the viewer may do is `viewerCan` and the spend block's flags (BB9 +
 * #246); this island holds a draft, compares it with what was saved, and words it — no policy maths.
 *
 * **Save and Discard are the footer rig's**, answered here through `usePolicyBridge`, so there is one
 * Save on the surface. Only the keys that moved travel, and only for rows the viewer may change; after
 * a decision or a withdrawal the envelopes are re-read with the reader's own edits kept (BD3). Discard
 * returns the draft to the last saved policy.
 */

export interface SpendPolicyScreenProps {
	workspace: WorkspaceDetail;
	policy: BusinessSpendPolicy;
}

/** The Requests panel's id (the view toolbar's `aria-controls`). */
const PANEL_ID = "wsp-requests-panel";
/** The Requests views, as the toolbar's bare `Select` names them. */
const REQUEST_VIEW_OPTIONS = [
	{ value: "pending", label: "Pending" },
	{ value: "decided", label: "Decided" },
];
/** The MetaLine under the threshold field — part of the field's description. */
const THRESHOLD_DEFAULT_ID = "wsp-spend-threshold-default";
/** How long a limits draft rests before it is priced. */
const PREVIEW_DELAY_MS = 300;

/** A notice as the surface draws it: InlineNotice, its fact, then a tier-4 link or the ask. */
function Notice(
	props: { notice: NoticeView; icon: IconName; onLink?: (event: MouseEvent) => void },
): JSX.Element {
	const { notice } = props;
	return (
		<div class="wsp-spend__notice">
			<InlineNotice align="start" icon={<Icon name={props.icon} />} text={notice.sentence} />
			{notice.meta && <MetaLine items={[notice.meta]} />}
			{notice.link && (
				<a
					class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md wsp-spend__notice-link"
					href={notice.link.href}
					onClick={props.onLink}
				>
					<span class="ui-button__label">{notice.link.label}</span>
				</a>
			)}
			{notice.ask && <MetaLine items={[notice.ask]} />}
		</div>
	);
}

export default function SpendPolicyScreen(props: SpendPolicyScreenProps): JSX.Element {
	const ws = props.workspace;
	const viewerCan = ws.viewerCan;
	const editPolicy = viewerCan?.editPolicy === true;
	const viewer = ws.members.find((m) => m.id === ws.viewerMemberId);
	const viewerIsOwner = viewer?.rolePreset === "owner";

	// #region State
	/** The last SAVED policy — replaced by every save, decision and withdrawal. */
	const saved = useSignal<BusinessSpendPolicy>(props.policy);
	const seed = draftOf(props.policy);
	const threshold = useSignal<number | null>(seed.thresholdMinor);
	/** The pickers' values — only the rows the viewer may change; the rest stay as saved. */
	const approverPick = useSignal<string | string[]>(
		seed.approverIds.filter((id) => props.policy.editableMemberIds.includes(id)),
	);
	const contributorPick = useSignal<string | string[]>(
		seed.contributorIds.filter((id) => props.policy.editableMemberIds.includes(id)),
	);
	const limitDrafts = useSignal<Record<string, LimitDraft>>({ ...seed.limits });
	const editingId = useSignal<string | null>(null);

	const preview = useSignal<PreviewState | null>(null);
	const previewFailed = useSignal(false);
	const previewSeq = useRef(0);
	const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	/** The queue write in flight — which request, and which of its controls was pressed. */
	const busy = useSignal<QueueBusy | null>(null);
	/** This island's own save is in flight (the shared `saveState` is the footer rig's to read). */
	const saving = useSignal(false);
	/** Save was pressed while a queue write flew: it runs once that write has been adopted. */
	const saveAfterQueue = useRef(false);
	const saveError = useSignal<SaveRefusal | null>(null);
	const queueError = useSignal<string | null>(null);
	const planRefused = useSignal(false);
	const announce = useSignal("");
	/** The Requests view the toolbar shows — `pending` or `decided` (`REQUEST_TABS`). */
	const requestView = useSignal<string>("pending");
	const panelRef = useRef<HTMLDivElement>(null);
	const sim = useSignal<SpendRequestsSimulation | undefined>(undefined);

	const picks = (pick: string | string[]): string[] => Array.isArray(pick) ? pick : [pick];
	/** The draft as the save would read it. */
	const draft = useComputed<SpendDraft>(() => ({
		thresholdMinor: threshold.value,
		approverIds: mergeGrant(
			saved.value.approverIds,
			saved.value.editableMemberIds,
			picks(approverPick.value),
		),
		contributorIds: mergeGrant(
			saved.value.contributorIds,
			saved.value.editableMemberIds,
			picks(contributorPick.value),
		),
		limits: limitDrafts.value,
	}));
	const dirty = useComputed(() => isDirty(saved.value, draft.value));
	const signature = useComputed(() => patchSignature(limitsPatch(saved.value, draft.value)));
	const queue = useComputed(() =>
		simulateQueue(saved.value, sim.value, {
			memberId: ws.viewerMemberId,
			name: viewer?.name ?? "You",
		})
	);
	// #endregion

	// #region Effects
	// The Dev Context Switcher's queue simulation — an external subscription (development only).
	useEffect(() => {
		sim.value = readDevSeam()?.spendRequests;
		return subscribeDevSeam((s) => {
			sim.value = s?.spendRequests;
		});
	}, []);

	// A deep link to one member's limits row (`#limit-<handle>` — the Members drawer's "Edit in Spend")
	// lands on it: scrolled into view and focused once the rows are on the page (an external DOM act).
	useEffect(() => {
		const id = limitAnchorOf(globalThis.location?.hash ?? "");
		const row = id ? globalThis.document.getElementById(id) : null;
		if (!row) return;
		row.scrollIntoView({ block: "center" });
		row.focus({ preventScroll: true });
	}, []);

	// The footer rig's Save and Discard are pulses, not callbacks: `usePolicyBridge` publishes this
	// island's dirtiness to the rig and answers a press made after this island mounted.
	usePolicyBridge({ dirty, save, discard });
	// #endregion

	// #region The draft
	/**
	 * Adopt a saved policy, rebasing the draft onto it (`rebaseDraft`): every key the reader changed
	 * since `before` stays theirs, everything else re-reads. `before` is the saved policy's draft for a
	 * re-read they did not make (a decision, a withdrawal — BD3), or the draft a save sent, so what was
	 * typed while the save was on its way survives its answer.
	 */
	function adopt(next: BusinessSpendPolicy, before: SpendDraft): void {
		const merged = rebaseDraft(before, next, draft.peek());
		const editable = new Set(next.editableMemberIds);
		batch(() => {
			saved.value = next;
			threshold.value = merged.thresholdMinor;
			approverPick.value = merged.approverIds.filter((id) => editable.has(id));
			contributorPick.value = merged.contributorIds.filter((id) => editable.has(id));
			limitDrafts.value = { ...merged.limits };
			preview.value = null;
			previewFailed.value = false;
		});
		schedulePreview();
	}

	/**
	 * The footer rig's Discard: the threshold, both pickers and every envelope return to the last saved
	 * policy, the open row closes and the save refusal goes; `schedulePreview` then drops the price of a
	 * draft that no longer differs.
	 */
	function discard(): void {
		const base = draftOf(saved.peek());
		const editable = new Set(saved.peek().editableMemberIds);
		batch(() => {
			threshold.value = base.thresholdMinor;
			approverPick.value = base.approverIds.filter((id) => editable.has(id));
			contributorPick.value = base.contributorIds.filter((id) => editable.has(id));
			limitDrafts.value = { ...base.limits };
			editingId.value = null;
			saveError.value = null;
		});
		schedulePreview();
	}

	/** The limits draft's signature as it stands now — what a preview answer must still match. */
	function currentSignature(): string {
		return patchSignature(limitsPatch(saved.peek(), draft.peek()));
	}

	/**
	 * Price the limits draft (`POST /api/workspace/spend/preview`) once it has rested. Every call
	 * supersedes a request already in flight — returning to a draft that is already priced included, or
	 * that request's later answer would replace the price on screen with another draft's and leave the
	 * rows on "Pricing the change…" — and an answer is kept only while the draft is still the one it
	 * priced.
	 */
	function schedulePreview(): void {
		clearTimeout(previewTimer.current);
		previewSeq.current++;
		const patch = limitsPatch(saved.peek(), draft.peek());
		if (patch.length === 0) {
			preview.value = null;
			previewFailed.value = false;
			return;
		}
		const key = patchSignature(patch);
		previewFailed.value = false;
		if (preview.peek()?.signature === key) return;
		previewTimer.current = setTimeout(async () => {
			const mine = ++previewSeq.current;
			const res = await WorkspaceService.previewSpend({
				workspaceId: ws.id,
				currency: saved.peek().currency,
				limits: patch,
			});
			if (mine !== previewSeq.current || key !== currentSignature()) return;
			if (!res.ok || !res.data) {
				previewFailed.value = true;
				return;
			}
			preview.value = {
				signature: key,
				limits: Object.fromEntries(res.data.limits.map((l) => [l.memberId, l])),
			};
		}, PREVIEW_DELAY_MS);
	}

	function setLimitDraft(memberId: string, next: LimitDraft): void {
		limitDrafts.value = { ...limitDrafts.peek(), [memberId]: next };
		saveError.value = null;
		schedulePreview();
	}

	function setPick(grant: SpendGrant, picked: string[]): void {
		if (grant === "approve_spend") approverPick.value = picked;
		else contributorPick.value = picked;
		saveError.value = null;
	}
	// #endregion

	// #region Writes
	/**
	 * One write at a time across the whole module — a save, a decision, a withdrawal — so two answers can
	 * never be adopted out of order (a decision's re-read landing after a save's would show the pre-save
	 * policy as saved). A save pressed while a queue write flies runs once that write is adopted; the
	 * queue's controls are disabled while a save flies.
	 */
	async function save(): Promise<void> {
		if (saving.peek()) return;
		if (busy.peek() !== null) {
			saveAfterQueue.current = true;
			return;
		}
		const sent = draft.peek();
		const patch = draftPatch(ws.id, saved.peek(), sent);
		if (!patch) return;
		if (
			patch.approvalThresholdMinor !== undefined && patch.approvalThresholdMinor !== null &&
			patch.approvalThresholdMinor < 1
		) {
			saveState.value = "error";
			saveError.value = {
				section: "threshold",
				field: "threshold",
				memberId: null,
				text: "A threshold is more than zero. Clear it to use the platform's default.",
			};
			return;
		}
		saving.value = true;
		saveState.value = "saving";
		saveError.value = null;
		const res = await WorkspaceService.updateSpend(patch);
		saving.value = false;
		if (!res.ok || !res.data) {
			saveState.value = "error";
			if (res.details?.reason === "entitlement") {
				planRefused.value = true;
				announce.value = "Not saved. Spending limits and a threshold are part of Business Pro.";
				return;
			}
			const refusal = saveRefusal(patch, res);
			saveError.value = refusal;
			// A refusal that names a limits row opens that row, so the reader sees which one it means.
			if (refusal.memberId && saved.peek().editableMemberIds.includes(refusal.memberId)) {
				editingId.value = refusal.memberId;
			}
			return;
		}
		publishDetail(res.data);
		if (res.data.spend) {
			const next = res.data.spend;
			adopt(next, sent);
			// The open editor closes once its row is saved; a row edited while the save flew stays open.
			const open = editingId.peek();
			const row = next.limits.find((l) => l.memberId === open);
			const mine = open ? limitDrafts.peek()[open] : undefined;
			if (!row || !mine || limitPatchOf(row, mine) === null) editingId.value = null;
		} else {
			editingId.value = null;
		}
		planRefused.value = false;
		saveState.value = "saved";
		announce.value = "Spend policy saved.";
	}

	/**
	 * After a decision or a withdrawal: re-read, keep the reader's edits, say what the server left the
	 * request as (`settledNote` — a lapsed one reads expired, whichever control was pressed), and hand
	 * focus to the queue.
	 */
	function settle(detail: WorkspaceDetail, requestId: string, act: QueueAct): void {
		publishDetail(detail);
		if (detail.spend) adopt(detail.spend, draftOf(saved.peek()));
		announce.value = settledNote(detail.spend, requestId, act);
		// Focus after the re-render that removed the control which had it (#243 (t)).
		setTimeout(() => panelRef.current?.focus(), 0);
	}

	/**
	 * One queue write at a time, and never beside a save (see {@link save}): while a decision or a
	 * withdrawal is in flight every row's controls are disabled (ApprovalQueue) and only the pressed one
	 * shows that it is working. A refusal hands focus back to the pressed control — disabling it while it
	 * flew dropped focus to the page.
	 */
	async function queueWrite(
		requestId: string,
		act: QueueAct,
		write: () => Promise<WorkspaceResult<WorkspaceDetail>>,
		failed: string,
	): Promise<void> {
		if (busy.peek() !== null || saving.peek()) return;
		busy.value = { id: requestId, act };
		queueError.value = null;
		const res = await write();
		busy.value = null;
		if (res.ok && res.data) {
			settle(res.data, requestId, act);
		} else {
			queueError.value = res.message ?? failed;
			setTimeout(() => {
				(document.getElementById(queueControlId(requestId, act)) ?? panelRef.current)?.focus();
			}, 0);
		}
		if (saveAfterQueue.current) {
			saveAfterQueue.current = false;
			void save();
		}
	}

	function decide(requestId: string, approve: boolean): Promise<void> {
		return queueWrite(
			requestId,
			approve ? "approve" : "decline",
			() => WorkspaceService.decideSpend({ workspaceId: ws.id, requestId, approve }),
			"Couldn't record that decision.",
		);
	}

	function withdraw(requestId: string): Promise<void> {
		return queueWrite(
			requestId,
			"withdraw",
			() => WorkspaceService.withdrawSpend({ workspaceId: ws.id, requestId }),
			"Couldn't withdraw that request.",
		);
	}

	/** "Choose approvers": land on the picker and put focus in its list. */
	function toPicker(event: MouseEvent): void {
		const host = document.getElementById(APPROVERS_PICKER_ID);
		if (!host) return;
		event.preventDefault();
		host.scrollIntoView({ block: "center" });
		host.querySelector<HTMLElement>('[role="listbox"]')?.focus();
	}
	// #endregion

	// #region Derived view
	const policy = saved.value;
	const currency = policy.currency;
	const caps = ws.viewerCapabilities;
	const canDecide = viewerCan?.decide === true && !queue.value.undecidable;
	const editable = new Set(policy.editableMemberIds);
	const grant = (which: SpendGrant) => {
		const view = grantView(
			ws.members,
			policy,
			which === "approve_spend" ? draft.value.approverIds : draft.value.contributorIds,
			which,
			{ memberId: ws.viewerMemberId, capabilities: caps },
		);
		return { view, hint: fixedHint(view.fixed, which) };
	};
	const approvers = grant("approve_spend");
	const contributors = grant("contribute_funds");
	const plan = planNotice({
		gated: policy.limitsPlanGated || planRefused.value,
		editPolicy,
		business: ws.name,
		viewerIsOwner,
	});
	const gap = gapNotice({
		approverGap: policy.approverGap,
		editPolicy,
		viewerIsOwner,
		pickable: hasPickable(approvers.view),
	});
	const kyb = decideNotice({
		kind: ws.kind,
		handle: ws.handle,
		business: ws.name,
		capabilities: caps,
		canDecide,
		kybStatus: ws.kyb?.status ?? policy.verification,
	});
	const approvals = queue.value.approvals;
	const rows = requestRows(approvals.pending, { memberId: ws.viewerMemberId, canDecide });
	const onlyOwn = policy.limits.length > 0 &&
		policy.limits.every((l) => l.memberId === ws.viewerMemberId);
	const thresholdLocked = policy.limitsPlanGated && policy.approvalThresholdMinor === null;
	/** The KYB lock band draws until verified; the bands below it stagger in after it. */
	const lockShown = policy.verification !== "verified";
	const refusal = saveError.value;
	/**
	 * A refused save that names no field, said at the top of the section it concerns — a limits row it
	 * names by that member's name (the row is opened too).
	 */
	const sectionRefusal = (section: SpendSection) => {
		if (!refusal || refusal.section !== section || refusal.field !== null) return null;
		const row = refusal.memberId
			? policy.limits.find((l) => l.memberId === refusal.memberId)
			: undefined;
		const text = row ? `${row.name}'s limit: ${refusal.text}` : refusal.text;
		return <InlineNotice align="start" assertive text={text} />;
	};
	const fieldRefusal = (field: NonNullable<SaveRefusal["field"]>) =>
		refusal?.field === field ? refusal.text : undefined;
	const thresholdError = fieldRefusal("threshold");
	// #endregion

	return (
		<div class="wsp" data-kind="business">
			<div class="wsp__stack">

				{
					/*
					 * The KYB lock: rendered and actionable, never hidden. Configuration below stays editable —
					 * only moving money waits on verification.
					 */
				}
				<VerificationLock
					kind={ws.kind}
					verification={policy.verification}
					prompt={policy.verificationPrompt}
					href={workspaceHref(ws.kind, ws.handle, "verification")}
					canManage={canOpenVerification(ws.kind, caps)}
					tone="band"
					i={1}
				/>

				<section class="wsp-band wsp-band--money" data-i={lockShown ? 2 : 1}>
					<div class="wsp-band__inner">
						<div class="wsp-spend">
							{/* #region 1. Approval threshold */}
							<section class="wsp-spend__section" aria-labelledby="wsp-spend-threshold">
								<h2 class="wsp-band__title" id="wsp-spend-threshold">Approval threshold</h2>
								<p class="wsp-spend__lede">
									Spending at or above this becomes a request for an approver. It is never simply
									refused.
								</p>
								{plan && <Notice notice={plan} icon="lock" />}
								{sectionRefusal("threshold")}
								{editPolicy
									? (
										<div class="wsp-spend__threshold">
											<FormControl
												label="Threshold"
												hint={thresholdLocked ? "Setting one is part of Business Pro." : undefined}
												hintMode="inline"
												error={thresholdError}
												status={thresholdError ? "invalid" : "default"}
												collapseHint={!thresholdLocked}
											>
												{({ id, describedBy, status }) => (
													<MoneyInput
														id={id}
														value={threshold}
														currency={currency}
														min={1}
														fluid
														status={status}
														disabled={thresholdLocked}
														aria-describedby={describedBy
															? `${describedBy} ${THRESHOLD_DEFAULT_ID}`
															: THRESHOLD_DEFAULT_ID}
														onValueChange={() => {
															saveError.value = null;
														}}
													/>
												)}
											</FormControl>
											<p class="wsp-spend__threshold-default" id={THRESHOLD_DEFAULT_ID}>
												<MetaLine as="span" items={thresholdDefault(policy)} />
											</p>
										</div>
									)
									: <MetaLine items={thresholdLine(policy)} />}
							</section>
							{/* #endregion */}

							{/* #region 2. Who can approve · who can add money */}
							<section class="wsp-spend__section" aria-labelledby="wsp-spend-grants">
								<h2 class="wsp-band__title" id="wsp-spend-grants">Approvers and contributors</h2>
								{gap && <Notice notice={gap} icon="info" onLink={toPicker} />}
								{sectionRefusal("grants")}
								<div class="wsp-spend__approvers">
									<SpendGrantPicker
										id={APPROVERS_PICKER_ID}
										label="Who can approve"
										editable={editPolicy}
										view={approvers.view}
										hint={approvers.hint}
										error={fieldRefusal("approvers")}
										value={approverPick}
										holders={holderNames(ws.members, policy.approverIds, ws.viewerMemberId)}
										onPick={(picked) => setPick("approve_spend", picked)}
									/>
									<SpendGrantPicker
										id="wsp-spend-contributors"
										label="Who can add money"
										editable={editPolicy}
										view={contributors.view}
										hint={contributors.hint}
										error={fieldRefusal("contributors")}
										value={contributorPick}
										holders={holderNames(ws.members, policy.contributorIds, ws.viewerMemberId)}
										onPick={(picked) => setPick("contribute_funds", picked)}
									/>
								</div>
							</section>
							{/* #endregion */}

							{/* #region 3. Member limits */}
							<section class="wsp-spend__section" aria-labelledby="wsp-spend-limits">
								<h2 class="wsp-band__title" id="wsp-spend-limits">
									{onlyOwn ? "Your spending limit" : "Member limits"}
								</h2>
								{sectionRefusal("limits")}
								{policy.limits.length === 0
									? <MetaLine items={["Nobody here can spend from this wallet yet"]} />
									: (
										<ul class="wsp-spend__limits">
											{policy.limits.map((limit) => (
												<SpendLimitRow
													key={limit.memberId}
													limit={limit}
													view={rowView(
														limit,
														limitDrafts.value[limit.memberId],
														preview.value,
														signature.value,
													)}
													previewFailed={previewFailed.value}
													currency={currency}
													isSelf={limit.memberId === ws.viewerMemberId}
													editable={editPolicy && editable.has(limit.memberId)}
													editing={editingId.value === limit.memberId}
													onToggleEditing={(id) => {
														editingId.value = editingId.value === id ? null : id;
													}}
													draft={limitDrafts.value[limit.memberId]}
													onDraft={setLimitDraft}
													plansGated={policy.limitsPlanGated}
													canGrantSpend={caps.includes("spend_funds")}
												/>
											))}
										</ul>
									)}
							</section>
							{/* #endregion */}

							{/* #region 4. Requests */}
							<section class="wsp-spend__section" aria-labelledby="wsp-spend-requests">
								<h2 class="wsp-band__title" id="wsp-spend-requests">Requests</h2>
								{kyb && <Notice notice={kyb} icon="shield" />}
								{
									/* The views are the shared fx-toolbar's bare Select, with no count in the bar
									   (Decision #307); the lane's Spend row still counts what waits. */
								}
								<div
									class="fx-toolbar wsp-requests__toolbar"
									role="toolbar"
									aria-label="Spend requests"
									aria-controls={PANEL_ID}
								>
									<Select
										class="ui-field--bare wsp-requests__view"
										size="sm"
										aria-label="Show requests"
										options={REQUEST_VIEW_OPTIONS}
										value={requestView}
									/>
								</div>
								<div
									id={PANEL_ID}
									ref={panelRef}
									role="region"
									class="wsp-requests__panel"
									tabIndex={-1}
									aria-label={`${
										REQUEST_VIEW_OPTIONS.find((o) => o.value === requestView.value)?.label ??
											"Pending"
									} requests`}
								>
									<ApprovalQueue
										view={REQUEST_TABS.find((t) => t === requestView.value) ?? "pending"}
										rows={rows}
										decided={approvals.decided}
										busy={busy.value}
										locked={saving.value}
										onDecide={(id, approve) => void decide(id, approve)}
										onWithdraw={(id) => void withdraw(id)}
										isSimulated={isSimulatedRequest}
									/>
								</div>
								{queueError.value && (
									<InlineNotice align="start" assertive text={queueError.value} />
								)}
								<p class="wsp-spend__foot">
									<a
										class="wsp-moneyhead__link"
										href={walletHrefFor("business", ws.id, "access")}
									>
										Open in the wallet
									</a>
								</p>
							</section>
							{/* #endregion */}

							<p class="ui-visually-hidden" role="status">{announce.value}</p>
						</div>
					</div>
				</section>

				<section class="wsp-band wsp-band--ledger wsp-band--tail" data-i={lockShown ? 3 : 2}>
					<div class="wsp-band__inner">
						<div class="wsp-band__head">
							<h2 class="wsp-band__title">Contributions and spending</h2>
							<MetaLine items={[`${currency} wallet`, "every line names who did it"]} />
						</div>
						<div class="wsp-band__body">
							<ContributionLedger entries={policy.entries} owner={ws.name} limit={12} />
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}
