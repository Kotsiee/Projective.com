import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Splitter, SplitterPanel } from "@projective/ui/layout";
import { Backdrop, BodyPortal, usePresence } from "@projective/ui/overlay";
import { useDismiss, useFocusTrap, useOverlayStack } from "@projective/ui/hooks";
import { InputText, SelectButton, Textarea } from "@projective/ui/fields";
import { DndContext, useSortable } from "@projective/ui/dnd";
import type { BoardCard, BoardStageRef, TicketPriority } from "../types/projects-types.ts";
import { PRIORITY_OPTIONS } from "../core/board-model.ts";
import { CloseIcon } from "./file-glyphs.tsx";

/**
 * TicketModal — the 2-panel ticket create/edit surface (task Part 4). LEFT: the Title (the only hard
 * requirement — a title-only ticket is a valid DRAFT, the purchasing gate) + the checkbox stage
 * selector whose ROW ORDER is the ticket's stage sequence, drag-reorderable via `@projective/ui/dnd`.
 * RIGHT: general details (Description, budget, tags, priority) OR — when a selected stage is clicked —
 * that stage's brief + per-stage price override. The purchasing gate is surfaced (not create-blocking):
 * a ticket can't be purchased/claimed until it has a description. STUB persistence — the parent applies
 * the draft optimistically. Rendered through {@link BodyPortal} to beat the glass-blur fixed-overlay trap.
 */
export interface TicketDraftStage {
	stageId: string;
	brief: string;
	unitPriceCents: number | null;
}
export interface TicketDraft {
	id: string | null;
	title: string;
	description: string;
	priority: TicketPriority;
	tags: string[];
	budgetCents: number | null;
	stages: TicketDraftStage[];
}

export interface TicketModalProps {
	open: boolean;
	mode: "create" | "edit";
	card: BoardCard | null;
	stages: BoardStageRef[];
	/** The stage the ticket originates from (create) — pre-selected. `null` = the New backlog. */
	defaultStageId: string | null;
	viewerIsClient: boolean;
	onClose: () => void;
	onSubmit: (draft: TicketDraft) => void;
}

interface StageRow {
	stageId: string;
	name: string;
	checked: boolean;
	brief: string;
	unitPrice: string; // dollars, as typed
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
	const next = arr.slice();
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

/** One draggable stage row in the left-panel selector. */
function StageRowItem(props: {
	row: StageRow;
	active: boolean;
	onToggle: () => void;
	onOpen: () => void;
}): JSX.Element {
	const sortable = useSortable({
		id: `stagerow:${props.row.stageId}`,
		data: { type: "stagerow", accepts: ["stagerow"] },
		roleDescription: "stage",
	});
	return (
		<li
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="tkm-stage"
			data-active={props.active || undefined}
			data-dragging={sortable.isDragging.value || undefined}
			data-over={sortable.isOver.value || undefined}
		>
			<button
				type="button"
				class="tkm-stage__grip"
				aria-label={`Reorder ${props.row.name}`}
				aria-roledescription={sortable.attributes["aria-roledescription"]}
				tabIndex={sortable.attributes.tabIndex}
				onPointerDown={sortable.listeners.onPointerDown}
				onKeyDown={sortable.listeners.onKeyDown}
			>
				<span aria-hidden="true">⠿</span>
			</button>
			<label class="tkm-stage__check">
				<input type="checkbox" checked={props.row.checked} onChange={props.onToggle} />
				<span class="tkm-stage__name">{props.row.name}</span>
			</label>
			<button
				type="button"
				class="tkm-stage__open"
				aria-label={`Edit ${props.row.name} details`}
				disabled={!props.row.checked}
				onClick={props.onOpen}
			>
				Details
			</button>
		</li>
	);
}

export function TicketModal(props: TicketModalProps): JSX.Element | null {
	const { open, mode, card, stages, defaultStageId, onClose, onSubmit } = props;

	const { mounted, state } = usePresence(open);
	const stack = useOverlayStack({ active: mounted, lockScroll: true });
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap({ active: mounted, containerRef: panelRef });
	useDismiss({ open: mounted, onDismiss: onClose, panelRef, closeOnOutside: false });

	const title = useSignal("");
	const description = useSignal("");
	const priority = useSignal<string>("normal");
	const budget = useSignal("");
	const tags = useSignal<string[]>([]);
	const tagDraft = useSignal("");
	const rows = useSignal<StageRow[]>([]);
	const activeStageId = useSignal<string | null>(null);

	// Seed the form whenever the modal (re)opens.
	useEffect(() => {
		if (!open) return;
		title.value = card?.title ?? "";
		description.value = card?.description ?? "";
		priority.value = card?.priority ?? "normal";
		budget.value = card?.budgetLabel ? card.budgetLabel.replace(/[^0-9.]/g, "") : "";
		tags.value = card?.tags ? [...card.tags] : [];
		tagDraft.value = "";
		activeStageId.value = null;
		const preselected = new Set<string>(
			card ? card.stages.map((s) => s.stageId) : defaultStageId ? [defaultStageId] : [],
		);
		rows.value = stages.map((s) => ({
			stageId: s.id,
			name: s.name,
			checked: preselected.has(s.id),
			brief: "",
			unitPrice: "",
		}));
	}, [open, card?.id]);

	if (!mounted) return null;

	const canSubmit = title.value.trim().length > 0;
	const hasDescription = description.value.trim().length > 0;
	const active = rows.value.find((r) => r.stageId === activeStageId.value) ?? null;

	const toggle = (id: string) => {
		rows.value = rows.value.map((r) => (r.stageId === id ? { ...r, checked: !r.checked } : r));
	};
	const patchActive = (patch: Partial<StageRow>) => {
		rows.value = rows.value.map((
			r,
		) => (r.stageId === activeStageId.value ? { ...r, ...patch } : r));
	};
	const addTag = () => {
		const t = tagDraft.value.trim().toLowerCase();
		if (t && !tags.value.includes(t)) tags.value = [...tags.value, t].slice(0, 12);
		tagDraft.value = "";
	};
	const removeTag = (t: string) => {
		tags.value = tags.value.filter((x) => x !== t);
	};

	const submit = () => {
		if (!canSubmit) return;
		const cents = budget.value ? Math.round(Number.parseFloat(budget.value) * 100) : null;
		onSubmit({
			id: mode === "edit" ? card?.id ?? null : null,
			title: title.value.trim(),
			description: description.value.trim(),
			priority: priority.value as TicketPriority,
			tags: tags.value,
			budgetCents: Number.isFinite(cents as number) ? cents : null,
			stages: rows.value
				.filter((r) => r.checked)
				.map((r) => ({
					stageId: r.stageId,
					brief: r.brief.trim(),
					unitPriceCents: r.unitPrice ? Math.round(Number.parseFloat(r.unitPrice) * 100) : null,
				})),
		});
	};

	const onStageDragEnd = (activeId: string | null, overId: string | null) => {
		if (!activeId || !overId || activeId === overId) return;
		const strip = (id: string) => id.replace("stagerow:", "");
		const from = rows.value.findIndex((r) => r.stageId === strip(activeId));
		const to = rows.value.findIndex((r) => r.stageId === strip(overId));
		if (from === -1 || to === -1) return;
		rows.value = arrayMove(rows.value, from, to);
	};

	return (
		<BodyPortal>
			<div class="tkm" data-state={state} style={`z-index:${stack.zIndex}`}>
				<Backdrop visible={state === "open"} blur onClick={onClose} />
				<div
					ref={panelRef}
					class="tkm__panel"
					data-state={state}
					role="dialog"
					aria-modal="true"
					aria-label={mode === "edit" ? `Edit ticket: ${card?.title ?? ""}` : "Create ticket"}
					tabIndex={-1}
				>
					<header class="tkm__top">
						<h2 class="tkm__heading">{mode === "edit" ? "Edit ticket" : "New ticket"}</h2>
						<button type="button" class="tkm__close" aria-label="Close" onClick={onClose}>
							<CloseIcon size={18} />
						</button>
					</header>

					<div class="tkm__split">
						<Splitter layout="horizontal" stateKey="ticket-modal">
							{/* LEFT — title + stage selection/reorder */}
							<SplitterPanel size={38} minSize={28} maxSize={52} class="tkm__left">
								<div class="tkm__section">
									<label class="tkm__label" for="tkm-title">Title</label>
									<InputText
										id="tkm-title"
										value={title}
										placeholder="What needs doing?"
										block
										maxLength={200}
										aria-label="Ticket title"
									/>
									<p class="tkm__hint">
										A title creates a draft. Add a description before it can be purchased or
										claimed.
									</p>
								</div>
								<div class="tkm__section tkm__section--grow">
									<span class="tkm__label">Stages</span>
									<p class="tkm__sublabel">
										Check the stages this ticket needs, then drag to set their order.
									</p>
									<DndContext
										onDragEnd={(e) => onStageDragEnd(e.active.id, e.canceled ? null : e.over)}
									>
										<ul class="tkm-stages" aria-label="Ticket stages">
											{rows.value.map((r) => (
												<StageRowItem
													key={r.stageId}
													row={r}
													active={activeStageId.value === r.stageId}
													onToggle={() => toggle(r.stageId)}
													onOpen={() => (activeStageId.value = r.stageId)}
												/>
											))}
											{rows.value.length === 0
												? <li class="tkm-stages__empty">This engagement has no stages yet.</li>
												: null}
										</ul>
									</DndContext>
								</div>
							</SplitterPanel>

							{/* RIGHT — general details, or the active stage's overrides */}
							<SplitterPanel size={62} minSize={48} maxSize={72} class="tkm__right">
								{active
									? (
										<div class="tkm__section">
											<div class="tkm__stagehead">
												<button
													type="button"
													class="tkm__back"
													onClick={() => (activeStageId.value = null)}
												>
													‹ Ticket details
												</button>
												<h3 class="tkm__stagetitle">{active.name}</h3>
											</div>
											<label class="tkm__label" for="tkm-brief">Stage brief &amp; delivery</label>
											<Textarea
												id="tkm-brief"
												value={active.brief}
												onValueChange={(v: string) => patchActive({ brief: v })}
												rows={5}
												autoResize
												maxRows={12}
												placeholder="Deliverables, acceptance criteria, and delivery parameters for this stage…"
											/>
											<label class="tkm__label" for="tkm-price">Stage price override (USD)</label>
											<InputText
												id="tkm-price"
												value={active.unitPrice}
												onValueChange={(v: string) => patchActive({ unitPrice: v })}
												type="text"
												placeholder="Inherit stage price"
												block
											/>
										</div>
									)
									: (
										<div class="tkm__section">
											<label class="tkm__label" for="tkm-desc">Description</label>
											<Textarea
												id="tkm-desc"
												value={description}
												rows={5}
												autoResize
												maxRows={14}
												placeholder="Describe the work. Required before the ticket can be purchased or claimed."
											/>
											<div class="tkm__row">
												<div class="tkm__field">
													<span class="tkm__label">Priority</span>
													<SelectButton
														options={PRIORITY_OPTIONS}
														value={priority}
														aria-label="Ticket priority"
													/>
												</div>
												<div class="tkm__field">
													<label class="tkm__label" for="tkm-budget">Budget (USD)</label>
													<InputText
														id="tkm-budget"
														value={budget}
														type="text"
														placeholder="e.g. 450"
														block
													/>
												</div>
											</div>
											<div class="tkm__field">
												<label class="tkm__label" for="tkm-tag">Tags</label>
												<div class="tkm__tags">
													{tags.value.map((t) => (
														<span key={t} class="tkm__chip">
															{t}
															<button
																type="button"
																class="tkm__chipx"
																aria-label={`Remove tag ${t}`}
																onClick={() => removeTag(t)}
															>
																<CloseIcon size={12} />
															</button>
														</span>
													))}
													<input
														id="tkm-tag"
														class="tkm__taginput"
														placeholder="Add a tag…"
														value={tagDraft.value}
														onInput={(e) => (tagDraft.value = (e.target as HTMLInputElement).value)}
														onKeyDown={(e) => {
															if (e.key === "Enter" || e.key === ",") {
																e.preventDefault();
																addTag();
															}
														}}
														onBlur={addTag}
													/>
												</div>
											</div>
										</div>
									)}
							</SplitterPanel>
						</Splitter>
					</div>

					<footer class="tkm__foot">
						<p class="tkm__gate" role="status">
							{hasDescription
								? "Ready to save."
								: "Draft — add a description to unlock purchase/claim."}
						</p>
						<div class="tkm__actions">
							<button type="button" class="tkm__btn" onClick={onClose}>Cancel</button>
							<button
								type="button"
								class="tkm__btn tkm__btn--primary"
								disabled={!canSubmit}
								onClick={submit}
							>
								{mode === "edit" ? "Save ticket" : "Create ticket"}
							</button>
						</div>
					</footer>
				</div>
			</div>
		</BodyPortal>
	);
}
