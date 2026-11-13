import type { ComponentChildren, JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import {
	DndContext,
	DragOverlay,
	DropIndicator,
	pointerWithin,
	useDnd,
	useDroppable,
} from "@projective/ui/dnd";
import { useId } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import type { MenuItem } from "@ui/types/mod.ts";
import type { BoardStageRef, TicketIntensity } from "../../types/projects-types.ts";
import type { TicketStageView } from "../../core/ticket-view.ts";
import { blankStageRef } from "../../core/ticket-model.ts";
import { type PipelineDrop, type PipelineSlot, placeStage } from "../../core/stage-pipeline.ts";
import {
	inclusionRefusal,
	type PipelineLocks,
	removalRefusal,
	stageMenuModel,
} from "../../core/stage-menu.ts";
import {
	parseStageDndId,
	type PipelineFrame,
	type PipelineTarget,
	STAGE_DRAG,
	usePipelineDrop,
	ZONE_AVAILABLE,
	ZONE_INCLUDED,
} from "../../hooks/usePipelineDrop.ts";
import { StageCard, type StageCardToggle } from "./StageCard.tsx";
import { AvailableStageBody, IncludedStageBody } from "./StageCardBody.tsx";

/**
 * StagePipeline — the ticket's stages as two zones of Kanban-style cards split by one divider.
 *
 * **Included in this ticket** is the ordered pipeline, one row per step; a step whose stages run in
 * parallel is one labelled row of side-by-side cards. **Available project stages** lists the
 * engagement's other stages. A drag lands by where it is dropped, not on what: anywhere below the
 * divider takes the stage out, and anywhere above it lands on the step rows — a row's edge is the
 * seam before or after it (the shared {@link DropIndicator} marks it), its middle runs the stage in
 * parallel with that step. A press selects a stage in either zone, opening it in the modal's
 * inspector; Shift+click, a middle click and the card's `+` / `−` add it or take it out. Each card's
 * `…` and right-click open the same rows.
 *
 * The rules are pure (`stage-pipeline`, `stage-menu`): a ticket keeps at least one stage, and a
 * claimed ticket's stages are its terms (Decision #291), so every card of a claimed ticket is locked
 * with its reason and the available zone is withdrawn. A viewer who may not change the ticket gets
 * the ordered list alone.
 */
export interface StagePipelineProps {
	resolved: TicketStageView[];
	/** Stages of the engagement not currently in the ticket. */
	available: BoardStageRef[];
	selectedStageId: string | null;
	/** Whether the viewer may change the ticket's composition. */
	editable: boolean;
	/** The engagement's currency (`BoardCard.currency`). */
	currency: string;
	/** The ticket's intensity — what an added stage starts at. */
	intensity: TicketIntensity;
	locks: PipelineLocks;
	/** The list's heading — "Pipeline" on the Stages tab, "Stages" in the create pane. */
	title?: string;
	/** Open a stage in the inspector — an included one or an available one. */
	onSelect: (stageId: string) => void;
	/** Reorder, join, add or take out a stage. */
	onPlace: (stageId: string, drop: PipelineDrop) => void;
	/** Swap a stage with its neighbour. */
	onSwap: (stageId: string, direction: -1 | 1) => void;
	/** Bring `peerId` into `stageId`'s step, running in parallel with it. */
	onGroup: (stageId: string, peerId: string) => void;
	/** Take a stage out of its parallel step into a step of its own. */
	onSequential: (stageId: string) => void;
}

interface ZonesProps extends StagePipelineProps {
	notice: Signal<string | null>;
	rootRef: RefObject<HTMLDivElement>;
	focusCard: (zone: "included" | "available", stageId: string) => void;
}

function Ghost(props: { zone: "included" | "available"; children: ComponentChildren }) {
	return (
		<div class="tkc-stage tkc-stage--overlay" data-zone={props.zone}>
			<div class="tkc-stage__surface">
				<div class="tkc-stage__body">{props.children}</div>
			</div>
		</div>
	);
}

/** The included stages grouped by step, in pipeline order. */
function bandsOf(resolved: readonly TicketStageView[]): TicketStageView[][] {
	const out: TicketStageView[][] = [];
	for (const item of resolved) {
		if (item.opensBand || out.length === 0) out.push([item]);
		else out[out.length - 1].push(item);
	}
	return out;
}

function announcement(
	target: PipelineTarget | null,
	from: { zone: "included" | "available"; stageId: string } | null,
	ids: readonly string[],
	nameOf: (id: string) => string,
): string {
	if (!target || !from) return "";
	const name = nameOf(from.stageId);
	switch (target.kind) {
		case "seam": {
			const at = ids.indexOf(from.stageId);
			const total = at < 0 ? ids.length + 1 : ids.length;
			const position = at >= 0 && target.before > at ? target.before : target.before + 1;
			return `${name}, position ${position} of ${total}.`;
		}
		case "join":
			return `${name}, runs in parallel with ${nameOf(target.stageId)}.`;
		case "exclude":
			return `${name}, taken out of this ticket.`;
		case "refused":
			return target.reason;
	}
}

function PipelineZones(props: ZonesProps): JSX.Element {
	const { store } = useDnd();
	const zoneId = useId(undefined, "tkc-zone");
	const availableRef = useRef<HTMLElement | null>(null);
	const { resolved, available, editable, locks } = props;
	const refs = resolved.map((v) => v.ref);
	const ids = refs.map((r) => r.stageId);
	const count = ids.length;
	const bands = bandsOf(resolved);
	const lockOf = (id: string): string | null => locks.stages.get(id) ?? null;
	const joining = inclusionRefusal(count, locks.ticket);
	const composing = editable && locks.ticket === null;
	const nameOf = (id: string): string =>
		resolved.find((v) => v.ref.stageId === id)?.ref.name ??
			available.find((s) => s.id === id)?.name ?? "Stage";
	const quote = (s: BoardStageRef) => blankStageRef(s, count, props.intensity);
	const slotOf = (id: string): PipelineSlot =>
		refs.find((r) => r.stageId === id) ?? { stageId: id, parallel: false };
	const refuse = (reason: string): void => {
		props.notice.value = reason;
	};

	const place = (id: string, drop: PipelineDrop, from: "included" | "available"): void => {
		props.onPlace(id, drop);
		const to = drop.kind === "exclude" ? "available" : "included";
		if (to !== from) props.focusCard(to, id);
	};

	const frame = (): PipelineFrame | null => {
		const root = props.rootRef.current;
		const host = root?.parentElement ?? root;
		if (!host) return null;
		const rect = host.getBoundingClientRect();
		const divider = availableRef.current?.isConnected
			? availableRef.current.getBoundingClientRect().top
			: null;
		return { left: rect.left, right: rect.right, divider };
	};

	const target = usePipelineDrop({
		included: ids,
		bands: bands.map((band) => band.map((v) => v.ref.stageId)),
		frame,
		removalRefusal: (id) => removalRefusal(count, lockOf(id)),
		inclusionRefusal: () => joining,
		changes: (id, drop) => placeStage(refs, slotOf(id), drop) !== null,
		onDrop: (id, drop) => place(id, drop, ids.includes(id) ? "included" : "available"),
		onRefused: refuse,
		onStart: () => (props.notice.value = null),
	});

	const active = store.active.value;
	const from = active ? parseStageDndId(String(active.id)) : null;
	const t = target.value;
	const seam = t?.kind === "seam" ? t.before : null;
	const bandOf = (id: string): number => resolved.find((v) => v.ref.stageId === id)?.band ?? -1;
	const joinBand = t?.kind === "join"
		? bandOf(t.stageId)
		: seam !== null
		? bands.findIndex((b) => seam > b[0].index && seam <= b[b.length - 1].index)
		: -1;
	const showAvailable = composing && (available.length > 0 || from?.zone === "included");

	const includedDrop = useDroppable({ id: ZONE_INCLUDED, data: STAGE_DRAG, disabled: !editable });
	const availableDrop = useDroppable({
		id: ZONE_AVAILABLE,
		data: STAGE_DRAG,
		disabled: !showAvailable,
	});

	const includedMenu = (item: TicketStageView): MenuItem[] | null => {
		if (!editable) return null;
		const id = item.ref.stageId;
		return stageMenuModel(
			{
				zone: "included",
				index: item.index,
				count,
				peers: resolved
					.filter((v) => v.ref.stageId !== id)
					.map((v) => ({
						stageId: v.ref.stageId,
						name: v.ref.name,
						sameBand: v.band === item.band,
					})),
				lock: lockOf(id),
			},
			{
				configure: () => props.onSelect(id),
				move: (d) => props.onSwap(id, d),
				groupWith: (peerId) => props.onGroup(id, peerId),
				sequential: () => props.onSequential(id),
				include: () => {},
				remove: () => place(id, { kind: "exclude" }, "included"),
			},
		);
	};
	const availableMenu = (s: BoardStageRef): MenuItem[] =>
		stageMenuModel({ zone: "available", count, lock: locks.ticket }, {
			configure: () => props.onSelect(s.id),
			move: () => {},
			groupWith: () => {},
			sequential: () => {},
			include: () => place(s.id, { kind: "seam", before: count }, "available"),
			remove: () => {},
		});

	const excluder = (item: TicketStageView): StageCardToggle | null =>
		composing
			? {
				label: `Take ${item.ref.name} out of this ticket`,
				refusal: removalRefusal(count, lockOf(item.ref.stageId)),
				run: () => place(item.ref.stageId, { kind: "exclude" }, "included"),
				onRefused: refuse,
			}
			: null;
	const includer = (s: BoardStageRef): StageCardToggle => ({
		label: `Add ${s.name} to this ticket`,
		refusal: joining,
		run: () => place(s.id, { kind: "seam", before: count }, "available"),
		onRefused: refuse,
	});

	const includedCard = (item: TicketStageView, band: TicketStageView[], joined: boolean) => {
		const id = item.ref.stageId;
		const lock = lockOf(id);
		const mates = band.filter((v) => v.ref.stageId !== id).map((v) => v.ref.name);
		return (
			<StageCard
				zone="included"
				stageId={id}
				label={`${item.ref.name}, step ${item.band + 1}${
					mates.length > 0 ? `, in parallel with ${mates.join(", ")}` : ""
				}`}
				draggable={editable && lock === null}
				selected={props.selectedStageId === id}
				joinTarget={joined}
				menu={includedMenu(item)}
				menuLabel={`Actions for ${item.ref.name}`}
				toggle={excluder(item)}
				onActivate={() => props.onSelect(id)}
			>
				<IncludedStageBody
					item={item}
					showStep={band.length === 1}
					currency={props.currency}
					lock={lock}
				/>
			</StageCard>
		);
	};

	let ghost: JSX.Element | null = null;
	if (from?.zone === "included") {
		const item = resolved.find((v) => v.ref.stageId === from.stageId);
		if (item) {
			ghost = (
				<Ghost zone="included">
					<IncludedStageBody item={item} showStep currency={props.currency} lock={null} />
				</Ghost>
			);
		}
	} else if (from?.zone === "available") {
		const s = available.find((a) => a.id === from.stageId);
		if (s) {
			const q = quote(s);
			ghost = (
				<Ghost zone="available">
					<AvailableStageBody
						stage={s}
						intensity={q.intensity}
						costCents={q.costCents}
						currency={props.currency}
					/>
				</Ghost>
			);
		}
	}

	const refusal = t?.kind === "refused" ? t.reason : null;

	return (
		<>
			<section class="tkc-zone" data-zone="included" aria-labelledby={`${zoneId}-included`}>
				<h4 class="tkc-zone__title" id={`${zoneId}-included`}>
					Included in this ticket
					<span class="tkc-zone__count">{count}</span>
				</h4>
				<div
					ref={includedDrop.setNodeRef}
					class="tkc-zone__drop"
					data-over={from?.zone === "available" && (seam !== null || joinBand >= 0)
						? "true"
						: undefined}
				>
					{count === 0
						? (
							<div class="tkc-zone__empty">
								<Icon name="stages" size="lg" class="tkc-zone__emptymark" />
								<p class="tkc-zone__emptytext">
									{editable
										? "A ticket with no stages saves as a draft. Drag one in from below, or press its +."
										: "A ticket with no stages carries no price, so nothing can be claimed against it."}
								</p>
							</div>
						)
						: (
							<ol class="tkc-zone__list" aria-label="Steps in this ticket, in order">
								{bands.map((band, b) => {
									const first = band[0].index;
									const joined = joinBand === b;
									return (
										<li key={band[0].ref.stageId} class="tkc-zone__slot">
											<DropIndicator active={seam === first} class="tkc-seam" />
											{band.length === 1 ? includedCard(band[0], band, joined) : (
												<div
													class="tkc-band"
													role="group"
													aria-label={`Step ${b + 1}, ${band.length} stages in parallel`}
													data-join={joined ? "true" : undefined}
												>
													<p class="tkc-band__label" aria-hidden="true">
														<Icon name="switch" size="2xs" class="tkc-band__mark" />
														<span>Step {b + 1}</span>
														<span class="tkc-stage__dot">·</span>
														<span>In parallel</span>
													</p>
													<ul class="tkc-band__row">
														{band.map((item) => (
															<li key={item.ref.stageId} class="tkc-band__cell">
																{includedCard(item, band, joined)}
															</li>
														))}
													</ul>
												</div>
											)}
											{b === bands.length - 1
												? (
													<DropIndicator
														active={seam === count}
														class="tkc-seam tkc-seam--end"
													/>
												)
												: null}
										</li>
									);
								})}
							</ol>
						)}
				</div>
			</section>

			{showAvailable
				? (
					<section
						ref={(el: HTMLElement | null) => {
							availableRef.current = el;
							availableDrop.setNodeRef(el);
						}}
						class="tkc-zone tkc-zone--available"
						data-zone="available"
						data-over={t?.kind === "exclude" ? "true" : undefined}
						data-refused={refusal && from?.zone === "included" ? "true" : undefined}
						aria-labelledby={`${zoneId}-available`}
					>
						<h4 class="tkc-zone__title" id={`${zoneId}-available`}>Available project stages</h4>
						{refusal && from?.zone === "included"
							? <p class="tkc-zone__refusal">{refusal}</p>
							: null}
						{available.length === 0
							? <p class="tkc-zone__hint">Drop a stage here to take it out of this ticket.</p>
							: (
								<ul class="tkc-zone__list" aria-label="Project stages not in this ticket">
									{available.map((s) => {
										const q = quote(s);
										return (
											<li key={s.id} class="tkc-zone__slot">
												<StageCard
													zone="available"
													stageId={s.id}
													label={`${s.name}, not in this ticket`}
													draggable={joining === null}
													selected={props.selectedStageId === s.id}
													menu={availableMenu(s)}
													menuLabel={`Actions for ${s.name}`}
													toggle={includer(s)}
													onActivate={() => props.onSelect(s.id)}
												>
													<AvailableStageBody
														stage={s}
														intensity={q.intensity}
														costCents={q.costCents}
														currency={props.currency}
													/>
												</StageCard>
											</li>
										);
									})}
								</ul>
							)}
					</section>
				)
				: null}

			<DragOverlay>{ghost}</DragOverlay>
			<div class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
				{announcement(t, from, ids, nameOf)}
			</div>
		</>
	);
}

export function StagePipeline(props: StagePipelineProps): JSX.Element {
	const rootRef = useRef<HTMLDivElement>(null);
	const notice = useSignal<string | null>(null);
	const count = props.resolved.length;

	const focusCard = (zone: "included" | "available", stageId: string): void => {
		setTimeout(() => {
			rootRef.current
				?.querySelector<HTMLElement>(
					`.tkc-stage[data-zone="${zone}"][data-stage-id="${stageId}"] .tkc-stage__surface`,
				)
				?.focus();
		}, 0);
	};

	const sub = props.locks.ticket && props.editable
		? props.locks.ticket
		: !props.editable
		? count === 0
			? "This ticket runs through no stages."
			: "The stages this ticket runs through, in order."
		: count === 0
		? "Pick the stages this ticket passes through."
		: "Drag a stage to reorder it, onto a step to run it in parallel, or below the line to take it out. Shift+click adds or removes one.";

	return (
		<div ref={rootRef} class="tkc-pipe">
			<header class="tkc-pipe__head">
				<h3 class="tkc-pipe__title">{props.title ?? "Pipeline"}</h3>
				<p class="tkc-pipe__sub">{sub}</p>
				<p class="tkc-pipe__notice" role="status">{notice.value}</p>
			</header>
			<DndContext collision={pointerWithin}>
				<PipelineZones {...props} notice={notice} rootRef={rootRef} focusCard={focusCard} />
			</DndContext>
		</div>
	);
}
