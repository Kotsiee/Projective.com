import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import { MetaLine } from "@projective/ui/display";
import { ConfirmDialog, InlineNotice, ProgressBar } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import type { ProposalAllowanceStatus } from "@projective/types/finance";
import type { SentApplication } from "@projective/types/projects";
import { type WorkspaceDetail, workspaceHref } from "@projective/types/workspace";
import { AllowanceService } from "@features/proposals/core/AllowanceService.ts";
import { simulated, withdrawProposal } from "@features/proposals/core/allowance-state.ts";
import { openInvite, publishDetail, viewOr } from "../core/workspace-state.ts";
import {
	PROJECTS_PROPOSALS,
	SUB_VIEW_PANEL_ID,
	subViewLabel,
	subViewsFor,
} from "../core/sub-views.ts";
import { cx } from "@ui/core/cx.ts";
import {
	allowanceBand,
	type AllowanceBandModel,
	bandGated,
	engagementRow,
	engagementsSummary,
	FIND_PROJECTS_HREF,
	focusAfterWithdraw,
	type ProposalRowModel,
	proposalsSummary,
	teamProposals,
	withdrawConfirmMessage,
} from "../core/projects-model.ts";
import { EngagementRow } from "../components/EngagementRow.tsx";
import InviteModal from "./InviteModal.island.tsx";

/**
 * TeamProjectsScreen — a team console's Projects module, `/teams/:teamHandle/projects` (Teams work
 * order C5; Decisions #154, #214, #233). Top to bottom:
 *
 *   - **The allowance band** — "Proposals this week": the weekly units used against the week's grant on
 *     a ui `ProgressBar`, the buffer and the refill day as a `MetaLine`, and, beside it, every gate that
 *     stands in the way: unpublished (an `InlineNotice` and a tier-4 link to Settings), under two members
 *     (an `InlineNotice` and the tier-2 Invite member — the band's one filled control), a viewer who may
 *     not bind the team (Meta "Ask a lead to apply for the team"). A solid `--surface-1` band, never a
 *     card; with no gate the meter takes the band's full width.
 *   - **Active** (the default view) — one `EngagementRow` per live stage assignment, with each assignee's
 *     Wᵢ on the stage against its cap.
 *   - **Proposals** (`?view=proposals`) — the team's pending applications, each with the tier-5
 *     Withdraw for its filer or a `bind_seat` holder (Decision #154).
 *
 * The two views are the header band's view toolbar (L2's sub-view registry, Decision #307); this
 * island is the one region it controls and only READS the shared sub-view state. Every rule — the gate, the filled-control count,
 * the rows, who may withdraw — is `projects-model.ts`, pinned by its unit test; nothing here guesses a
 * fact the read did not answer. The engagements and the allowance arrive with the console's one read
 * (`org.get_workspace_detail`, B7 / Decision #233); the proposals are read on first opening their view,
 * through the same list `/projects` shows ("Your proposals"), narrowed to this team.
 *
 * Teams only — `ModuleScreen` sends a business's Projects to its hand-off (Decision #61).
 */

export interface TeamProjectsScreenProps {
	workspace: WorkspaceDetail;
	/** The resolved `?view=` sub-view — `active` or `proposals`. */
	view?: string | null;
}

/** What the result line under the proposals says after a withdrawal. */
interface WithdrawNotice {
	ok: boolean;
	text: string;
}

export default function TeamProjectsScreen(props: TeamProjectsScreenProps): JSX.Element {
	// #region State
	const detail = useSignal<WorkspaceDetail>(props.workspace);
	/** The team's allowance — the read's, then re-read after a withdrawal returns a unit. */
	const allowance = useSignal<ProposalAllowanceStatus | null>(props.workspace.allowance);
	/** The team's sent proposals; `null` until their view is first opened. */
	const proposals = useSignal<readonly SentApplication[] | null>(null);
	const proposalsError = useSignal<string | null>(null);
	const loadingProposals = useSignal(false);
	/** The row whose Withdraw is being confirmed. */
	const withdrawFor = useSignal<ProposalRowModel | null>(null);
	const confirmOpen = useSignal(false);
	/** The id of the proposal being withdrawn. */
	const withdrawing = useSignal<string | null>(null);
	const withdrawNotice = useSignal<WithdrawNotice | null>(null);

	// Publish the SSR detail so the lane, header band and footer rig read ONE projection.
	useEffect(() => {
		publishDetail(props.workspace);
	}, [props.workspace.id]);

	// The proposals are read the first time their view opens — on load for `?view=proposals`, or when
	// the header band's tab picks it.
	useSignalEffect(() => {
		if (viewOr(props.view ?? null) !== PROJECTS_PROPOSALS) return;
		if (proposals.peek() === null && !loadingProposals.peek()) void loadProposals();
	});
	// #endregion

	// #region Actions
	/** Read the proposals filed for this team. */
	async function loadProposals(): Promise<void> {
		loadingProposals.value = true;
		const res = await AllowanceService.sent({ team: detail.peek().id });
		loadingProposals.value = false;
		if (res.ok && res.data) {
			proposals.value = res.data;
			proposalsError.value = null;
		} else {
			proposalsError.value = res.message ?? "The team's proposals couldn't be read just now.";
		}
	}

	/** Replace the projection from a server response (an invitation sent), and republish it. */
	function adopt(next: WorkspaceDetail): void {
		detail.value = next;
		publishDetail(next);
		if (next.allowance) allowance.value = next.allowance;
	}

	/** Ask before withdrawing — re-applying spends the anti-burst token again. */
	function askWithdraw(row: ProposalRowModel): void {
		withdrawNotice.value = null;
		withdrawFor.value = row;
		confirmOpen.value = true;
	}

	/**
	 * Withdraw the confirmed proposal through the shared store (which moves the header popover's meter
	 * too), then re-read this team's allowance so the band shows the returned weekly unit. Keyboard
	 * focus is placed where it can stay: back on the row's Withdraw after a refusal, and on the next
	 * row's Withdraw (or the list's heading) once the withdrawn row has left the list.
	 */
	async function withdraw(): Promise<void> {
		const row = withdrawFor.peek();
		if (!row) return;
		const before = teamProposals(proposals.peek() ?? [], detail.peek().id);
		withdrawing.value = row.id;
		const result = await withdrawProposal(row.id);
		withdrawing.value = null;
		withdrawFor.value = null;
		if (!result.ok) {
			withdrawNotice.value = { ok: false, text: result.message };
			focusWhenLive(() => withdrawButton(row.id));
			return;
		}
		proposals.value = (proposals.peek() ?? []).map((r) =>
			r.id === row.id ? { ...r, status: "withdrawn", canWithdraw: false } : r
		);
		withdrawNotice.value = { ok: true, text: result.message };
		const next = focusAfterWithdraw(before, row.id);
		focusWhenLive(() =>
			(next ? withdrawButton(next) : null) ?? document.getElementById(PROPOSALS_TITLE_ID)
		);
		const read = await AllowanceService.status({ teamId: detail.peek().id });
		if (read.ok && read.status) allowance.value = read.status;
	}
	// #endregion

	// #region The model
	const ws = detail.value;
	const held = new Set(ws.viewerCapabilities);
	const canInvite = held.has("invite_members");
	const shown = simulated(allowance.value ? { status: allowance.value, receivedAt: 0 } : null);
	const band = allowanceBand({
		allowance: shown?.status ?? null,
		canInvite,
		canOpenSettings: held.has("manage_settings"),
		canRestore: held.has("archive_entity"),
		settingsHref: workspaceHref(ws.kind, ws.handle, "settings"),
	});

	const views = subViewsFor("projects", ws.kind, ws.viewerCapabilities);
	const view = viewOr(props.view ?? null);
	const panel = views.length > 0
		? {
			id: SUB_VIEW_PANEL_ID,
			role: "region" as const,
			"aria-label": subViewLabel(views, view),
		}
		: {};
	const onProposals = view === PROJECTS_PROPOSALS;
	// #endregion

	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack">
				<AllowanceBand band={band} onInvite={() => openInvite()} />

				{onProposals
					? (
						<section class="wsp-band wsp-band--plain wsp-band--tail" data-i={1} {...panel}>
							<div class="wsp-band__inner">
								<ProposalsView
									rows={proposals.value ? teamProposals(proposals.value, ws.id) : null}
									error={proposalsError.value}
									loading={loadingProposals.value}
									withdrawing={withdrawing.value}
									notice={withdrawNotice.value}
									onRetry={() => void loadProposals()}
									onWithdraw={askWithdraw}
								/>
							</div>
						</section>
					)
					: (
						<section class="wsp-band wsp-band--plain wsp-band--tail" data-i={1} {...panel}>
							<div class="wsp-band__inner">
								<ActiveView workspace={ws} />
							</div>
						</section>
					)}
			</div>

			{/* #region Overlays */}
			<ConfirmDialog
				visible={confirmOpen}
				header="Withdraw this proposal?"
				message={withdrawFor.value ? withdrawConfirmMessage(withdrawFor.value) : ""}
				acceptLabel="Withdraw"
				rejectLabel="Keep it"
				acceptSeverity="danger"
				onAccept={() => void withdraw()}
			/>
			{canInvite && <InviteModal workspace={ws} onUpdated={adopt} />}
			{/* #endregion */}
		</div>
	);
}

// #region Focus after a withdrawal
/** The proposals list's heading — focus's last resort once no row is left to take it. */
const PROPOSALS_TITLE_ID = "wsp-proposals-title";
/** How often a pending focus move is retried while the closing confirm still holds the page. */
const FOCUS_RETRY_MS = 50;
/** How many times — about a second in a painted tab. */
const FOCUS_RETRIES = 20;

/** A row's Withdraw button, by the row's proposal id. */
function withdrawButton(id: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		`[data-proposal="${CSS.escape(id)}"] .wsp-proposals__action:not([disabled])`,
	);
}

/**
 * Whether keyboard focus has nowhere to be: on the body, on a node that left the page or went
 * disabled, inside an `inert` page, or still in the closing confirm.
 */
function focusLost(): boolean {
	const active = document.activeElement as HTMLElement | null;
	return !active || active === document.body || !active.isConnected ||
		(active as HTMLButtonElement).disabled === true || active.closest("[inert]") !== null ||
		active.closest('[role="alertdialog"]') !== null;
}

/**
 * Move focus to `pick()`'s element once the page is live again. The confirm's focus trap keeps the
 * page `inert` until its exit ends and then hands focus back to the Withdraw that opened it — disabled
 * while its request runs, gone once the withdrawal lands — so without this focus falls to the body.
 * Retried on a timer (a hidden tab never paints a frame), and only while focus is lost: a reader who
 * has already moved on keeps their place.
 */
function focusWhenLive(pick: () => HTMLElement | null): void {
	const attempt = (left: number) => {
		if (!focusLost()) return;
		const target = pick();
		if (target && target.closest("[inert]") === null) {
			target.focus();
			if (document.activeElement === target) return;
		}
		if (left > 0) setTimeout(() => attempt(left - 1), FOCUS_RETRY_MS);
	};
	setTimeout(() => attempt(FOCUS_RETRIES), 0);
}
// #endregion

// #region The allowance band
/**
 * The band: the weekly meter, beside the gate when one applies (the meter alone takes the full width).
 * Its one filled control, when there is one, is the tier-2 Invite member; the Settings fix is a tier-4
 * outlined link; the viewer's own limit is Meta text.
 */
function AllowanceBand(
	{ band, onInvite }: { band: AllowanceBandModel; onInvite: () => void },
): JSX.Element {
	const { gate, meter } = band;
	const gated = bandGated(gate);
	return (
		<section
			class="wsp-band wsp-band--allowance"
			data-i={0}
			aria-labelledby="wsp-allowance-title"
		>
			<div class={cx("wsp-band__inner", "wsp-allowance", gated && "wsp-allowance--gated")}>
				<div class="wsp-allowance__meter">
					<div class="wsp-allowance__head">
						<h2 class="wsp-band__title" id="wsp-allowance-title">{band.title}</h2>
						{meter && <p class="wsp-allowance__figure" aria-hidden="true">{meter.figure}</p>}
					</div>
					{meter
						? (
							<>
								<ProgressBar
									class="wsp-allowance__bar"
									value={meter.percent}
									aria-label={meter.label}
								/>
								<MetaLine
									as="p"
									size="xs"
									items={band.meta.map((text) => ({ text, tabular: true }))}
								/>
							</>
						)
						: (
							<InlineNotice
								class="wsp-allowance__notice"
								align="start"
								text={band.unavailable ?? ""}
							/>
						)}
				</div>

				{gated && (
					<div class="wsp-allowance__gate">
						{gate.items.map((item) => (
							<div key={item.reason} class="wsp-allowance__item">
								<InlineNotice class="wsp-allowance__notice" align="start" text={item.notice} />
								{item.action?.key === "settings" && (
									<a
										class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm wsp-allowance__link"
										href={item.action.href}
									>
										<span class="ui-button__label">{item.action.label}</span>
									</a>
								)}
								{item.action?.key === "invite" && (
									<Button structural size="sm" label={item.action.label} onClick={onInvite} />
								)}
							</div>
						))}
						{gate.viewerNote && <MetaLine as="p" items={[gate.viewerNote]} />}
					</div>
				)}
			</div>
		</section>
	);
}
// #endregion

// #region Active
/** The team's live engagements, one row per stage assignment; an empty state with a way to find work. */
function ActiveView({ workspace }: { workspace: WorkspaceDetail }): JSX.Element {
	const rows = workspace.engagements.map(engagementRow);
	const facts = engagementsSummary(workspace.engagements);
	return (
		<>
			<div class="wsp-band__head">
				<h2 class="wsp-band__title" id="wsp-engagements-title">Live engagements</h2>
				{facts.length > 0 && (
					<MetaLine as="span" items={facts.map((text) => ({ text, tabular: true }))} />
				)}
			</div>
			<div class="wsp-band__body">
				{rows.length === 0
					? (
						<EmptyView
							text={`${workspace.name} isn't seated on a stage yet — accepted work appears here, with who holds its tickets.`}
						/>
					)
					: (
						<ul class="wsp-engagements" aria-labelledby="wsp-engagements-title">
							{rows.map((row) => <EngagementRow key={row.key} row={row} />)}
						</ul>
					)}
			</div>
		</>
	);
}
// #endregion

// #region Proposals
interface ProposalsViewProps {
	/** The team's pending proposals; `null` while the first read is outstanding. */
	rows: ProposalRowModel[] | null;
	error: string | null;
	loading: boolean;
	/** The id of the proposal being withdrawn. */
	withdrawing: string | null;
	notice: WithdrawNotice | null;
	onRetry: () => void;
	onWithdraw: (row: ProposalRowModel) => void;
}

/** The team's proposals awaiting a client's answer, each with its one row action. */
function ProposalsView(props: ProposalsViewProps): JSX.Element {
	const { rows } = props;
	const facts = rows ? proposalsSummary(rows) : [];
	return (
		<>
			<div class="wsp-band__head">
				<h2 class="wsp-band__title" id={PROPOSALS_TITLE_ID} tabIndex={-1}>Awaiting a reply</h2>
				{facts.length > 0 && (
					<MetaLine as="span" items={facts.map((text) => ({ text, tabular: true }))} />
				)}
			</div>
			<div class="wsp-band__body">
				{props.error
					? (
						<InlineNotice
							class="wsp-proposals__notice"
							align="start"
							text={props.error}
							actionLabel="Try again"
							onAction={props.onRetry}
							busy={props.loading}
						/>
					)
					: rows === null
					? (
						<InlineNotice
							class="wsp-proposals__notice"
							align="start"
							text="Reading the team's proposals…"
							busy
						/>
					)
					: rows.length === 0
					? (
						<EmptyView text="No proposals are waiting on a client — the team's applications appear here until they're answered." />
					)
					: (
						<ul class="wsp-proposals" aria-labelledby={PROPOSALS_TITLE_ID}>
							{rows.map((row) => (
								<li key={row.id} class="wsp-proposals__row" data-proposal={row.id}>
									<div class="wsp-proposals__text">
										<a class="wsp-proposals__title" href={row.href}>{row.title}</a>
										<MetaLine
											as="p"
											size="xs"
											class="wsp-proposals__meta"
											items={row.meta.map((text) => ({ text, tabular: true }))}
										/>
									</div>
									{row.canWithdraw && (
										<Button
											class="wsp-proposals__action"
											variant="text"
											size="sm"
											label="Withdraw"
											aria-label={row.withdrawLabel}
											loading={props.withdrawing === row.id}
											onClick={() => props.onWithdraw(row)}
										/>
									)}
								</li>
							))}
						</ul>
					)}
				{props.notice && (
					<InlineNotice
						class="wsp-proposals__notice wsp-proposals__notice--result"
						align="start"
						assertive={!props.notice.ok}
						text={props.notice.text}
					/>
				)}
			</div>
		</>
	);
}
// #endregion

// #region An empty view
/**
 * A view with nothing in it: one Meta sentence and, under it, the way to find work — the tier-4
 * outlined link. Unboxed on the band's own ground (§B.4): the ui `EmptyState` draws a `--surface-1`
 * tile, which inside a band is a card around static content, and titles its sentence at a heading's
 * weight.
 */
function EmptyView({ text }: { text: string }): JSX.Element {
	return (
		<div class="wsp-projects-empty" role="status">
			<p class="wsp-projects-empty__text">{text}</p>
			<a
				class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm wsp-projects-empty__action"
				href={FIND_PROJECTS_HREF}
			>
				<span class="ui-button__label">Find projects</span>
			</a>
		</div>
	);
}
// #endregion
