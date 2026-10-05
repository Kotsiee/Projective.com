import type { JSX } from "preact";
import { InputText, NumberInput, SelectButton, useFieldValidation } from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { currencyExponent, toMinorUnits } from "@projective/types/finance";
import {
	columnsForProjectType,
	pricedAtProjectLevel,
	PROJECT_PRICE_LOCK_REASON,
	projectPriceLocked,
	ProjectTypeChoice,
	projectTypeOf,
	SHAPE_LOCK_REASON,
	shapeLocked,
} from "../../types/projects-types.ts";
import type { ProjectSetup } from "../../types/projects-types.ts";
import { budgetSectionLabel } from "../../core/setup-sections.ts";
import { patchSetup, setupReveal } from "../../core/setup-state.ts";
import { fieldStatus } from "../../core/setup-validation.ts";
import { Field, Note, outstanding, Section, Validated } from "./setup-primitives.tsx";
import {
	LEGACY_HOURLY_NOTE,
	minorUnit,
	MONEY_FIELD,
	SESSION_KIND_OPTIONS,
	SESSION_TYPE_VALUE,
	toMajor,
	typeHint,
	typeOptions,
} from "./setup-format.ts";

/**
 * SetupBriefSection — the brief: what the engagement is called and what shape it takes (Basics), the
 * scope a freelancer judges their fit against (Description), and the project-level price a stage-less
 * Direct Deliverable carries (Budget).
 */

// #region Basics
/**
 * The three shape axes, held consistent in ONE patch, from the ONE type the owner picked.
 *
 * This replaces a pair of controls — a two-segment Type selector and a "Break this into stages"
 * toggle — that between them encoded three products in four combinations, one of which (a pipeline
 * with stages off) had no name anywhere in the product. The toggle is gone and the missing third
 * product, Task, is a segment: `columnsForProjectType` is the single mapping onto the stored pair,
 * and it is the same one the create write uses, so a Task minted from a profile and a Task converted
 * here are the same row.
 *
 * `structure` and `sessionKind` are each meaningful inside one format only, so a change that left
 * either behind would let the ladder and the section set disagree about what is being sold — which
 * is why all three are written together rather than patched one at a time.
 *
 * `session` never reaches here as a destination: {@link typeOptions} only ever offers it on a project
 * that already is one, where re-picking it is the value it already holds and fires no change.
 */
function shapeForProjectType(
	type: ProjectTypeChoice,
): Pick<ProjectSetup, "format" | "structure" | "sessionKind"> {
	return { ...columnsForProjectType(type), sessionKind: "none" };
}

/** Identity and shape. */
export function BasicsSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	/*
	 * The one type this engagement reads as, and it is a DERIVATION rather than a stored field: the
	 * columns are the truth and `projectTypeOf` is what turns them into the word the owner chose.
	 * `null` is the session — a shape this form can describe and never offer — and the selector shows
	 * it the value it already holds.
	 */
	const type = projectTypeOf(setup.format, setup.structure);
	/*
	 * The shape freeze, and why the control is LOCKED rather than removed.
	 *
	 * Absence is how this form expresses a capability that does not apply. This is the other case: the
	 * shape is still the owner's, it is simply no longer theirs to CHANGE, and hiding it would delete
	 * the answer along with the control — an owner returning to a staffed pipeline would find no
	 * statement anywhere of what they are selling. Locked keeps the value on screen and puts the
	 * reason next to it.
	 *
	 * ONE control to freeze now, where there used to be two. The type selector and the has-stages
	 * toggle each wrote part of the same shape, so freezing one while leaving the other open was a
	 * lock somebody could walk around by turning stages off — stranding every freelancer hired onto
	 * stages 2..n. Collapsing them into the three-way selector removes that hazard by construction.
	 */
	const shapeFrozen = shapeLocked(setup);
	// Order is Type -> Title, and it is a sequence rather than an arrangement: the type decides WHICH
	// sections the rest of the form renders, so answering it first means the page stops changing
	// shape underneath the owner once they start writing. The name is the thing they are most likely
	// to revise later, which is why it no longer leads.
	return (
		<Section sectionKey="basics" title="Basics" hint={hint}>
			<Field label="Project name" htmlFor="psu-title" fieldKey="title">
				<InputText
					id="psu-title"
					aria-describedby="psu-title-problem"
					value={setup.title}
					onValueChange={(next: string) => patchSetup({ title: next })}
					placeholder="Name the engagement"
					block
					maxLength={160}
					status={fieldStatus("title", setup.title.trim() ? "default" : "required")}
				/>
			</Field>

			{
				/*
				 * The lock reason REPLACES the hint rather than joining it. `Field` renders one hint, in
				 * two places at once — a visually-hidden node the control's `aria-describedby` points at,
				 * and the "?" disclosure beside the label — so putting the reason there is what makes it
				 * reachable to a screen reader and to a pointer without a native `title`, which §B.6 rules
				 * out. What the format MEANS matters less than why it can no longer be chosen at the one
				 * moment the control refuses.
				 */
			}
			{
				/*
				 * THE type control: three segments, and no toggle beside it.
				 *
				 * "Break this into milestones" used to sit under this selector as a separate switch, and
				 * between them the two controls encoded the product's three offerings in four
				 * combinations — one of which (a pipeline with stages off) is a shape nothing in the
				 * product has a name for, and two of which (a one-off with stages off, and a Task) are
				 * the same thing stored two different ways depending on which surface minted it.
				 *
				 * Picking **Task** is what turns milestones off; picking **One-off** is what turns them
				 * on. The bit is still recorded on the same `structure_variation` column it always was —
				 * nothing about the storage changed — it simply stopped being a question asked twice.
				 */
			}
			<Field
				label="Project type"
				hint={shapeFrozen ? SHAPE_LOCK_REASON : typeHint(setup)}
			>
				<SelectButton
					options={typeOptions(setup.format)}
					value={type ?? SESSION_TYPE_VALUE}
					onValueChange={(v: string | string[]) => {
						const next = Array.isArray(v) ? v[0] : v;
						// `session` is only ever the value already held, so a change to it is not a change.
						if (next === SESSION_TYPE_VALUE) return;
						patchSetup(shapeForProjectType(next as ProjectTypeChoice));
					}}
					disabled={shapeFrozen}
					aria-label="Project type"
				/>
			</Field>

			{setup.format === "session" && (
				<Field label="Session kind" hint="A group session seats a cohort in the same booking.">
					<SelectButton
						options={SESSION_KIND_OPTIONS}
						value={setup.sessionKind === "group" ? "group" : "normal"}
						onValueChange={(v: string | string[]) =>
							patchSetup({ sessionKind: v as ProjectSetup["sessionKind"] })}
						aria-label="Session kind"
					/>
				</Field>
			)}
		</Section>
	);
}
// #endregion

// #region Description
/** The engagement's scope, as prose a freelancer judges their fit against. */
export function DescriptionSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const scope = useFieldValidation({
		problem: outstanding(setup, "description")
			? "Describe the work so a freelancer can judge whether they fit it."
			: null,
		reveal: setupReveal,
		problemStatus: "gate",
	});

	return (
		<Section sectionKey="description" title="Description" hint={hint}>
			{
				/*
				 * Keyed on the uuid, never the slug. Quill owns its DOM after mount, so the key decides
				 * when the editor is rebuilt — and a title-derived slug moves on the first rename, which
				 * would tear down and re-seed the editor in the middle of the sentence that caused it.
				 */
			}
			<Validated validation={scope} messageId="psu-description-problem">
				<RichTextEditor
					key={setup.id}
					value={setup.description}
					onValueChange={(description: string) => patchSetup({ description })}
					placeholder="Describe the work, its goals and its context…"
					// The LADDER's verdict, not a second `trim()` beside it. `hasProse` strips the markup an
					// emptied editor still emits, so a re-test here would tick the step off for a scope nobody
					// wrote — and disagree with the progress bar reading the same field one region away.
					status={scope.status.value}
					minRows={5}
					aria-label="Project description"
					aria-describedby="psu-description-problem"
				/>
			</Validated>
		</Section>
	);
}
// #endregion

// #region Budget
/**
 * What the engagement pays, at the project level — rendered only where no stage carries that figure.
 *
 * The section is WITHHELD from a staged run and from a flat project alike, because each of those
 * already prices itself somewhere the money path can see: a staged run prices every stage, and a flat
 * one prices its root stage inside the Details section. `finance.fn_hold_ticket_escrow` reads
 * `COALESCE(t.unit_price_cents, ps.unit_price_cents)`, so a project-level amount beside either of
 * those would be a second figure that no escrow hold ever consults — two answers to what the work
 * costs, with nothing on the page to say which one is being charged.
 *
 * What is left is the Direct Deliverable, which has no stage at all and so has nowhere else to put
 * its price. {@link pricedAtProjectLevel} is that rule, and it is the SAME predicate `pricingSatisfied`
 * branches on, so this section is present exactly when the ladder requires the field inside it.
 *
 * The amount is only a problem while NOTHING anywhere is priced. A project that prices every stage
 * individually has satisfied the pricing rung, and painting its empty project-level field amber would
 * be reporting a requirement the ladder beside it says is met.
 */
export function BudgetSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element | null {
	// Defensive, not the rule: `setupSections` is what decides, and it withholds both this section and
	// its nav row from one predicate. The guard is here so the component cannot be mounted directly
	// into a shape it would give a second, uncharged price to.
	if (!pricedAtProjectLevel(setup.structure)) return null;

	const session = setup.format === "session";
	const currency = setup.budget.currency;
	const exponent = currencyExponent(currency);
	/*
	 * `projectPriceLocked`, not `lockedStagePriceIds`, and the two are not interchangeable here.
	 * This section renders only for the one structure that prices itself at the PROJECT level — the
	 * role-staffed Direct Deliverable — and on that shape `lockedStagePriceIds` returns an empty set
	 * by design, because the figure the escrow hold reads is this one and not a stage's. Asking the
	 * stage rule would leave this field open on exactly the shape it governs.
	 */
	const priceLocked = projectPriceLocked(setup);

	return (
		<Section sectionKey="budget" title={budgetSectionLabel(setup)} hint={hint}>
			{
				/*
				 * No `.psu-row` around a lone field: that class is a two-column grid, so a single child
				 * leaves an empty half-width column beside it.
				 *
				 * Currency has moved to Advanced Options, where the brief puts it — it is set once, is
				 * usually inherited from the owner's own display preference, and does not belong in the
				 * reading path of a form somebody fills in every time.
				 */
			}
			<Field
				label={session ? "Rate per session" : "Amount"}
				htmlFor="psu-budget-amount"
				fieldKey="budget.amount"
				hint={priceLocked ? PROJECT_PRICE_LOCK_REASON : undefined}
			>
				<NumberInput
					{...MONEY_FIELD}
					id="psu-budget-amount"
					value={toMajor(setup.budget.amountCents, currency)}
					onValueChange={(v: number | null) =>
						patchSetup({ budget: { amountCents: toMinorUnits(v, currency) } })}
					currency={currency}
					maxFractionDigits={exponent}
					minFractionDigits={exponent}
					precisionStep={minorUnit(currency)}
					// A locked field is never also accused of being unfinished. The `gate` ramp means "this
					// is what publishing is waiting on", and a figure the owner is forbidden to change is not
					// something they can be waiting to supply — painting it amber would name an action that
					// does not exist. Unlocked, this is the original verdict unchanged.
					disabled={priceLocked}
					status={fieldStatus(
						"budget.amount",
						!priceLocked && setup.budget.amountCents === null ? "gate" : "default",
					)}
				/>
			</Field>

			{setup.budget.budgetType === "hourly_cap" && <Note>{LEGACY_HOURLY_NOTE}</Note>}

			{session && (
				<Note>
					{setup.stages.length === 0
						? "No sessions scheduled yet."
						: `${setup.stages.length} session${setup.stages.length === 1 ? "" : "s"} scheduled`}
					{" · each session carries its own duration below"}
				</Note>
			)}
		</Section>
	);
}
// #endregion
