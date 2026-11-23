import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../../styles/offer.css";
import "../../styles/session-plan.css";
import { DndContext, DropIndicator, useSortable } from "@projective/ui/dnd";
import { Button, InputText, Textarea } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { type BlueprintSessionPlanEntry, SESSION_PLAN_MAX } from "@projective/types/explore";
import { SUB_PAGE_SECTION, workspaceHref } from "@projective/types/catalogue";
import type { ListingDetail } from "../../types/catalogue-types.ts";
import { checkOffer, commitOffer } from "../../core/offer-commit.ts";
import { offerEditorFor } from "../../core/offer-model.ts";
import {
	canAddSession,
	hasPlan,
	planRows,
	planSummary,
	SESSIONS_MIN,
	type TimedOffer,
	withSessionAdded,
	withSessionEntry,
	withSessionMoved,
	withSessionRemoved,
} from "../../core/plan-model.ts";
import { useGatedDraft } from "../../hooks/useGatedDraft.ts";
import { SubPageHead } from "../subpage/SubPageHead.tsx";

const HEADING_ID = "cat-plan-h";
const SUMMARY_ID = "cat-plan-summary";

const rowDragId = (index: number) => `session:${index}`;
const indexOf = (id: unknown) => Number(String(id).replace("session:", ""));

let keySeq = 0;
const freshKey = () => `s${++keySeq}`;

interface SessionRowProps {
	index: number;
	entry: BlueprintSessionPlanEntry;
	only: boolean;
	onEntry: (patch: Partial<BlueprintSessionPlanEntry>) => void;
	onRemove: () => void;
}

function SessionRow(props: SessionRowProps): JSX.Element {
	const n = props.index + 1;
	const name = props.entry.title.trim() || `Session ${n}`;
	const sortable = useSortable({
		id: rowDragId(props.index),
		data: { type: "session", accepts: ["session"] },
		roleDescription: "session",
	});
	return (
		<div
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="cat-plan__session"
			data-dragging={sortable.isDragging.value || undefined}
		>
			<div class="cat-plan__head">
				<button
					type="button"
					class="cat-offer__grip"
					aria-label={`Reorder ${name}`}
					aria-roledescription={sortable.attributes["aria-roledescription"]}
					tabIndex={sortable.attributes.tabIndex}
					onPointerDown={sortable.listeners.onPointerDown}
					onKeyDown={sortable.listeners.onKeyDown}
				>
					<Icon name="grip" size="xs" />
				</button>
				<span class="cat-offer__step-number" aria-hidden="true">{n}</span>
				<InputText
					value={props.entry.title}
					onValueChange={(title) => props.onEntry({ title })}
					maxLength={80}
					placeholder={n === 1 ? "Title, e.g. Discovery" : `Session ${n} title`}
					aria-label={`Session ${n} title`}
					fluid
				/>
				{!props.only && (
					<Button
						iconOnly
						icon={<Icon name="trash" size="xs" />}
						severity="danger"
						variant="text"
						size="sm"
						aria-label={`Remove ${name}`}
						onClick={props.onRemove}
					/>
				)}
			</div>
			<Textarea
				value={props.entry.description}
				onValueChange={(description) => props.onEntry({ description })}
				maxLength={600}
				rows={2}
				autoResize
				maxRows={8}
				placeholder="What this session covers"
				aria-label={`Session ${n} description`}
				fluid
			/>
		</div>
	);
}

/**
 * SessionPlanBuilder — the listing's session plan (`/catalogue/[id]/plan`, Decision #525): how many
 * sessions one booking holds and what each covers, as ordered rows a seller adds, removes, writes and
 * drags into order (a title and a description travel with their session). Every change reaches the
 * draft only once the offer would save. An ongoing one-to-one listing is booked a session at a time,
 * so it has no plan, and the page says how to make it a series.
 */
export function SessionPlanBuilder(props: { listing: ListingDetail; team?: string }): JSX.Element {
	const { listing } = props;
	const back = workspaceHref(listing.id, { team: props.team, section: SUB_PAGE_SECTION.plan });
	const editor = offerEditorFor(listing.kind, listing.serviceType, listing.offer);
	const offer = listing.offer.archetype === "session" || listing.offer.archetype === "cohort"
		? listing.offer
		: null;

	const head = (
		<SubPageHead
			title="Session plan"
			intro="How many sessions one booking holds, in order, and what each one covers. Buyers see the breakdown on your listing and when they book."
			backHref={back}
			headingId={HEADING_ID}
		/>
	);

	if (!editor || !offer) {
		return (
			<div class="cat-sub">
				{head}
				<InlineNotice text="Saving the new delivery model. The plan opens here once it's saved." />
			</div>
		);
	}
	if (!hasPlan(offer)) {
		return (
			<div class="cat-sub">
				{head}
				<InlineNotice text="Buyers book this listing one session at a time, so it has no plan. To sell a series, choose Fixed number under How buyers book in the Offer section." />
			</div>
		);
	}
	return (
		<div class="cat-sub">
			{head}
			<PlanRows offer={offer} />
		</div>
	);
}

function PlanRows(props: { offer: TimedOffer }): JSX.Element {
	const gated = useGatedDraft<TimedOffer, ReturnType<typeof checkOffer>>(
		props.offer,
		checkOffer,
		commitOffer,
	);
	const offer = gated.value.value;
	const keys = useSignal<string[]>(Array.from({ length: offer.count }, freshKey));
	const dragIndex = useSignal<number | null>(null);
	const overIndex = useSignal<number | null>(null);
	const rows = planRows(offer);
	const problem = gated.problem.value;

	const move = (from: number, to: number) => {
		const next = [...keys.peek()];
		const [key] = next.splice(from, 1);
		next.splice(to, 0, key);
		keys.value = next;
		gated.set(withSessionMoved(offer, from, to));
	};
	const add = () => {
		keys.value = [...keys.peek(), freshKey()];
		gated.set(withSessionAdded(offer));
	};
	const remove = (index: number) => {
		keys.value = keys.peek().filter((_, i) => i !== index);
		gated.set(withSessionRemoved(offer, index));
	};

	const from = dragIndex.value;
	const over = overIndex.value;
	const seamBefore = from !== null && over !== null && from > over ? over : null;
	const seamAfter = from !== null && over !== null && from < over ? over : null;

	return (
		<>
			<p class="cat-sec__value cat-offer__summary-line" id={SUMMARY_ID}>
				{planSummary(offer).join(" · ")}
			</p>
			<DndContext
				onDragStart={(e) => (dragIndex.value = indexOf(e.active.id))}
				onDragOver={(e) => (overIndex.value = e.over === null ? null : indexOf(e.over))}
				onDragEnd={(e) => {
					const start = dragIndex.value;
					const target = e.over === null ? null : indexOf(e.over);
					dragIndex.value = null;
					overIndex.value = null;
					if (e.canceled || start === null || target === null) return;
					move(start, target);
				}}
			>
				<ol class="cat-plan__sessions" aria-labelledby={HEADING_ID} aria-describedby={SUMMARY_ID}>
					{rows.map((entry, i) => (
						<li key={keys.value[i] ?? `row-${i}`} class="cat-plan__slot">
							<DropIndicator active={seamBefore === i} />
							<SessionRow
								index={i}
								entry={entry}
								only={offer.count <= SESSIONS_MIN}
								onEntry={(patch) => gated.set(withSessionEntry(offer, i, patch))}
								onRemove={() => remove(i)}
							/>
							<DropIndicator active={seamAfter === i} />
						</li>
					))}
				</ol>
			</DndContext>
			{problem && <p class="cat-offer__problem" role="status">{problem.message}</p>}
			{canAddSession(offer)
				? (
					<div class="cat-offer__add">
						<Button
							label="Add session"
							icon={<Icon name="plus" size="xs" />}
							variant="text"
							size="sm"
							onClick={add}
						/>
					</div>
				)
				: <p class="cat-sec__hint">A booking holds at most {SESSION_PLAN_MAX} sessions.</p>}
		</>
	);
}
