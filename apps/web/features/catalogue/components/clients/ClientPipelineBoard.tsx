import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Tag } from "@projective/ui/display";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { relativeAge } from "@web/features/explore/core/card-signals.ts";
import type { ClientPipeline, ClientSummary } from "../../types/catalogue-types.ts";
import {
	ACTION_LABELS,
	ACTION_SEVERITY_TONE,
	type BoardLane,
	boardLanes,
	type BoardPos,
	clientRowId,
	moveBoardFocus,
	primaryReason,
	rovingStop,
	rowMeta,
} from "../../core/client-model.ts";

/** Props for {@link ClientPipelineBoard}. */
export interface ClientPipelineBoardProps {
	pipeline: ClientPipeline;
	/** The console's board names each engagement's listing; the workspace is one listing already. */
	consoleScope: boolean;
	/** The buyer the drawer shows, whose row reads as current. */
	chosen?: string;
	/** The real address a row links to (`?client=@handle`), so the row works as a plain link too. */
	hrefFor: (handle: string) => string;
	onChoose: (handle: string) => void;
	/** The instant relative times are measured from. */
	now: number;
}

const HINT_ID = "cat-cl-hint";

function laneHeadingId(lane: BoardLane): string {
	return `cat-cl-lane-${lane.lane}`;
}

function ago(iso: string, now: number): string {
	const age = relativeAge(iso, now);
	return age ? `${age} ago` : "just now";
}

/**
 * ClientPipelineBoard — the client hub, shared by the console's Clients view and the workspace's
 * Clients tab: buyers grouped into four lanes (Needs you · Active · Inquiries · Closed), as columns
 * from 1024px and stacked sections below. A lane heading carries its count; a row is an unboxed list
 * item — the buyer, the lead engagement as middot meta, how long since anything happened, and the
 * waiting reason as a lifecycle-status container only when the buyer is waiting on the seller.
 *
 * Lanes are read-only groupings derived from each source's own status, so nothing is draggable.
 * Choosing a row opens the client drawer. The keyboard moves with one roving tab stop: ↑/↓ within a
 * lane, ←/→ between lanes, Home/End to a lane's ends.
 */
export function ClientPipelineBoard(props: ClientPipelineBoardProps): JSX.Element {
	const lanes = boardLanes(props.pipeline);
	const focus = useSignal<BoardPos | null>(null);
	const stop = focus.value ?? rovingStop(lanes, props.chosen);
	const sizes = lanes.map((l) => l.clients.length);

	function focusAt(pos: BoardPos): void {
		const summary = lanes[pos.lane]?.clients[pos.row];
		if (!summary) return;
		focus.value = pos;
		globalThis.document?.getElementById(clientRowId(summary.client.handle))?.focus();
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLElement>, from: BoardPos): void {
		const next = moveBoardFocus(sizes, from, e.key);
		if (!next) return;
		e.preventDefault();
		focusAt(next);
	}

	function onClick(e: JSX.TargetedMouseEvent<HTMLAnchorElement>, handle: string, pos: BoardPos) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
			return;
		}
		e.preventDefault();
		focus.value = pos;
		props.onChoose(handle);
	}

	function row(summary: ClientSummary, pos: BoardPos): JSX.Element {
		const handle = summary.client.handle;
		const reason = primaryReason(summary);
		const meta = rowMeta(summary, props.consoleScope);
		const current = handle === props.chosen;
		const isStop = stop !== null && stop.lane === pos.lane && stop.row === pos.row;
		return (
			<li key={handle} class="cat-cl__item">
				<a
					id={clientRowId(handle)}
					class="cat-cl__row"
					href={props.hrefFor(handle)}
					tabIndex={isStop ? 0 : -1}
					aria-current={current ? "true" : undefined}
					aria-describedby={HINT_ID}
					onClick={(e) => onClick(e, handle, pos)}
					onKeyDown={(e) => onKeyDown(e, pos)}
					onFocus={() => (focus.value = pos)}
				>
					<UserAvatar
						class="cat-cl__avatar"
						image={summary.client.avatar || null}
						placeholder={summary.client.avatarPlaceholder ?? null}
						label={summary.client.name}
						size="sm"
					/>
					<span class="cat-cl__body">
						<span class="cat-cl__name">{summary.client.name}</span>
						<span class="cat-cl__meta">
							{meta.map((part, i) => <span key={i} class="cat-cl__meta-part">{part}</span>)}
							<time class="cat-cl__meta-part cat-cl__time" dateTime={summary.lastActivityAt}>
								{ago(summary.lastActivityAt, props.now)}
							</time>
						</span>
					</span>
					{reason && (
						<Tag
							class="cat-cl__reason"
							value={ACTION_LABELS[reason]}
							severity={ACTION_SEVERITY_TONE[reason]}
							variant="subtle"
						/>
					)}
				</a>
			</li>
		);
	}

	return (
		<div class="cat-cl" role="group" aria-label="Client pipeline">
			<p id={HINT_ID} class="ui-visually-hidden">
				Arrow keys move between clients and lanes. Enter opens the client.
			</p>
			<div class="cat-cl__lanes">
				{lanes.map((lane, laneIndex) => (
					<section
						key={lane.lane}
						class="cat-cl__lane"
						data-lane={lane.lane}
						aria-labelledby={laneHeadingId(lane)}
					>
						<h2 class="cat-cl__lane-head" id={laneHeadingId(lane)}>
							<span class="cat-cl__lane-title">{lane.label}</span>
							<span class="cat-cl__count">{lane.count}</span>
						</h2>
						{lane.clients.length > 0
							? (
								<ul class="cat-cl__list">
									{lane.clients.map((c, rowIndex) => row(c, { lane: laneIndex, row: rowIndex }))}
								</ul>
							)
							: <p class="cat-cl__lane-empty">Nobody here.</p>}
					</section>
				))}
			</div>
			{props.pipeline.hasMore && (
				<p class="cat-cl__more">Showing the most recently active clients.</p>
			)}
		</div>
	);
}
