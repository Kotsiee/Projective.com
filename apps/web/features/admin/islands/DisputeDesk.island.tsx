import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/dispute-desk.css";
import type { DisputeQueue, DisputeQueueItem } from "@projective/types/finance";
import { Button } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { Tag } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { TabMenu } from "@projective/ui/navigation";
import { EmptyState } from "@projective/ui/utils";
import { disputeStatusLabel, disputeStatusSeverity } from "@features/projects/core/dispute-view.ts";
import { DisputeDeskService } from "../core/DisputeDeskService.ts";
import {
	caseTitle,
	deadlineLine,
	DESK_TAB_LABEL,
	DESK_TABS,
	type DeskTab,
	emptyCopy,
	evidenceLine,
	itemsFor,
	partyLabel,
	tabCount,
} from "../core/dispute-desk.ts";
import { DisputeRulingDialog } from "../components/DisputeRulingDialog.tsx";

/** Props for {@link DisputeDesk}. */
export interface DisputeDeskProps {
	/** The queue the server read for this operator (or the dev preview's sample). */
	initial: DisputeQueue;
	/** The Dev Context Switcher's sample queue: re-reading it would only meet the database's refusal. */
	preview: boolean;
}

const PANEL_ID = "ddesk-panel";

/**
 * DisputeDesk — `/admin/disputes`, the platform operator's dispute queue (Decision #212). Tabs by live
 * status (Under review first — the auditor's queue — then Awaiting response, Open, All live) with the
 * server's counts; one row per case, oldest-due first, naming the parties, the money held, the deadline
 * that applies (overdue review flagged) and how much evidence is filed. **Review** opens the case in
 * {@link DisputeRulingDialog} — a case is never a URL (Decision #88). After a ruling the queue is read
 * again so it follows the act (§3 gate 11). Dumb island: `DisputeDeskService` only.
 */
export default function DisputeDesk(props: DisputeDeskProps): JSX.Element {
	const queue = useSignal<DisputeQueue>(props.initial);
	const tab = useSignal<DeskTab>("under_review");
	const selected = useSignal<DisputeQueueItem | null>(null);
	const open = useSignal(false);
	const refreshing = useSignal(false);
	const failure = useSignal<string | null>(null);
	const said = useSignal<string | null>(null);

	async function refresh(): Promise<void> {
		if (props.preview || refreshing.value) return;
		refreshing.value = true;
		const res = await DisputeDeskService.queue();
		refreshing.value = false;
		if (!res.ok || !res.data) {
			failure.value = res.message ?? "The queue couldn't be read — please try again.";
			return;
		}
		failure.value = null;
		queue.value = res.data;
	}

	function review(item: DisputeQueueItem): void {
		selected.value = item;
		open.value = true;
	}

	function ruled(message: string): void {
		open.value = false;
		said.value = message;
		void refresh();
	}

	const { items, counts } = queue.value;
	const shown = itemsFor(items, tab.value);
	const empty = emptyCopy(tab.value);

	return (
		<div class="ddesk">
			<header class="ddesk__head">
				<div class="ddesk__heading">
					<h1 class="ddesk__title">Disputes</h1>
					<p class="ddesk__lede">
						Cases waiting on a Projective auditor. A ruling moves the held payment and is final;
						nothing here rules on its own.
					</p>
				</div>
				{props.preview ? null : (
					<Button
						label={refreshing.value ? "Refreshing…" : "Refresh"}
						severity="secondary"
						variant="text"
						size="sm"
						icon={<Icon name="refresh" />}
						disabled={refreshing.value}
						onClick={() => void refresh()}
					/>
				)}
			</header>

			{props.preview
				? (
					<Message severity="info" variant="subtle" size="sm">
						Preview: sample cases from the Dev Context Switcher. A ruling on one still goes to the
						database, which refuses it.
					</Message>
				)
				: null}

			{counts.overdue > 0
				? (
					<Message severity="warning" variant="subtle" size="sm">
						{counts.overdue === 1
							? "1 case is past its review deadline."
							: `${counts.overdue} cases are past their review deadline.`}
					</Message>
				)
				: null}

			<div class="ddesk__live" aria-live="polite">
				{said.value
					? (
						<Message
							severity="success"
							variant="subtle"
							size="sm"
							closable
							onClose={() => (said.value = null)}
						>
							{said.value}
						</Message>
					)
					: null}
				{failure.value
					? (
						<Message
							severity="danger"
							variant="subtle"
							size="sm"
							closable
							onClose={() => (failure.value = null)}
						>
							{failure.value}
						</Message>
					)
					: null}
			</div>

			<TabMenu
				class="ddesk__tabs"
				aria-label="Dispute status"
				panelId={PANEL_ID}
				activeIndex={DESK_TABS.indexOf(tab.value)}
				onActiveIndexChange={(i) => (tab.value = DESK_TABS[i])}
				model={DESK_TABS.map((t) => ({
					key: t,
					label: DESK_TAB_LABEL[t],
					badge: tabCount(t, counts),
				}))}
			/>

			<div id={PANEL_ID} role="tabpanel" class="ddesk__panel">
				{shown.length === 0
					? (
						<EmptyState
							size="sm"
							icon={<Icon name="shield-check" />}
							title={empty.title}
							description={empty.description}
						/>
					)
					: (
						<ul class="ddesk__list" role="list">
							{shown.map((item) => (
								<li key={item.id} class="ddesk-row">
									<div class="ddesk-row__main">
										{tab.value === "all" || item.overdue
											? (
												<div class="ddesk-row__tags">
													{tab.value === "all"
														? (
															<Tag
																value={disputeStatusLabel(item.status)}
																severity={disputeStatusSeverity(item.status)}
																variant="subtle"
																rounded
															/>
														)
														: null}
													{item.overdue
														? <Tag value="Overdue" severity="danger" variant="subtle" rounded />
														: null}
												</div>
											)
											: null}
										<p class="ddesk-row__title">{caseTitle(item)}</p>
										<p class="ddesk-row__meta">
											{partyLabel(item.claimant, "Attendee")} v.{" "}
											{partyLabel(item.respondent, "Provider")}
											{" · "}
											<span class="ddesk-row__figure">{item.amountLabel}</span>
											{" · "}
											{deadlineLine(item)}
										</p>
										<p class="ddesk-row__reason">{item.reason}</p>
										<p class="ddesk-row__meta">{evidenceLine(item)}</p>
									</div>
									<Button
										label="Review"
										severity="secondary"
										variant="outlined"
										size="sm"
										aria-label={`Review the case about ${caseTitle(item)}`}
										onClick={() => review(item)}
									/>
								</li>
							))}
						</ul>
					)}
			</div>

			<DisputeRulingDialog open={open} item={selected.value} onRuled={ruled} />
		</div>
	);
}
