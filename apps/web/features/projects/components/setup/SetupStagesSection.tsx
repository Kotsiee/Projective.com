import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import {
	Chips,
	NumberInput,
	type Option,
	SelectButton,
	useFieldValidation,
} from "@projective/ui/fields";
import { DndContext, useSortable } from "@projective/ui/dnd";
import { Icon } from "@projective/ui/icons";
import { currencyExponent, toMinorUnits } from "@projective/types/finance";
import {
	blankStage,
	hasStages,
	lockedStagePriceIds,
	MAX_STAGE_SKILLS,
	normaliseSeats,
	priceLockReasonFor,
	STAGE_ITEM_LABEL,
	STAGE_SECTION_LABEL,
	stagePredecessorOptions,
	stageTimingApplies,
} from "../../types/projects-types.ts";
import type { ProjectSetup, StageCapacity, StageSetup } from "../../types/projects-types.ts";
import { staffingSectionLabel } from "../../core/setup-sections.ts";
import { patchSetup, setupReveal } from "../../core/setup-state.ts";
import {
	arrayMove,
	Field,
	FieldGroup,
	newStageId,
	Note,
	PairRow,
	Section,
} from "./setup-primitives.tsx";
import { CAPACITY_OPTIONS, COUNT_FIELD, minorUnit, MONEY_FIELD, toMajor } from "./setup-format.ts";
import { StageRoleList, TaskList } from "./SetupStageEditors.tsx";
import { StageFields } from "./SetupStageFields.tsx";

/**
 * SetupStagesSection — where the work is delivered: the drag-reorderable stage / milestone / session
 * list of a staged engagement, and the flat Details section that edits the root stage of one that is
 * not broken into stages.
 */

// #region Stage list
/**
 * One stage row: a drag handle, a summary, a disclosure, and — once open — {@link StageFields}.
 *
 * The row owns the ACCORDION and nothing else. Every control inside it belongs to `StageFields`, so
 * the standalone Stage Details tab renders the identical form with no second copy to keep in step.
 *
 * The outstanding requirements read as inline middot-separated text rather than as chips. A chip is a
 * promise of interactivity (§B.11) and "Needs pricing" cannot be pressed; the way to act on it is the
 * field two lines below, which the disclosure already opens. They are re-derived here rather than
 * taken from the fields' own verdicts because the summary has to state them while the body is CLOSED,
 * which is precisely when those hooks are not mounted.
 */
function StageRow(props: {
	stage: StageSetup;
	index: number;
	itemLabel: string;
	/** Whether the engagement is a session — it changes what two of these fields are asking for. */
	session: boolean;
	/** Whether the engagement is a one-off — only a milestone is asked for a delivery DATE. */
	oneOff: boolean;
	/** The stages this one may legally wait for: never itself, never one whose chain leads back here. */
	predecessorOptions: Option[];
	currency: string;
	projectRequiresNda: boolean;
	/**
	 * Whether THIS stage's own price is frozen by somebody already working it.
	 *
	 * A boolean rather than the set, and resolved by the parent rather than here: `lockedStagePriceIds`
	 * reads the whole stage list plus the project's structure, so a row that asked it directly would
	 * rebuild the same set once per row and would need the project it is a row of. The row is told the
	 * one bit that concerns it.
	 */
	priceLocked: boolean;
	/** Whether this engagement has a sequence for the stage to sit in — {@link stageTimingApplies}. */
	timed: boolean;
	open: boolean;
	onToggle: () => void;
	onPatch: (patch: Partial<StageSetup>) => void;
	onRemove: () => void;
}): JSX.Element {
	const { stage, itemLabel } = props;
	const sortable = useSortable({
		id: `stage:${stage.id}`,
		data: { type: "stage", accepts: ["stage"] },
		roleDescription: itemLabel,
	});
	const scoped = stage.description.trim().length > 0;
	const priced = stage.unitPriceCents !== null;
	// A LOCKED price is not an unfinished one, so the collapsed row drops the accusation for the same
	// reason the open body's verdict does. Without this the two halves of one row disagree: the header
	// says "Needs pricing" beside a control that explains it can never be priced again.
	const outstandingNotes = [
		!scoped && "Needs scope",
		!priced && !props.priceLocked && "Needs pricing",
	].filter(Boolean);

	return (
		<li
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="psu-stage"
			data-open={props.open || undefined}
			data-dragging={sortable.isDragging.value || undefined}
			data-over={sortable.isOver.value || undefined}
		>
			<div class="psu-stage__row">
				<button
					type="button"
					class="psu-stage__grip"
					aria-label={`Reorder ${stage.name || itemLabel}`}
					aria-roledescription={sortable.attributes["aria-roledescription"]}
					tabIndex={sortable.attributes.tabIndex}
					onPointerDown={sortable.listeners.onPointerDown}
					onKeyDown={sortable.listeners.onKeyDown}
				>
					<Icon name="grip" />
				</button>

				<button
					type="button"
					class="psu-stage__main"
					aria-expanded={props.open}
					onClick={props.onToggle}
				>
					<span class="psu-stage__index" aria-hidden="true">{props.index + 1}</span>
					<span class="psu-stage__name">{stage.name || `Untitled ${itemLabel}`}</span>
					{outstandingNotes.length > 0 && (
						<span class="psu-stage__outstanding">{outstandingNotes.join(" · ")}</span>
					)}
					<span class="psu-stage__chev" aria-hidden="true">
						<Icon name={props.open ? "chevron-up" : "chevron-down"} />
					</span>
				</button>

				<button
					type="button"
					class="psu-stage__remove"
					aria-label={`Remove ${stage.name || itemLabel}`}
					onClick={props.onRemove}
				>
					<Icon name="trash" />
				</button>
			</div>

			{props.open && (
				<div class="psu-stage__body">
					<StageFields
						stage={stage}
						index={props.index}
						itemLabel={itemLabel}
						session={props.session}
						oneOff={props.oneOff}
						predecessorOptions={props.predecessorOptions}
						currency={props.currency}
						projectRequiresNda={props.projectRequiresNda}
						priceLocked={props.priceLocked}
						timed={props.timed}
						onPatch={props.onPatch}
					/>
				</div>
			)}
		</li>
	);
}

/**
 * The predecessors one stage may be pointed at, as `Select` options.
 *
 * The exclusion is the SSOT's {@link stagePredecessorOptions}, not a local filter: a cycle is refused
 * by the write path and by the board's own traversal, and a dropdown that offered one would invite a
 * choice its own product then rejects. Excluding it here means the illegal answer is unreachable
 * rather than merely reported.
 *
 * The leading `""` is "the one above it" — the honest reading of a NULL `start_dependency_stage_id`,
 * which is what an unconfigured stage carries and what a reorder should keep meaning.
 */
export function predecessorOptionsFor(
	stages: readonly StageSetup[],
	stageId: string,
	itemLabel: string,
): Option[] {
	const options: Option[] = [{ value: "", label: `The previous ${itemLabel}` }];
	for (const candidate of stagePredecessorOptions(stages, stageId)) {
		const position = stages.findIndex((s) => s.id === candidate.id) + 1;
		options.push({
			value: candidate.id,
			label: candidate.name.trim() || `Untitled ${itemLabel} ${position}`,
		});
	}
	return options;
}

/** The stage / milestone / session list, drag-reorderable, with each row's own configuration. */
export function StageListSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element | null {
	const open = useSignal<string | null>(setup.stages[0]?.id ?? null);
	const itemLabel = STAGE_ITEM_LABEL[setup.format];
	const session = setup.format === "session";
	const oneOff = setup.format === "one_off";
	const staged = hasStages(setup.structure);
	/*
	 * Resolved ONCE for the list, then handed to each row as a boolean.
	 *
	 * The rule is per stage rather than per project — a run whose second milestone has been staffed can
	 * still be priced at its fourth — which is why it returns a set. Building that set inside every row
	 * would walk the whole list once per row for an answer that is identical each time, and would put a
	 * second call site between the rows and the SSOT.
	 */
	const lockedPrices = lockedStagePriceIds(setup, setup.stages);

	const add = () => {
		const id = newStageId();
		const ordinal = setup.stages.length + 1;
		const name = `${itemLabel[0].toUpperCase()}${itemLabel.slice(1)} ${ordinal}`;
		patchSetup({ stages: [...setup.stages, blankStage(id, name, setup.stages.length)] });
		open.value = id;
	};

	const patchRow = (id: string, patch: Partial<StageSetup>) => {
		patchSetup({ stages: setup.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
	};

	const remove = (id: string) => {
		patchSetup({ stages: setup.stages.filter((s) => s.id !== id) });
		if (open.value === id) open.value = null;
	};

	const reorder = (activeId: string | null, overId: string | null) => {
		if (!activeId || !overId || activeId === overId) return;
		const strip = (id: string) => id.replace("stage:", "");
		const from = setup.stages.findIndex((s) => s.id === strip(activeId));
		const to = setup.stages.findIndex((s) => s.id === strip(overId));
		if (from === -1 || to === -1) return;
		// Nothing to remap alongside the move: a stage's `dependency` says whether it runs after the one
		// above it or alongside it, which is a fact about its POSITION rather than a reference to a
		// particular row — so reordering the list is the whole edit.
		patchSetup({ stages: arrayMove(setup.stages, from, to) });
	};

	// The section itself is GONE when the toggle is off, rather than reduced to the toggle alone. The
	// toggle now lives in Basics, so nothing that can hide this section is stranded inside it — and
	// `setupSections` withholds the nav row from the same `hasStages`, so the rail never offers a jump
	// to an anchor that is not on the page.
	if (!staged) return null;

	const label = staffingSectionLabel(setup);
	// Resolved once for the list rather than per row: it is an answer about the whole run, and asking
	// it per row would let two rows of one project disagree about whether the project has a sequence.
	const timed = stageTimingApplies(setup.structure, setup.stages);

	return (
		<Section sectionKey="stages" title={label} hint={hint}>
			<DndContext onDragEnd={(e) => reorder(e.active.id, e.canceled ? null : e.over)}>
				<ul class="psu-list" aria-label={label}>
					{setup.stages.map((stage, index) => (
						<StageRow
							key={stage.id}
							stage={stage}
							index={index}
							itemLabel={itemLabel}
							session={session}
							oneOff={oneOff}
							predecessorOptions={predecessorOptionsFor(setup.stages, stage.id, itemLabel)}
							currency={setup.budget.currency}
							projectRequiresNda={setup.rules.ndaRequired}
							priceLocked={lockedPrices.has(stage.id)}
							timed={timed}
							open={open.value === stage.id}
							onToggle={() => (open.value = open.value === stage.id ? null : stage.id)}
							onPatch={(patch) => patchRow(stage.id, patch)}
							onRemove={() => remove(stage.id)}
						/>
					))}
					{setup.stages.length === 0 && (
						<li class="psu-list__empty">
							No {itemLabel}s yet. Freelancers cannot be hired until there is at least one.
						</li>
					)}
				</ul>
			</DndContext>

			<button type="button" class="psu-add" onClick={add}>
				<Icon name="plus" />
				Add {itemLabel}
			</button>
		</Section>
	);
}
// #endregion

// #region Flat details
/**
 * The engagement's own terms, when it is NOT broken into stages.
 *
 * It edits the ROOT STAGE, not a parallel set of project columns, and that is the load-bearing
 * decision here. Every project already has one — `create_project` provisions it, and `reconcileRoles`
 * creates one for a role-staffed engagement that somehow lacks it — because tickets, submissions and
 * escrow all hang off a stage and have nowhere else to hang. `finance.fn_hold_ticket_escrow` reads
 * `COALESCE(t.unit_price_cents, ps.unit_price_cents)`, so a price stored anywhere BUT a stage is a
 * price the money path cannot see. Project-level `default_tasks` / `skills` / `capacity` columns
 * would each be a second answer to a question the stage row already answers, and the board would
 * have to choose between them.
 *
 * So the toggle is genuinely presentational: one shape, one set of columns, two ways of framing them.
 * Turning stages back on reveals what was being edited all along rather than migrating anything.
 *
 * Deliberately NOT shown: Scope and Name. The project's own description IS this unit's scope — the
 * section sits directly beneath it — and a second rich-text field there would ask the owner to write
 * the same brief twice. `Delivery date` is likewise absent because the one-off's own milestone terms
 * belong with its description; what remains is exactly the flat column of the spec: tasks, skills,
 * the primary price, capacity and named roles.
 */
export function FlatDetailsSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const currency = setup.budget.currency;
	const exponent = currencyExponent(currency);
	const root = setup.stages[0];
	const itemLabel = STAGE_ITEM_LABEL[setup.format];

	/*
	 * The flat branch of the SAME stage rule the staged list uses, not the project rule.
	 *
	 * The figure this field edits lives on the root stage — `finance.fn_hold_ticket_escrow` reads
	 * `COALESCE(t.unit_price_cents, ps.unit_price_cents)`, so a price stored anywhere else is a price
	 * the money path cannot see — and `lockedStagePriceIds` freezes that root on the PROJECT's count
	 * for exactly this shape, because anybody hired anywhere against a flat engagement was hired
	 * against this one number. `projectPriceLocked` is scoped to `pricedAtProjectLevel` and returns
	 * `false` here, so asking it would leave the field open.
	 */
	const priceLocked = root ? lockedStagePriceIds(setup, setup.stages).has(root.id) : false;

	// BEFORE the missing-root branch below, and that order is load-bearing rather than stylistic:
	// `useFieldValidation` is a hook, and a project can genuinely gain or lose its root stage between
	// renders — the toggle provisions one, a save reconciles it. A hook called on one render and
	// skipped on the next misaligns Preact's hook state for every hook after it, which surfaces as
	// unrelated fields losing their values rather than as an error anyone could trace back here.
	const priced = root?.unitPriceCents != null;
	// A frozen price is not an unfinished one; the gate stands down rather than accusing a field the
	// owner is forbidden to complete. Unlocked, this is the original verdict unchanged.
	const price = useFieldValidation({
		problem: priced || priceLocked ? null : "Give this project a price.",
		reveal: setupReveal,
		problemStatus: "gate",
	});

	// The root stage is provisioned by the create RPC, so its absence is a genuinely broken row rather
	// than an ordinary empty state. Saying so beats rendering controls that would patch `stages[0]` of
	// an empty array and silently discard every edit.
	if (!root) {
		return (
			<Section sectionKey="details" title="Details" hint={hint}>
				<Note>
					This project has no delivery unit to configure. Turn on{" "}
					{STAGE_SECTION_LABEL[setup.format]} in Basics to add one.
				</Note>
			</Section>
		);
	}

	const patchRoot = (patch: Partial<StageSetup>) => {
		patchSetup({ stages: setup.stages.map((s) => (s.id === root.id ? { ...s, ...patch } : s)) });
	};

	const priceLabel = setup.format === "one_off" ? "Budget" : "Ticket price";

	return (
		<Section sectionKey="details" title="Details" hint={hint}>
			<TaskList stage={root} itemLabel={itemLabel} onPatch={patchRoot} />

			<Field
				label="Required skills"
				hint="Up to ten. A project asking for twenty is asking for nobody."
			>
				<Chips
					value={root.skills}
					onValueChange={(skills: string[]) => patchRoot({ skills })}
					placeholder="Add a skill…"
					max={MAX_STAGE_SKILLS}
					addOnBlur
					aria-label="Required skills"
				/>
			</Field>

			<Field
				label={priceLabel}
				htmlFor="psu-details-price"
				validation={price}
				hint={priceLocked ? priceLockReasonFor(setup.structure) : undefined}
			>
				<NumberInput
					{...MONEY_FIELD}
					id="psu-details-price"
					value={toMajor(root.unitPriceCents, currency)}
					onValueChange={(v: number | null) =>
						patchRoot({ unitPriceCents: toMinorUnits(v, currency) })}
					currency={currency}
					maxFractionDigits={exponent}
					minFractionDigits={exponent}
					precisionStep={minorUnit(currency)}
					disabled={priceLocked}
					status={price.status.value}
				/>
			</Field>

			{
				/*
				 * The same capacity group — the same heading, the same order, `Seats` in the same row as the
				 * control that switches it on — as {@link StageFields} renders on a staged engagement, so the
				 * two surfaces read as one form. There is no timing group above it because a flat engagement
				 * is ONE delivery unit: it has nothing above it to wait for, so `Starts`, `Starts with` and
				 * `Delay` are not fields this shape hides, they are questions it never asks.
				 */
			}
			<FieldGroup id="psu-details-capacity-head" label="Capacity & resourcing">
				<PairRow paired={root.capacity === "limited"}>
					<Field label="Capacity">
						<SelectButton
							options={CAPACITY_OPTIONS}
							value={root.capacity}
							onValueChange={(v: string | string[]) =>
								patchRoot(normaliseSeats(v as StageCapacity, root.seatCount))}
							aria-label="Capacity"
						/>
					</Field>

					{root.capacity === "limited" && (
						<Field label="Seats" htmlFor="psu-details-seats">
							<NumberInput
								{...COUNT_FIELD}
								icon="members"
								id="psu-details-seats"
								value={root.seatCount}
								onValueChange={(v: number | null) =>
									patchRoot(
										normaliseSeats(
											"limited",
											v === null ? null : Math.max(1, Math.min(99, Math.round(v))),
										),
									)}
								min={1}
								max={99}
							/>
						</Field>
					)}
				</PairRow>

				<StageRoleList stage={root} currency={currency} onPatch={patchRoot} />
			</FieldGroup>
		</Section>
	);
}
// #endregion
