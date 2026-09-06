import { cloneElement, type ComponentChildren, isValidElement, type JSX } from "preact";
import { useSignal } from "@preact/signals";
import { HintPopover } from "@projective/ui/feedback";
import {
	Checkbox,
	Chips,
	DatePicker,
	type DateValue,
	type FieldValidation,
	InputText,
	MultiSelect,
	NumberInput,
	type Option,
	Select,
	SelectButton,
	Textarea,
	ToggleSwitch,
	useFieldValidation,
} from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { DndContext, useSortable } from "@projective/ui/dnd";
import { Icon } from "@projective/ui/icons";
import { currencyExponent, DISPLAY_CURRENCIES, toMinorUnits } from "@projective/types/finance";
import { FileKind } from "@projective/types/files";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import { extractMetadata } from "@web/features/files/core/media/extract.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { AccountService } from "@web/features/shell/core/AccountService.ts";
import {
	blankStage,
	DEADLINE_BONUS_RATE,
	hasStages,
	lockedStagePriceIds,
	MAX_PROJECT_ATTACHMENTS,
	MAX_STAGE_SKILLS,
	normaliseSeats,
	pricedAtProjectLevel,
	priceLockReasonFor,
	PROJECT_PRICE_LOCK_REASON,
	projectPriceLocked,
	ROLE_INSTRUCTIONS_MAX,
	ROLE_SECTION_LABEL,
	SHAPE_LOCK_REASON,
	shapeLocked,
	STAGE_DELAY_MAX_DAYS,
	STAGE_ITEM_LABEL,
	STAGE_PRICE_LOCK_REASON,
	STAGE_SECTION_LABEL,
	stagePredecessorOptions,
	structureForStages,
} from "../../types/projects-types.ts";
import type {
	IpOwnershipMode,
	NdaDocumentSource,
	PortfolioDisplayRights,
	ProjectAttachment,
	ProjectFormat,
	ProjectRoleSetup,
	ProjectSetup,
	ProjectSetupStepKey,
	ProjectVisibility,
	StageCapacity,
	StageDependency,
	StageSetup,
	StageStaffingRole,
	StageTask,
	TimelinePreset,
} from "../../types/projects-types.ts";
import {
	anchorId,
	budgetSectionLabel,
	type SetupSectionKey,
	staffingSectionLabel,
} from "../../core/setup-sections.ts";
import { patchSetup, setupReveal } from "../../core/setup-state.ts";
import { FieldGuard, fieldStatus } from "../../core/setup-validation.ts";
import { formatBytes } from "../../core/composer-model.ts";
import { uploadForProject } from "../../core/upload.ts";

/**
 * SetupSections — the Stage-2 workspace's form body: every section of the owner's configuration, and
 * the controls that edit it.
 *
 * The sections are ONE continuous vertical flow, not a stepper. A stepper implies an order the work
 * does not have — a client who knows the budget and not the brief has no reason to be stopped at
 * step 2 — and it hides the scale of what is being asked, which is the one thing a person deciding
 * whether to finish now needs to see. The side rail beside this flow is an accelerator over the same
 * scroll, and it addresses each section through {@link anchorId}, which is why every `Section` here
 * carries the registry's id rather than one of its own.
 *
 * The four format branches are one component set with a dispatcher rather than four screens, because
 * the difference between a Pipeline and a Direct Deliverable is WHICH sections apply, not how a
 * section behaves: a stage list relabelled "Milestones" is the same editor, and forking it would give
 * a milestone its own chance to drift away from a stage.
 *
 * **Every field of {@link ProjectSetup} is bound to a control here.** A term chosen once at creation
 * and then invisible is a term nobody can ever fix, so the six wizard steps land here as controls
 * rather than as a second surface: the engagement terms in Rules, the engagement's shape in Basics,
 * and the whole of a stage's configuration — steps, skills, seats, sequencing, timing, submission
 * rules and its confidentiality override — inside the stage's own disclosure.
 *
 * The one thing the wizard collects that this form does not is the brief's reference ATTACHMENTS.
 * That is not an omission here: `ProjectSetup` carries no attachment field, so the projection this
 * form edits has nothing to bind, and uploading against a library needs an owner id the projection
 * also does not carry. Adding the control without both would be an affordance whose handler reaches
 * nothing.
 *
 * Every control is a `@projective/ui/fields` primitive and every edit routes through
 * {@link patchSetup}, so the ladder in the header band re-derives from the same `reconcileSetup` the
 * server runs. Nothing here computes a percentage, a total or a gate.
 *
 * Static content is never boxed and non-actionable metadata is never a chip (DESIGN_SYSTEM §B.4,
 * §B.11): a section is separated by spacing alone, and a stage's outstanding requirements read as
 * inline middot-separated text rather than as pills that look pressable and are not.
 */

// #region Section vocabulary
/**
 * The section list lives in `core/setup-sections.ts` and is re-exported rather than restated.
 *
 * There is exactly one list because two hydration roots consume it: this form renders the sections,
 * and the side rail renders a jump per section. A second list here would still compile, still look
 * right and still leave the rail pointing at an anchor that no longer exists — the §3 gate-11 defect,
 * invisible to a type-checker.
 */
export {
	anchorId,
	budgetSectionLabel,
	setupSections,
	staffingSectionLabel,
} from "../../core/setup-sections.ts";
export type { SetupSectionKey, SetupSectionMeta } from "../../core/setup-sections.ts";
// #endregion

// #region Label maps
/**
 * The human words for each enum member.
 *
 * Written as exhaustive `Record`s keyed on the SSOT enum types rather than as free option arrays, so
 * a member added to the schema fails to compile here instead of quietly rendering a dropdown that is
 * missing one of its own values.
 */
const VISIBILITY_LABEL: Record<ProjectVisibility, string> = {
	public: "Public — listed on Explore",
	invite_only: "Invite only — reachable by invitation",
	unlisted: "Unlisted — reachable by link",
};

const IP_LABEL: Record<IpOwnershipMode, string> = {
	exclusive_transfer: "Exclusive transfer to the client",
	licensed_use: "Licensed use",
	shared_ownership: "Shared ownership",
	projective_partner: "Projective partner terms",
};

const PORTFOLIO_LABEL: Record<PortfolioDisplayRights, string> = {
	allowed: "May be shown publicly",
	forbidden: "May not be shown",
	embargoed: "May be shown after an embargo",
};

const TIMELINE_LABEL: Record<TimelinePreset, string> = {
	sequential: "Sequential — one after another",
	simultaneous: "Simultaneous — all at once",
	staggered: "Staggered — overlapping starts",
	custom: "Custom",
};

const FILE_KIND_LABEL: Record<string, string> = {
	image: "Images",
	video: "Video",
	audio: "Audio",
	pdf: "PDF",
	doc: "Documents",
	code: "Code",
	archive: "Archives",
	link: "Links",
	file: "Any other file",
};

/** Turn an exhaustive label map into the `Option[]` a `Select` takes, in declaration order. */
function optionsOf<K extends string>(labels: Record<K, string>): Option[] {
	return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
}

/**
 * The two work-flows a client can commission, plus `session` when the engagement ALREADY is one.
 *
 * A session is a service a freelancer sells, not a project a client posts — which is why the Quick-Init
 * modal's `ProjectCreateFormat` has two members. Offering it here as a target would reintroduce
 * exactly what the modal refuses: a buyer minting an engagement with no seller and no schedule. An
 * existing session still has to be editable, so the option appears only on a project that is one, and
 * is then the value it is already set to rather than a destination.
 */
function formatOptions(format: ProjectFormat): Option[] {
	const base: Option[] = [
		{ value: "pipeline", label: "Pipeline" },
		{ value: "one_off", label: "One-off" },
	];
	return format === "session" ? [...base, { value: "session", label: "Sessions" }] : base;
}

const FORMAT_HINT: Record<ProjectFormat, string> = {
	pipeline: "A multi-stage workflow. Freelancers claim tickets stage by stage.",
	one_off: "A fixed engagement delivered against milestones.",
	session: "Booked time rather than tickets — one-to-one or a cohort.",
};

/*
 * The four-segment Shape control that used to live here is retired, and with it the `shapeOf` /
 * `shapeOptionsFor` / `structureForShape` resolvers in the SSOT.
 *
 * It asked one question in two vocabularies: a pipeline chose between "Staged" and "Single stage"
 * while a one-off chose between "Milestones" and "Direct deliverable", and the four segments encoded
 * one bit — does this engagement break its work into parts? A reader had to learn two words for yes
 * and two for no, and switching format switched the vocabulary underneath them. It is now the single
 * {@link BasicsSection} toggle, which asks that bit directly and reads it back through the same
 * `hasStages` the section list and the ladder already consult.
 *
 * The consequence worth stating: `single_task` — the Direct Deliverable — is no longer reachable from
 * the form, because {@link structureForStages} never returns it. A project already stored that way
 * keeps its role editor (`setupSections` still routes it to `roles`) and its toggle reads OFF;
 * turning it ON converts it to a staged engagement, which is a one-way move and the only escape the
 * shape now has.
 */

/** The uplift the deadline-bonus offer is stated as, from the one constant that carries the rate. */
const DEADLINE_BONUS_PERCENT = Math.round(DEADLINE_BONUS_RATE * 100);

const SESSION_KIND_OPTIONS: Option[] = [
	{ value: "normal", label: "One-to-one" },
	{ value: "group", label: "Group" },
];

/*
 * Hourly pricing is retired at the OFFER, not at the schema.
 *
 * `hourly_cap` is a member of the SHARED `public.budget_type` enum, read by `projects.projects` AND by
 * `projects.stage_staffing_roles`, and `create_project` carries a guard that refuses to copy an
 * `hourly_cap` amount into `unit_price_cents` — a ceiling on spend is not the cost of one ticket. Root
 * CLAUDE.md §1 permits folding a value INTO a `CREATE TYPE`; it does not permit dropping one, and this
 * one is load-bearing in SQL. So the member stays, no stored row is rewritten, and the platform simply
 * stops offering it — the same narrowing Decision #86 applied to `session` in `project_format`.
 *
 * With one option left the control itself is gone: a one-option picker states a decision its author
 * never made. A project already stored as `hourly_cap` keeps that value (the payload round-trips
 * `budget` whole) and says so, rather than being silently rewritten by a form it can no longer express.
 */
const LEGACY_HOURLY_NOTE =
	"This project was set up on the retired hourly-cap model. Pricing is now per ticket or per milestone; the stored ceiling is left as it is.";

/**
 * What a named role's money field means, said once and read by both role editors.
 *
 * The wording is the whole point of this constant. The figure is a BONUS added on top of the stage's
 * ticket price — not a total, not an override — and a reader who takes it for a budget will price the
 * engagement twice: once on the stage, where `finance.fn_hold_ticket_escrow` reads it, and once here,
 * where nothing does. Two labels for one field is two chances to say only one of those, so both
 * editors take the same string and the placeholder says "no bonus" rather than "unpriced", which is
 * the word for a figure somebody still owes.
 */
const ROLE_BONUS_HINT =
	"Any amount here is a bonus ON TOP of the ticket price — leave it empty for none.";
const ROLE_INSTRUCTIONS_PLACEHOLDER = "Anything specific this role should know…";

/** The accessible name of a role's bonus field — it must carry the semantics the visible hint does. */
function roleBonusLabel(name: string): string {
	return `Bonus on top of the ticket price for ${name.trim() || "this role"}`;
}

/** The accessible name of a role's instructions field. */
function roleInstructionsLabel(name: string): string {
	return `Additional instructions for ${name.trim() || "this role"}`;
}

const DEPENDENCY_OPTIONS: Option[] = [
	{ value: "sequential", label: "After the previous one" },
	{ value: "parallel", label: "Alongside the project" },
];

const CAPACITY_OPTIONS: Option[] = [
	{ value: "unlimited", label: "Open to anyone" },
	{ value: "limited", label: "Fixed seats" },
];

/**
 * Every currency the platform can price in, from the SSOT's curated list.
 *
 * Not a hand-written subset: an amount stored in a currency the dropdown does not carry renders a
 * `Select` whose value matches no option, and the owner then cannot change it back to one that does.
 * The list is curated upstream precisely so every entry has a seeded rate behind it.
 */
const CURRENCY_OPTIONS: Option[] = DISPLAY_CURRENCIES.map((c) => ({
	value: c.code,
	label: `${c.code} — ${c.label}`,
}));

const FILE_KIND_OPTIONS: Option[] = FileKind.options.map((kind) => ({
	value: kind,
	label: FILE_KIND_LABEL[kind] ?? kind,
}));

/**
 * Languages and locations are picked from curated lists rather than typed free-hand.
 *
 * Both are MATCHING criteria: discovery ranks a freelancer against them, so "Spanish" and "spanish"
 * and "ES" typed into three projects are three requirements that never meet the same person. A fixed
 * vocabulary is what makes the restriction mean anything, and an empty selection stays the legitimate
 * answer "anywhere" / "any language" rather than an omission.
 */
const LANGUAGE_OPTIONS: Option[] = [
	"English",
	"Spanish",
	"French",
	"German",
	"Portuguese",
	"Italian",
	"Dutch",
	"Polish",
	"Arabic",
	"Hindi",
	"Bengali",
	"Mandarin",
	"Cantonese",
	"Japanese",
	"Korean",
	"Vietnamese",
	"Indonesian",
	"Turkish",
	"Russian",
	"Ukrainian",
	"Swedish",
	"Norwegian",
	"Danish",
	"Finnish",
	"Hebrew",
	"Swahili",
].map((v) => ({ value: v, label: v }));

const LOCATION_OPTIONS: Option[] = [
	{ value: "United Kingdom", label: "United Kingdom", group: "Europe" },
	{ value: "Ireland", label: "Ireland", group: "Europe" },
	{ value: "Germany", label: "Germany", group: "Europe" },
	{ value: "France", label: "France", group: "Europe" },
	{ value: "Spain", label: "Spain", group: "Europe" },
	{ value: "Portugal", label: "Portugal", group: "Europe" },
	{ value: "Italy", label: "Italy", group: "Europe" },
	{ value: "Netherlands", label: "Netherlands", group: "Europe" },
	{ value: "Poland", label: "Poland", group: "Europe" },
	{ value: "European Union", label: "Anywhere in the EU", group: "Europe" },
	{ value: "United States", label: "United States", group: "Americas" },
	{ value: "Canada", label: "Canada", group: "Americas" },
	{ value: "Mexico", label: "Mexico", group: "Americas" },
	{ value: "Brazil", label: "Brazil", group: "Americas" },
	{ value: "Argentina", label: "Argentina", group: "Americas" },
	{ value: "India", label: "India", group: "Asia-Pacific" },
	{ value: "Singapore", label: "Singapore", group: "Asia-Pacific" },
	{ value: "Japan", label: "Japan", group: "Asia-Pacific" },
	{ value: "Australia", label: "Australia", group: "Asia-Pacific" },
	{ value: "New Zealand", label: "New Zealand", group: "Asia-Pacific" },
	{ value: "United Arab Emirates", label: "United Arab Emirates", group: "Middle East & Africa" },
	{ value: "South Africa", label: "South Africa", group: "Middle East & Africa" },
	{ value: "Nigeria", label: "Nigeria", group: "Middle East & Africa" },
	{ value: "Kenya", label: "Kenya", group: "Middle East & Africa" },
];
// #endregion

// #region Value conversion
/**
 * Minor units to the major units a person types, and back — in the PROJECT'S OWN currency.
 *
 * The exponent is looked up rather than assumed to be 2. A fixed `/100` is correct for most of the
 * offerable set and wrong for the rest: a ¥250,000 engagement stored as 250000 minor units would be
 * shown as ¥2,500 and written back as ¥25,000,000, which is a hundredfold escrow error committed
 * silently by a control the owner never touched.
 *
 * The schema stores minor units because a currency amount held as a float eventually loses a penny;
 * the field shows major units because that is what the owner is quoting. The rounding happens once,
 * on the way in.
 */
/**
 * A stored `YYYY-MM-DD` as the `Date` the picker binds — parsed in the reader's OWN timezone.
 *
 * `new Date("2026-09-05")` is not that: the ISO date-only form is defined as UTC midnight, so
 * anywhere west of Greenwich it lands on the 4th and the picker highlights the day before the one
 * that is stored. Constructing from the three parts makes the value local, which is what a delivery
 * date means to the person reading it.
 */
function fromIsoDate(iso: string | null): Date | null {
	if (!iso) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	if (!match) return null;
	const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The picker's `Date` as the `YYYY-MM-DD` the schema stores — read back in local parts, for the same
 * reason. `toISOString()` would convert to UTC first and move the date across midnight.
 */
function toIsoDate(value: DateValue): string | null {
	const date = Array.isArray(value) ? value[0] : value;
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A typed lag held inside the schema's signed bound.
 *
 * `Math.round` before clamping, and a non-finite input read as `0` rather than as `null`: the field
 * is `NOT NULL` with a real default, so "cleared" means "no offset" and not "unknown".
 */
function clampDelay(value: number | null): number {
	if (value === null || !Number.isFinite(value)) return 0;
	return Math.max(-STAGE_DELAY_MAX_DAYS, Math.min(STAGE_DELAY_MAX_DAYS, Math.round(value)));
}

function toMajor(minor: number | null, currency: string): number | null {
	if (minor === null) return null;
	return minor / 10 ** currencyExponent(currency);
}

/**
 * One minor unit expressed in major units — `0.01` for a two-exponent currency, `1` for the Yen.
 *
 * This is the fine step Ctrl switches a money field to, and it is derived rather than hardcoded to
 * `0.01` because that constant is only right for the exponent-2 currencies. A three-exponent
 * currency (the Dinar) would otherwise have a "fine" mode ten times coarser than the smallest amount
 * it can actually hold.
 */
function minorUnit(currency: string): number {
	return 1 / 10 ** currencyExponent(currency);
}

/**
 * The shared `NumberInput` configuration for a MONEY field on this form.
 *
 * Three decisions, each of which would otherwise be re-made nine times and drift:
 *
 *  - **The leading adornment is the currency's own symbol**, which `NumberInput` derives from the
 *    code, and it is the ONLY place the currency appears — the box holds the bare figure, so there
 *    is nothing to type around and no second symbol to disagree with the first.
 *  - **Coarser travel** (`3` px per unit rather than the default `6`), because these fields run from
 *    a two-figure role bonus to a six-figure budget. A scrub is the coarse approach; the exact figure
 *    is still typed, and typing is never snapped to the step grid.
 *  - **Whole units by default, pennies on Ctrl.** `step: 1` is what a stepper press, an arrow or a
 *    wheel notch moves; holding Ctrl (or Cmd) switches every one of them — and the scrub — to
 *    `precisionStep`, which is the currency's own minor unit. So the steppers stay useful on a
 *    £250,000 budget without giving up the ability to land on £120.45.
 */
const MONEY_FIELD = {
	mode: "currency",
	step: 1,
	min: 0,
	enableIconScrub: true,
	scrubPixelsPerStep: 3,
} as const;

/**
 * The shared configuration for a WHOLE-NUMBER field — a seat count, a role headcount, a lag in days.
 *
 * `maxFractionDigits: 0` is doing two jobs: it rounds a typed figure to a whole number, and it is the
 * only signal from which the control can know it holds integers, which is what earns the digits-only
 * keypad. Left as the default, an integer field would offer a decimal keypad on a phone.
 */
const COUNT_FIELD = {
	step: 1,
	maxFractionDigits: 0,
	enableIconScrub: true,
} as const;

// #endregion

// #region Layout primitives
/**
 * One labelled section of the flow.
 *
 * The `id` comes from the shared registry, so the rail's `#psu-budget` and this element are one
 * string decided in one place. It is also what makes a plain `#hash` in the address bar land
 * correctly with JavaScript off, which the stylesheet's `scroll-margin-block-start` then clears the
 * pinned chrome for.
 *
 * Separated by SPACING alone (§B.4 tier 1) — no box, no hairline. A section of prose and inputs is
 * static content, and the asymmetric rhythm above and below the heading already says where each one
 * begins.
 */
export function Section(props: {
	/** Which registry section this is — the anchor the side rail jumps to. */
	sectionKey: SetupSectionKey;
	title: string;
	/** The ladder hint for this section, shown only while the requirement is outstanding. */
	hint?: string;
	children: ComponentChildren;
}): JSX.Element {
	return (
		<section id={anchorId(props.sectionKey)} class="psu-section">
			<div class="psu-section__head">
				<h2 class="psu-section__title">{props.title}</h2>
				{props.hint && <p class="psu-section__hint">{props.hint}</p>}
			</div>
			<div class="psu-section__body">{props.children}</div>
		</section>
	);
}

/**
 * A control plus its verdict, with the field's focus lifecycle tracked at the wrapper.
 *
 * Focus is watched here rather than on the control because `focusin`/`focusout` BUBBLE where `focus`
 * and `blur` do not: one wrapper therefore gives a Select, a number input and a rich-text region the
 * same clear-on-focus behaviour, and none of them has to grow a focus prop it does not have. It also
 * means a control whose panel is body-portalled reads as "left" the moment focus moves into that
 * panel, which is the honest answer — the reader has finished with the field's own box.
 *
 * The message carries a stable id derived from the control's, so a caller that owns a real input can
 * point `aria-describedby` at it. A reference to an element that is not currently rendered is simply
 * skipped by assistive technology, which is why the id may be wired unconditionally.
 */
export function Validated(props: {
	validation: FieldValidation;
	/** Id for the message element — `${controlId}-problem` by convention. */
	messageId?: string;
	children: ComponentChildren;
}): JSX.Element {
	const message = props.validation.message.value;
	return (
		<div
			class="psu-validated"
			onFocusIn={props.validation.handlers.onFocus}
			onFocusOut={props.validation.handlers.onBlur}
		>
			{props.children}
			{message && (
				<p
					class="psu-field__problem"
					id={props.messageId}
					data-status={props.validation.hintStatus.value}
				>
					{message}
				</p>
			)}
		</div>
	);
}

/**
 * One labelled control.
 *
 * `htmlFor` is supplied only for controls that expose a real focusable element with that id — the
 * text and number inputs. The composite controls (Select, SelectButton, Chips) take an `aria-label`
 * instead, so their visible name renders as a `<span>`: a `<label for>` pointing at an id no element
 * carries is worse than no label element at all, because assistive technology follows it and finds
 * nothing.
 *
 * `fieldKey` opts the control into blur-gated validation. It is optional because most fields here
 * have no failing verdict to gate — a dropdown with a default is never wrong — and a guard around
 * one of those would only add a wrapper element.
 */
/**
 * Merge a description id into whatever the control already points at.
 *
 * `aria-describedby` takes a LIST, so a field that has both a hint and a live verdict must reference
 * both — overwriting would silently drop whichever the caller set first. Only a single element child
 * can be cloned; anything else (a fragment, a string, several controls) is left alone and simply keeps
 * the visible-hint fallback, because guessing which of several children is "the control" is how a
 * description ends up attached to a wrapper nobody focuses.
 */
function describedBy(children: ComponentChildren, id: string): ComponentChildren {
	if (!isValidElement(children)) return children;
	const existing = (children.props as { "aria-describedby"?: string })["aria-describedby"];
	const merged = existing ? `${existing} ${id}` : id;
	return cloneElement(children, { "aria-describedby": merged });
}

export function Field(props: {
	label: string;
	htmlFor?: string;
	/**
	 * The static explanation of this field.
	 *
	 * Rendered as an on-demand disclosure behind a "?" beside the label rather than as a permanent line
	 * of prose under the control — a form of this length spends more vertical space on explanations
	 * nobody is reading a second time than on the fields themselves.
	 *
	 * The text is ALWAYS in the DOM, visually hidden, and the control points at it. The popover panel is
	 * body-portalled and unmounted while closed, so an IDREF to the panel would resolve to nothing for
	 * most of the field's life and the description would vanish from the accessibility tree; pointing at
	 * a stable hidden node instead makes the icon a purely VISUAL disclosure of something already
	 * announced. A screen-reader user never has to find and open it.
	 *
	 * This is only for STATIC help. A live verdict stays inline and visible — see {@link Validated}.
	 */
	hint?: string;
	/** Track focus/blur under this key so `fieldStatus` can hold a verdict back until the owner leaves. */
	fieldKey?: string;
	/**
	 * A live verdict to wrap the control in.
	 *
	 * The sibling of `fieldKey`, not a rival: `fieldKey` gates a status the CONTROL already knows how to
	 * paint, and this carries a sentence the control cannot know — so a field that has something to SAY
	 * about why it is incomplete passes this, and one that only has to look required passes the key.
	 */
	validation?: FieldValidation;
	children: ComponentChildren;
}): JSX.Element {
	// Derived from the control's own id where there is one, so it is stable across renders; otherwise
	// from the label, which is unique within a section on this surface.
	const hintId = props.hint
		? `${props.htmlFor ?? `psu-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}-hint`
		: undefined;
	const described = hintId ? describedBy(props.children, hintId) : props.children;

	const body = (
		<>
			<div class="psu-field__labelrow">
				{props.htmlFor
					? <label class="psu-field__label" for={props.htmlFor}>{props.label}</label>
					: <span class="psu-field__label">{props.label}</span>}
				{props.hint && (
					<HintPopover label={`About ${props.label.toLowerCase()}`}>{props.hint}</HintPopover>
				)}
			</div>
			{props.validation
				? (
					<Validated
						validation={props.validation}
						messageId={props.htmlFor ? `${props.htmlFor}-problem` : undefined}
					>
						{described}
					</Validated>
				)
				: described}
			{props.hint && <span id={hintId} class="psu-visually-hidden">{props.hint}</span>}
		</>
	);

	return props.fieldKey
		? <FieldGuard fieldKey={props.fieldKey} class="psu-field">{body}</FieldGuard>
		: <div class="psu-field">{body}</div>;
}

/**
 * Whether a ladder step is still outstanding.
 *
 * Read off the SERVER-derived `setup.steps` rather than re-tested against the data, so the sentence a
 * section shows and the row the progress bar draws are the same verdict. A step this projection does
 * not carry is not outstanding — an absent row is a requirement that does not apply to this shape,
 * which is a different fact from one nobody has satisfied.
 */
function outstanding(setup: ProjectSetup, key: ProjectSetupStepKey): boolean {
	return setup.steps.some((step) => step.key === key && !step.done);
}

/** A note beneath a group of controls — prose, never a chip, never boxed. */
/**
 * A two-column row that becomes a plain block when it has only one child to hold.
 *
 * `.psu-row` is a two-column grid, so a lone `Field` inside it renders against an empty half-width
 * column — and padding the gap with a labelless spacer `Field` would put an unlabelled control in the
 * accessibility tree to fix a visual problem. The wrapper is chosen instead of the class.
 */
function PriceRow(
	{ oneOff, children }: { oneOff: boolean; children: ComponentChildren },
): JSX.Element {
	return oneOff ? <div class="psu-row">{children}</div> : <>{children}</>;
}

function Note({ children }: { children: ComponentChildren }): JSX.Element {
	return <p class="psu-note">{children}</p>;
}

/**
 * A collapsed group of settings that are set once and rarely revisited.
 *
 * Native `<details>`, deliberately. The sections of this form are SERVER components rendered by one
 * island, so a disclosure built on a signal would need its own hydration root for a control whose whole
 * job is to show and hide static markup — and it would collapse to nothing with JavaScript off, taking
 * the fields inside it out of reach. `<details>` is open-able, keyboard-operable and announced as a
 * disclosure with no script at all, and the browser already gives `<summary>` the right role and
 * `aria-expanded` handling. It is the same choice `StageProgressLedger` made for the same reason.
 *
 * Content inside is NOT boxed (§B.4): the summary row and the indent carry the grouping, and a border
 * around a disclosure that already sits inside a section would be the second device on one boundary.
 */
function Disclosure(
	props: { label: string; children: ComponentChildren; open?: boolean },
): JSX.Element {
	return (
		<details class="psu-disclosure" open={props.open}>
			<summary class="psu-disclosure__summary">
				<Icon class="psu-disclosure__chev" name="chevron-down" size="sm" />
				<span class="psu-disclosure__label">{props.label}</span>
			</summary>
			<div class="psu-disclosure__body">{props.children}</div>
		</details>
	);
}
// #endregion

// #region Draft identity
let draftSeq = 0;

/** Mint a client-side id the fat service reads as a CREATE (the `stage-draft-` prefix is the signal). */
function newStageId(): string {
	draftSeq += 1;
	return `stage-draft-${draftSeq}`;
}

/** Mint a client-side id the fat service reads as a role CREATE. */
function newRoleId(): string {
	draftSeq += 1;
	return `role-draft-${draftSeq}`;
}

/** Task and per-stage-role rows are nested inside a stage, so their ids only have to be unique here. */
function newRowId(prefix: string): string {
	draftSeq += 1;
	return `${prefix}-${draftSeq}`;
}

function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
	const next = arr.slice();
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}
// #endregion

// #region Basics
/**
 * The three shape axes, held consistent in ONE patch.
 *
 * `structure` and `sessionKind` are each meaningful inside one format only, so a format change that
 * left either behind would let the ladder and the section set disagree about what is being sold. The
 * owner's has-stages decision is CARRIED ACROSS the change rather than reset — switching a staged
 * pipeline to a one-off is a change of flow, not a statement that the milestones should be discarded.
 */
function normalisedShape(
	setup: ProjectSetup,
	format: ProjectFormat,
): Pick<ProjectSetup, "format" | "structure" | "sessionKind"> {
	if (format === "one_off" && setup.structure === "single_task") {
		return { format, structure: "single_task", sessionKind: "none" };
	}
	return {
		format,
		structure: structureForStages(hasStages(setup.structure), format),
		sessionKind: format === "session"
			? (setup.sessionKind === "group" ? "group" : "normal")
			: "none",
	};
}

/** Identity and shape. */
export function BasicsSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const staged = hasStages(setup.structure);
	const itemLabel = STAGE_ITEM_LABEL[setup.format];
	// A session is not divisible into stages, so it is offered no such choice — the control is ABSENT
	// rather than rendered and disabled, which would state a decision its author never made.
	const divisible = setup.format !== "session";
	/*
	 * The shape freeze, and why these two controls are LOCKED rather than removed.
	 *
	 * Absence is how this form expresses a capability that does not apply (the session's missing
	 * has-stages toggle, two lines up). This is the other case: the shape is still the owner's, it is
	 * simply no longer theirs to CHANGE, and hiding it would delete the answer along with the control
	 * — an owner returning to a staffed pipeline would find no statement anywhere of what they are
	 * selling. Locked keeps the value on screen and puts the reason next to it.
	 *
	 * One predicate for both, because `normalisedShape` writes `format` and `structure` together and
	 * `structureForStages` writes `structure` alone: freezing the type while leaving the toggle open
	 * would be a lock somebody could walk around by turning stages off, stranding every freelancer
	 * hired onto stages 2..n.
	 */
	const shapeFrozen = shapeLocked(setup);
	// Order is Type -> Shape -> Title, and it is a sequence rather than an arrangement: the first two
	// decide WHICH sections the rest of the form renders, so answering them first means the page stops
	// changing shape underneath the owner once they start writing. The name is the thing they are most
	// likely to revise later, which is why it no longer leads.
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
			<Field
				label="Project type"
				hint={shapeFrozen ? SHAPE_LOCK_REASON : FORMAT_HINT[setup.format]}
			>
				<SelectButton
					options={formatOptions(setup.format)}
					value={setup.format}
					onValueChange={(v: string | string[]) =>
						patchSetup(normalisedShape(setup, v as ProjectFormat))}
					disabled={shapeFrozen}
					aria-label="Project type"
				/>
			</Field>

			{
				/*
				 * The toggle drives the EXISTING `structure` axis rather than a boolean of its own.
				 * `projects.structure_variation` already carries `single_stage` for exactly this, and a
				 * parallel flag would be a second answer to one question — the pair would eventually
				 * disagree, and nothing would say which one the board should believe.
				 *
				 * It lives HERE, in Basics, rather than inside the stage section it governs: a control
				 * that can hide the section it sits in is a control the owner cannot use to bring that
				 * section back, and reaching it would mean knowing it was in a place that is no longer
				 * on the page.
				 */
			}
			{divisible && (
				<Field
					label={`Break this into ${itemLabel}s`}
					hint={shapeFrozen
						? SHAPE_LOCK_REASON
						: staged
						? `Each ${itemLabel} is priced, scoped and staffed on its own.`
						: "The project's own scope and price are the whole unit of work."}
				>
					<ToggleSwitch
						value={staged}
						onValueChange={(on: boolean) =>
							patchSetup({ structure: structureForStages(on, setup.format) })}
						disabled={shapeFrozen}
						label={`Use ${STAGE_SECTION_LABEL[setup.format]}`}
					/>
				</Field>
			)}

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

// #region Stage sub-editors
/** The default checklist a ticket on a stage is seeded from. */
function TaskList(props: {
	stage: StageSetup;
	itemLabel: string;
	onPatch: (patch: Partial<StageSetup>) => void;
}): JSX.Element {
	const { stage } = props;

	const patchTask = (id: string, text: string) => {
		props.onPatch({ tasks: stage.tasks.map((t) => (t.id === id ? { ...t, text } : t)) });
	};

	return (
		<Field
			label="Default task list"
			hint="Every ticket opened on this stage starts with these steps."
		>
			<ul class="psu-rows" role="list">
				{stage.tasks.map((task: StageTask, index: number) => (
					<li key={task.id} class="psu-rows__row">
						<InputText
							value={task.text}
							onValueChange={(text: string) =>
								patchTask(task.id, text)}
							block
							maxLength={240}
							placeholder={`Step ${index + 1}`}
							aria-label={`Step ${index + 1}`}
							status={task.text.trim() ? "default" : "required"}
						/>
						<button
							type="button"
							class="psu-stage__remove"
							aria-label={`Remove step ${index + 1}`}
							onClick={() =>
								props.onPatch({ tasks: stage.tasks.filter((t) => t.id !== task.id) })}
						>
							<Icon name="trash" />
						</button>
					</li>
				))}
			</ul>
			<button
				type="button"
				class="psu-add psu-add--sm"
				onClick={() => props.onPatch({
					tasks: [...stage.tasks, { id: newRowId("task"), text: "" }],
				})}
			>
				<Icon name="plus" />
				Add step
			</button>
		</Field>
	);
}

/**
 * Named roles this stage staffs.
 *
 * Distinct from the project-level roles a Direct Deliverable takes: these hang off one stage, and a
 * project may have several sets of them. An empty list is a real answer — the stage is then an
 * unnamed pool governed by its seat settings alone.
 */
function StageRoleList(props: {
	stage: StageSetup;
	currency: string;
	onPatch: (patch: Partial<StageSetup>) => void;
}): JSX.Element {
	const { stage, currency } = props;
	const exponent = currencyExponent(currency);

	const patchRole = (id: string, patch: Partial<StageStaffingRole>) => {
		props.onPatch({ roles: stage.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
	};

	return (
		<Field
			label="Named roles"
			hint={`Leave empty to staff this stage from one open pool instead. ${ROLE_BONUS_HINT}`}
		>
			<ul class="psu-rows" role="list">
				{stage.roles.map((role: StageStaffingRole) => {
					const key = `stage:${stage.id}:role:${role.id}:name`;
					return (
						<li key={role.id} class="psu-rows__row psu-rows__row--wrap">
							<FieldGuard fieldKey={key} class="psu-rows__grow">
								<InputText
									value={role.name}
									onValueChange={(name: string) => patchRole(role.id, { name })}
									block
									maxLength={120}
									placeholder="e.g. Lead designer"
									aria-label="Role name"
									status={fieldStatus(key, role.name.trim() ? "default" : "required")}
								/>
							</FieldGuard>
							<NumberInput
								{...COUNT_FIELD}
								icon="members"
								value={role.quantity}
								onValueChange={(v: number | null) =>
									patchRole(role.id, { quantity: Math.max(1, Math.min(99, Math.round(v ?? 1))) })}
								min={1}
								max={99}
								aria-label={`How many ${role.name || "people"}`}
							/>
							<NumberInput
								{...MONEY_FIELD}
								value={toMajor(role.budgetCents, currency)}
								onValueChange={(v: number | null) =>
									patchRole(role.id, { budgetCents: toMinorUnits(v, currency) })}
								currency={currency}
								maxFractionDigits={exponent}
								minFractionDigits={exponent}
								precisionStep={minorUnit(currency)}
								aria-label={roleBonusLabel(role.name)}
							/>
							<button
								type="button"
								class="psu-stage__remove"
								aria-label={`Remove ${role.name || "role"}`}
								onClick={() =>
									props.onPatch({ roles: stage.roles.filter((r) => r.id !== role.id) })}
							>
								<Icon name="trash" />
							</button>
							<Textarea
								class="psu-rows__note"
								value={role.description}
								onValueChange={(description: string) => patchRole(role.id, { description })}
								rows={2}
								maxLength={ROLE_INSTRUCTIONS_MAX}
								placeholder={ROLE_INSTRUCTIONS_PLACEHOLDER}
								aria-label={roleInstructionsLabel(role.name)}
							/>
						</li>
					);
				})}
			</ul>
			<button
				type="button"
				class="psu-add psu-add--sm"
				onClick={() =>
					props.onPatch({
						roles: [...stage.roles, {
							id: newRowId("srole"),
							name: "",
							quantity: 1,
							description: "",
							budgetCents: null,
						}],
					})}
			>
				<Icon name="plus" />
				Add role
			</button>
		</Field>
	);
}

/**
 * The per-stage NDA override, as THREE states.
 *
 * `null` inherits the project's own term, which is not the same as "not required": a copied boolean
 * goes stale the moment the project-level term changes, and nothing would then say which of the two
 * the stage actually meant. So the control offers Inherit / Required / Not required, and Inherit is
 * what a stage nobody has thought about carries.
 */
function ndaOverrideOptions(projectRequiresNda: boolean): Option[] {
	return [
		{
			value: "inherit",
			label: `Follow the project (${projectRequiresNda ? "NDA required" : "no NDA"})`,
		},
		{ value: "required", label: "Require an NDA for this stage" },
		{ value: "none", label: "No NDA for this stage" },
	];
}

function ndaOverrideValue(value: boolean | null): string {
	if (value === null) return "inherit";
	return value ? "required" : "none";
}

function ndaOverrideFrom(value: string): boolean | null {
	if (value === "required") return true;
	if (value === "none") return false;
	return null;
}
// #endregion

// #region Stage fields
/**
 * Props for {@link StageFields}.
 *
 * Everything here is resolved by the CALLER, and the two that look like they could be resolved
 * locally are the reason. `predecessorOptions` and `priceLocked` are both answers about the whole
 * stage LIST — which stages this one may legally wait for, and which stages a hired freelancer has
 * frozen the price of — so a component that asked for them itself would need the project it is a
 * part of and would rebuild an identical answer once per stage in the accordion.
 */
export interface StageFieldsProps {
	/** The stage being configured. */
	stage: StageSetup;
	/**
	 * Its 0-based position in the run.
	 *
	 * Load-bearing rather than cosmetic: the predecessor + lag pair is asked only of a sequential
	 * stage that is not the FIRST, because the first has nothing above it to wait for. Rendering
	 * those controls at position 0 would be a live affordance whose value the board never reads
	 * (root CLAUDE.md §3 gate 11).
	 */
	index: number;
	/** What one of these is called in this engagement's vocabulary — stage · milestone · session. */
	itemLabel: string;
	/** Whether the engagement is a session — it changes what two of these fields are asking for. */
	session: boolean;
	/** Whether the engagement is a one-off — only a milestone is asked for a delivery DATE. */
	oneOff: boolean;
	/** The stages this one may legally wait for: never itself, never one whose chain leads back here. */
	predecessorOptions: Option[];
	/** The engagement's currency, for the price field's exponent and its symbol. */
	currency: string;
	/** Whether the PROJECT requires an NDA — it decides what this stage's override may say. */
	projectRequiresNda: boolean;
	/**
	 * Whether THIS stage's own price is frozen by somebody already working it.
	 *
	 * A boolean rather than the set, and resolved by the caller rather than here: see the note on
	 * {@link StageFieldsProps} above.
	 */
	priceLocked: boolean;
	/** Fold an edit into the stage. The caller owns the identity match against the stage list. */
	onPatch: (patch: Partial<StageSetup>) => void;
}

/**
 * StageFields — everything a stage IS, as controls: its name, its scope, what it delivers, its step
 * list, the skills it needs, its price and timing, its capacity and named roles, and the submission
 * and confidentiality rules that apply to it.
 *
 * Extracted from {@link StageRow}'s expanded body so the accordion on `/projects/[projectId]` and
 * the standalone Stage Details tab at `/projects/[projectId]/[channelId]/details` are ONE component
 * tree rather than two forms that happen to agree on the day they were written. What separates the
 * two surfaces is chrome — the card owns the grip, the summary row, the disclosure and the remove
 * button; the tab owns a heading and nothing else — so the fields are the whole of what they share
 * and therefore the whole of what could drift.
 *
 * It renders a FRAGMENT, not a container. `.psu-stage__body` carries a hairline and an inset because
 * it is the open half of an accordion row; on the standalone tab there is no row above it for a
 * hairline to separate from, and drawing one anyway would be a separation device spent on a boundary
 * that does not exist (§B.4). The caller supplies whichever container it needs — the card its
 * `.psu-stage__body`, the tab the `Section` body it is already inside, both of which are the same
 * `flex column` with the same gap.
 *
 * The two field verdicts are HOOKS and live here rather than being passed in. A caller that resolved
 * them would have to restate their sentences, which is exactly the drift the extraction removes. The
 * cost is that a stage collapsed and re-expanded in the accordion starts untouched again, so a gate
 * that had appeared stands down until the field is left once more or Save demands every verdict. The
 * fact itself is never lost: the collapsed row's middot line carries the same two requirements and
 * is visible in both states.
 */
export function StageFields(props: StageFieldsProps): JSX.Element {
	const { stage, currency, itemLabel, session, predecessorOptions } = props;
	const scoped = stage.description.trim().length > 0;
	const priced = stage.unitPriceCents !== null;
	const fieldId = (part: string) => `psu-stage-${stage.id}-${part}`;
	const nameKey = `stage:${stage.id}:name`;
	const exponent = currencyExponent(currency);
	// `gate`, not `invalid`: neither of these is a wrong value, it is an unfinished one. The ramp says
	// "this is what publishing is waiting on" rather than "you have made a mistake", which is what the
	// same two facts already read as in the collapsed row's middot line.
	const scope = useFieldValidation({
		problem: scoped ? null : `Say what this ${itemLabel} delivers.`,
		reveal: setupReveal,
		problemStatus: "gate",
	});
	// A frozen price is not an unfinished one, so the gate stands down rather than accusing a field the
	// owner is forbidden to complete. Unlocked, this is the original verdict unchanged.
	const price = useFieldValidation({
		problem: priced || props.priceLocked ? null : `Give this ${itemLabel} a price.`,
		reveal: setupReveal,
		problemStatus: "gate",
	});
	const priceLabel = session ? "Session price" : itemLabel === "milestone" ? "Fee" : "Ticket price";

	return (
		<>
			<Field label="Name" htmlFor={fieldId("name")} fieldKey={nameKey}>
				<InputText
					id={fieldId("name")}
					aria-describedby={`${fieldId("name")}-problem`}
					value={stage.name}
					onValueChange={(next: string) => props.onPatch({ name: next })}
					block
					maxLength={120}
					placeholder="e.g. Discovery"
					status={fieldStatus(nameKey, stage.name.trim() ? "default" : "required")}
				/>
			</Field>

			<Field label="Scope" validation={scope}>
				<RichTextEditor
					key={stage.id}
					value={stage.description}
					onValueChange={(description: string) => props.onPatch({ description })}
					placeholder="Deliverables, acceptance criteria, delivery notes…"
					status={scope.status.value}
					minRows={3}
					aria-label={`Scope for ${stage.name || itemLabel}`}
				/>
			</Field>

			{
				/*
				 * `milestone` sits with Scope rather than with the timing fields, because it is the
				 * OUTCOME half of "what does this stage deliver" — a sentence, not a schedule. The
				 * columns that answer WHEN are below it.
				 */
			}
			<Field
				label={session ? "Duration" : "Delivery"}
				htmlFor={fieldId("milestone")}
			>
				<InputText
					id={fieldId("milestone")}
					value={stage.milestone}
					onValueChange={(milestone: string) => props.onPatch({ milestone })}
					block
					maxLength={240}
					placeholder={session ? "e.g. 60 minutes" : "e.g. 2 weeks"}
				/>
			</Field>

			<TaskList stage={stage} itemLabel={props.itemLabel} onPatch={props.onPatch} />

			{!session && (
				<Field
					label="Required skills"
					hint="Up to ten. A stage asking for twenty is asking for nobody."
				>
					<Chips
						value={stage.skills}
						onValueChange={(skills: string[]) => props.onPatch({ skills })}
						placeholder="Add a skill…"
						max={MAX_STAGE_SKILLS}
						addOnBlur
						aria-label={`Required skills for ${stage.name || props.itemLabel}`}
					/>
				</Field>
			)}

			{
				/*
				 * A delivery DATE belongs to a milestone and to nothing else, so the row is a PAIR on a
				 * one-off and a lone field on a pipeline — never a pair with an empty half. A pipeline
				 * stage's timing is its predecessor plus its lag, and offering a calendar date beside
				 * that would be a second answer to when the stage starts, with nothing to say which one
				 * the board should draw.
				 */
			}
			<PriceRow oneOff={props.oneOff}>
				{
					/*
					 * The lock reason arrives as the `hint`, so it is announced through the control's own
					 * `aria-describedby` and disclosed behind the "?" — never a native `title` (§B.6),
					 * which is unreachable by keyboard and unreadable to a screen reader. This field
					 * carries no hint otherwise, so nothing is displaced to make room for it.
					 */
				}
				<Field
					label={priceLabel}
					htmlFor={fieldId("price")}
					validation={price}
					hint={props.priceLocked ? STAGE_PRICE_LOCK_REASON : undefined}
				>
					<NumberInput
						{...MONEY_FIELD}
						id={fieldId("price")}
						value={toMajor(stage.unitPriceCents, currency)}
						onValueChange={(v: number | null) =>
							props.onPatch({ unitPriceCents: toMinorUnits(v, currency) })}
						currency={currency}
						maxFractionDigits={exponent}
						minFractionDigits={exponent}
						precisionStep={minorUnit(currency)}
						disabled={props.priceLocked}
						status={price.status.value}
					/>
				</Field>

				{props.oneOff && (
					<Field label="Delivery date" hint="Leave empty for no fixed date.">
						<DatePicker
							value={fromIsoDate(stage.deliveryDate)}
							onValueChange={(v: DateValue) => props.onPatch({ deliveryDate: toIsoDate(v) })}
							aria-label={`Delivery date for ${stage.name || props.itemLabel}`}
						/>
					</Field>
				)}
			</PriceRow>

			<div class="psu-row">
				<Field label="Starts">
					<Select
						options={DEPENDENCY_OPTIONS}
						value={stage.dependency}
						onValueChange={(v: string) => props.onPatch({ dependency: v as StageDependency })}
						aria-label={`When ${stage.name || props.itemLabel} starts`}
					/>
				</Field>

				<Field label="Capacity">
					<SelectButton
						options={CAPACITY_OPTIONS}
						value={stage.capacity}
						onValueChange={(v: string | string[]) =>
							props.onPatch(normaliseSeats(v as StageCapacity, stage.seatCount))}
						aria-label="Capacity"
					/>
				</Field>
			</div>

			{
				/*
				 * Predecessor and lag are asked ONLY of a sequential stage that is not the first, and
				 * that is the whole condition. A parallel stage starts with the project, so it waits for
				 * nothing; the first stage has nothing above it to wait for. Rendering either control in
				 * those cases would be a live affordance whose value the board never reads (§3 gate 11).
				 */
			}
			{stage.dependency === "sequential" && props.index > 0 && (
				<div class="psu-row">
					<Field label="Starts with" htmlFor={fieldId("startswith")}>
						<Select
							options={predecessorOptions}
							value={stage.startsWithId ?? ""}
							onValueChange={(v: string) => props.onPatch({ startsWithId: v === "" ? null : v })}
							aria-label={`Which ${props.itemLabel} ${stage.name || props.itemLabel} follows`}
						/>
					</Field>

					<Field
						label="Delay"
						htmlFor={fieldId("delay")}
						hint="Days after it finishes. Negative starts early, overlapping it."
					>
						<NumberInput
							{...COUNT_FIELD}
							icon="clock"
							id={fieldId("delay")}
							value={stage.delayDays}
							onValueChange={(v: number | null) => props.onPatch({ delayDays: clampDelay(v) })}
							min={-STAGE_DELAY_MAX_DAYS}
							max={STAGE_DELAY_MAX_DAYS}
							suffix=" days"
						/>
					</Field>
				</div>
			)}

			{stage.capacity === "limited" && (
				<Field label="Seats" htmlFor={fieldId("seats")}>
					<NumberInput
						{...COUNT_FIELD}
						icon="members"
						id={fieldId("seats")}
						value={stage.seatCount}
						onValueChange={(v: number | null) =>
							props.onPatch(
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

			<StageRoleList stage={stage} currency={currency} onPatch={props.onPatch} />

			<Disclosure label="Advanced settings">
				<div class="psu-row">
					<Field
						label="Accepted deliverables"
						hint="Leave empty to accept any file."
					>
						<MultiSelect
							options={FILE_KIND_OPTIONS}
							value={stage.allowedFileKinds}
							onValueChange={(allowedFileKinds: string[]) => props.onPatch({ allowedFileKinds })}
							placeholder="Any file"
							showClear
							aria-label={`Accepted deliverables for ${stage.name || props.itemLabel}`}
						/>
					</Field>

					<Field label="NDA">
						<Select
							options={ndaOverrideOptions(props.projectRequiresNda)}
							value={ndaOverrideValue(stage.ndaRequired)}
							onValueChange={(v: string) => props.onPatch({ ndaRequired: ndaOverrideFrom(v) })}
							aria-label={`NDA for ${stage.name || props.itemLabel}`}
						/>
					</Field>
				</div>
			</Disclosure>
		</>
	);
}
// #endregion

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

			<div class="psu-row">
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

				<Field label="Capacity">
					<SelectButton
						options={CAPACITY_OPTIONS}
						value={root.capacity}
						onValueChange={(v: string | string[]) =>
							patchRoot(normaliseSeats(v as StageCapacity, root.seatCount))}
						aria-label="Capacity"
					/>
				</Field>
			</div>

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

			<StageRoleList stage={root} currency={currency} onPatch={patchRoot} />
		</Section>
	);
}
// #endregion

// #region Role list
/** The staffing roles a Direct Deliverable takes instead of a stage run. */
export function RoleListSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const currency = setup.budget.currency;
	const exponent = currencyExponent(currency);

	const add = () => {
		patchSetup({
			roles: [...setup.roles, {
				id: newRoleId(),
				name: `Role ${setup.roles.length + 1}`,
				skills: [],
				description: "",
				budgetCents: null,
			}],
		});
	};

	const patchRow = (id: string, patch: Partial<ProjectRoleSetup>) => {
		patchSetup({ roles: setup.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
	};

	const remove = (id: string) => {
		patchSetup({ roles: setup.roles.filter((r) => r.id !== id) });
	};

	return (
		<Section sectionKey="roles" title={ROLE_SECTION_LABEL} hint={hint}>
			<ul class="psu-list" aria-label={ROLE_SECTION_LABEL}>
				{setup.roles.map((role) => {
					const nameKey = `role:${role.id}:name`;
					return (
						<li key={role.id} class="psu-role">
							<div class="psu-role__head">
								<Field label="Role name" htmlFor={`psu-role-${role.id}-name`} fieldKey={nameKey}>
									<InputText
										id={`psu-role-${role.id}-name`}
										value={role.name}
										onValueChange={(name: string) => patchRow(role.id, { name })}
										block
										maxLength={120}
										placeholder="e.g. Lead designer"
										status={fieldStatus(nameKey, role.name.trim() ? "default" : "required")}
									/>
								</Field>
								<button
									type="button"
									class="psu-stage__remove"
									aria-label={`Remove ${role.name || "role"}`}
									onClick={() => remove(role.id)}
								>
									<Icon name="trash" />
								</button>
							</div>

							<div class="psu-row">
								<Field label="Skills">
									<Chips
										value={role.skills}
										onValueChange={(skills: string[]) => patchRow(role.id, { skills })}
										placeholder="Add a skill…"
										max={20}
										addOnBlur
										aria-label={`Skills for ${role.name || "role"}`}
									/>
								</Field>
								{
									/*
									 * `default`, never `gate`. The amber ramp says "publishing is waiting on this",
									 * and it is not: a role bonus is optional and {@link setupSteps} does not count
									 * it. Painting it would report a requirement the ladder one region away says
									 * does not exist.
									 */
								}
								<Field
									label="Role bonus"
									htmlFor={`psu-role-${role.id}-budget`}
									hint={ROLE_BONUS_HINT}
								>
									<NumberInput
										{...MONEY_FIELD}
										id={`psu-role-${role.id}-budget`}
										value={toMajor(role.budgetCents, currency)}
										onValueChange={(v: number | null) =>
											patchRow(role.id, { budgetCents: toMinorUnits(v, currency) })}
										currency={currency}
										maxFractionDigits={exponent}
										minFractionDigits={exponent}
										precisionStep={minorUnit(currency)}
										aria-label={roleBonusLabel(role.name)}
									/>
								</Field>
							</div>

							<Field label="Additional instructions" htmlFor={`psu-role-${role.id}-notes`}>
								<Textarea
									id={`psu-role-${role.id}-notes`}
									value={role.description}
									onValueChange={(description: string) => patchRow(role.id, { description })}
									rows={2}
									maxLength={ROLE_INSTRUCTIONS_MAX}
									placeholder={ROLE_INSTRUCTIONS_PLACEHOLDER}
									aria-label={roleInstructionsLabel(role.name)}
								/>
							</Field>
						</li>
					);
				})}
				{setup.roles.length === 0 && (
					<li class="psu-list__empty">
						No roles yet. A direct deliverable is staffed by roles rather than by stages.
					</li>
				)}
			</ul>

			<button type="button" class="psu-add" onClick={add}>
				<Icon name="plus" />
				Add role
			</button>
		</Section>
	);
}
// #endregion

// #region Attachments & NDA
const ATTACHMENT_PICKER = "psu-attachments";
const NDA_PICKER = "psu-nda";

/** The library an upload is filed in, resolved from the session on first use. */
async function actingOwnerId(): Promise<string | null> {
	const me = await AccountService.current();
	return me?.userId ?? null;
}

/**
 * Reference files, and the NDA the engagement is offered under.
 *
 * An attachment is carried by `files.items` REFERENCE, never by URL, so the same asset can be a
 * project brief here and a submission deliverable elsewhere without the bytes having two lifetimes.
 * That is why both paths — picking from the library and uploading from the device — end in an asset
 * id: the upload is a way of getting a file INTO the library, not a second kind of attachment.
 */
export function AttachmentsSection({ setup }: { setup: ProjectSetup }): JSX.Element {
	const busy = useSignal(false);
	const failure = useSignal<string | null>(null);
	const rules = setup.rules;
	const room = MAX_PROJECT_ATTACHMENTS - setup.attachments.length;

	const addAttachments = (items: ProjectAttachment[]) => {
		if (items.length === 0) return;
		const held = new Set(setup.attachments.map((a) => a.id));
		const fresh = items.filter((a) => !held.has(a.id));
		if (fresh.length === 0) return;
		patchSetup({
			attachments: [...setup.attachments, ...fresh].slice(0, MAX_PROJECT_ATTACHMENTS),
		});
	};

	const fromLibrary = (assets: AssetItem[]) => {
		addAttachments(
			assets.map((a) => ({ id: a.id, name: a.name, sizeBytes: a.sizeBytes ?? null })),
		);
	};

	/**
	 * Upload device files into the owner's library, then attach what landed.
	 *
	 * A partial success is kept rather than refused: three of four references arriving is still three
	 * useful references, and the one that failed is named so it can be retried. That is the opposite
	 * of the chat composer's rule, and deliberately — a message is a statement about the things
	 * attached to it, where a reference pack is a pack.
	 */
	const fromDevice = async (files: File[]) => {
		if (files.length === 0 || busy.value) return;
		busy.value = true;
		failure.value = null;
		try {
			const ownerId = await actingOwnerId();
			if (!ownerId) {
				failure.value =
					"We could not tell whose library to file these in — sign in again and retry.";
				return;
			}
			const sent = files.slice(0, Math.max(0, room));
			const outcome = await uploadForProject(sent, {
				ownerType: "user",
				ownerId,
				metadataFor: extractMetadata,
			});

			// `assetIds` keeps the caller's ORDER but drops the files that did not land, so it cannot be
			// zipped against `sent` by index: one failure at position 0 would name every asset after it
			// with the file before it. The failed positions are removed from `sent` first, which leaves
			// two lists that are the same length and in the same order by construction.
			const failedAt = new Set(outcome.failures.map((f) => f.index));
			const kept = sent.filter((_, i) => !failedAt.has(i));
			addAttachments(
				outcome.assetIds.map((id, i) => ({
					id,
					name: kept[i]?.name ?? id,
					sizeBytes: kept[i]?.size ?? null,
				})),
			);

			if (outcome.failures.length > 0) {
				failure.value = `${
					outcome.failures.map((f) => f.name).join(", ")
				} could not be uploaded. Everything else was attached.`;
			}
		} finally {
			busy.value = false;
		}
	};

	const onFileInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
		const picked = event.currentTarget.files;
		if (picked) void fromDevice(Array.from(picked));
		event.currentTarget.value = "";
	};

	return (
		<Section sectionKey="attachments" title="Attachments & NDA">
			<Field
				label="Reference files"
				hint={`Briefs, brand sheets, specs. Up to ${MAX_PROJECT_ATTACHMENTS}.`}
			>
				<ul class="psu-rows" role="list">
					{setup.attachments.map((file) => (
						<li key={file.id} class="psu-file">
							<Icon class="psu-file__glyph" name="attachment" size="sm" />
							<span class="psu-file__name">{file.name}</span>
							{file.sizeBytes !== null && (
								<span class="psu-file__meta">{formatBytes(file.sizeBytes)}</span>
							)}
							<button
								type="button"
								class="psu-stage__remove"
								aria-label={`Remove ${file.name}`}
								onClick={() =>
									patchSetup({
										attachments: setup.attachments.filter((a) => a.id !== file.id),
									})}
							>
								<Icon name="trash" />
							</button>
						</li>
					))}
					{setup.attachments.length === 0 && <li class="psu-list__empty">Nothing attached yet.</li>}
				</ul>

				<div class="psu-actions">
					<button
						type="button"
						class="psu-add psu-add--sm"
						disabled={room <= 0 || busy.value}
						onClick={() =>
							openPicker({
								requesterId: ATTACHMENT_PICKER,
								title: "Attach from your files",
								multiple: true,
								max: Math.max(1, room),
							})}
					>
						<Icon name="attachment" />
						Add from your files
					</button>

					<label class="psu-add psu-add--sm" data-disabled={room <= 0 || busy.value || undefined}>
						<Icon name="upload" />
						{busy.value ? "Uploading…" : "Upload"}
						<input
							type="file"
							class="psu-visually-hidden"
							multiple
							disabled={room <= 0 || busy.value}
							onChange={onFileInput}
						/>
					</label>
				</div>

				{failure.value && <Note>{failure.value}</Note>}
				{room <= 0 && <Note>That is the limit — remove one to attach another.</Note>}
			</Field>

			<div class="psu-toggles">
				<Checkbox
					value={rules.ndaRequired}
					onValueChange={(ndaRequired: boolean) => patchSetup({ rules: { ndaRequired } })}
					label="Require an NDA before work begins"
				/>
			</div>

			{rules.ndaRequired && (
				<>
					<Field
						label="Which NDA"
						hint="The platform's standard mutual NDA needs no upload and no legal review."
					>
						<SelectButton
							options={[
								{ value: "platform", label: "Projective standard" },
								{ value: "custom", label: "Your own document" },
							]}
							value={rules.ndaSource}
							onValueChange={(v: string | string[]) =>
								patchSetup({
									rules: {
										ndaSource: v as NdaDocumentSource,
										// Dropping the reference when the source goes back to the platform standard:
										// leaving it behind would keep a document id nothing points at, which reads
										// on the next open as a custom NDA that is not in force.
										ndaDocumentId: v === "custom" ? rules.ndaDocumentId : null,
									},
								})}
							aria-label="Which NDA"
						/>
					</Field>

					{rules.ndaSource === "custom" && (
						<Field
							label="NDA document"
							hint="Freelancers sign this before they can see the stage they are applying to."
						>
							{rules.ndaDocumentId
								? (
									<div class="psu-file">
										<Icon class="psu-file__glyph" name="document" size="sm" />
										<span class="psu-file__name">{rules.ndaDocumentId}</span>
										<button
											type="button"
											class="psu-stage__remove"
											aria-label="Remove the NDA document"
											onClick={() => patchSetup({ rules: { ndaDocumentId: null } })}
										>
											<Icon name="trash" />
										</button>
									</div>
								)
								: (
									<>
										<button
											type="button"
											class="psu-add psu-add--sm"
											onClick={() =>
												openPicker({
													requesterId: NDA_PICKER,
													title: "Choose your NDA",
													kinds: ["pdf", "doc"],
													multiple: false,
												})}
										>
											<Icon name="document" />
											Choose a document
										</button>
										<Note>
											You have chosen your own NDA and not attached it yet — the engagement cannot
											be published until you do.
										</Note>
									</>
								)}
						</Field>
					)}
				</>
			)}

			<AssetPicker requesterId={ATTACHMENT_PICKER} onPick={fromLibrary} />
			<AssetPicker
				requesterId={NDA_PICKER}
				onPick={(assets: AssetItem[]) => {
					const doc = assets[0];
					if (doc) patchSetup({ rules: { ndaDocumentId: doc.id } });
				}}
			/>
		</Section>
	);
}
// #endregion

// #region Terms & visibility
/**
 * The terms the engagement is offered under — every one of them a term a freelancer agrees to.
 *
 * Visibility governs TWO facts that a single dropdown would conflate, so the control is scoped to
 * one of them and the note carries the other — and each reads its own field rather than inferring
 * the second from the first. `rules.visibility` is the intent ON PUBLISH, stored on its own column;
 * `setup.liveVisibility` is where the row sits today, derived server-side from the status.
 *
 * Scoping it this way is what keeps the label honest. A dropdown labelled plain "Visibility" showing
 * `public` over a row that is unlisted would be stating something false; the same dropdown showing
 * `unlisted` would hide the decision the owner actually needs to make before publishing. Naming the
 * control for the moment it takes effect lets it show a real stored value and still answer the
 * question the owner is actually asking.
 *
 * The note reads `liveVisibility` rather than re-deriving "draft implies unlisted" from the status.
 * The two agree on every row this surface writes — the update path converges them on every save —
 * but a second derivation here could disagree with the server's on a row written before the intent
 * column existed, and the failure mode of that disagreement is telling an owner their project is
 * hidden while it is on Explore.
 */
export function RulesSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const rules = setup.rules;
	const isDraft = setup.status === "draft";
	const hidden = setup.liveVisibility !== "public";
	const deferred = isDraft || setup.liveVisibility !== rules.visibility;

	return (
		<Section sectionKey="rules" title="Terms & visibility" hint={hint}>
			<div class="psu-row">
				<Field
					label="Visibility on publish"
					hint={deferred
						? "This is what applies the moment you publish."
						: "Live now — changes here take effect immediately."}
				>
					<Select
						options={optionsOf(VISIBILITY_LABEL)}
						value={rules.visibility}
						onValueChange={(v: string) =>
							patchSetup({ rules: { visibility: v as ProjectVisibility } })}
						aria-label="Visibility on publish"
					/>
				</Field>
				<Field label="Timeline">
					<Select
						options={optionsOf(TIMELINE_LABEL)}
						value={rules.timelinePreset}
						onValueChange={(v: string) =>
							patchSetup({ rules: { timelinePreset: v as TimelinePreset } })}
						aria-label="Timeline"
					/>
				</Field>
			</div>

			{deferred && (
				<Note>
					{hidden
						? `Right now this project is ${
							VISIBILITY_LABEL[setup.liveVisibility].toLowerCase()
						}, so nothing half-written reaches Explore.`
						: "Right now this project is public."} {isDraft
						? "It stays that way until you publish it."
						: "The setting above applies once its status changes."}
				</Note>
			)}

			<div class="psu-row">
				<Field label="Locations" hint="Leave empty to accept freelancers anywhere.">
					<MultiSelect
						options={LOCATION_OPTIONS}
						value={rules.locationRestriction}
						onValueChange={(locationRestriction: string[]) =>
							patchSetup({ rules: { locationRestriction } })}
						placeholder="Anywhere"
						filter
						grouping
						showClear
						aria-label="Locations"
					/>
				</Field>
				<Field label="Languages" hint="Leave empty to accept any language.">
					<MultiSelect
						options={LANGUAGE_OPTIONS}
						value={rules.languageRequirement}
						onValueChange={(languageRequirement: string[]) =>
							patchSetup({ rules: { languageRequirement } })}
						placeholder="Any language"
						filter
						showClear
						aria-label="Languages"
					/>
				</Field>
			</div>

			{
				/*
				 * Everything below is set once and rarely revisited — the money's unit, who ends up owning
				 * the work, whether it can be shown, and the bonus rule. They are all real terms a
				 * freelancer agrees to, so none of them is dropped; they are simply not in the reading path
				 * of a form somebody fills in from the top every time.
				 *
				 * Visibility, timeline, locations and languages deliberately stay ABOVE this fold: they are
				 * publication and matching terms that decide who ever sees the engagement, which is a
				 * decision the owner is making right now rather than a default they inherited.
				 */
			}
			<Disclosure label="Advanced options">
				<Field
					label="Currency"
					hint="Every figure on this page is priced in it. Changing it relabels those figures; it does not convert them."
				>
					<Select
						options={CURRENCY_OPTIONS}
						value={setup.budget.currency}
						onValueChange={(next: string) => patchSetup({ budget: { currency: next } })}
						filter
						aria-label="Currency"
					/>
				</Field>

				<div class="psu-row">
					<Field label="Ownership of the work">
						<Select
							options={optionsOf(IP_LABEL)}
							value={rules.ipOwnershipMode}
							onValueChange={(v: string) =>
								patchSetup({ rules: { ipOwnershipMode: v as IpOwnershipMode } })}
							aria-label="Ownership of the work"
						/>
					</Field>
					<Field label="Portfolio rights">
						<Select
							options={optionsOf(PORTFOLIO_LABEL)}
							value={rules.portfolioDisplayRights}
							onValueChange={(v: string) =>
								patchSetup({ rules: { portfolioDisplayRights: v as PortfolioDisplayRights } })}
							aria-label="Portfolio rights"
						/>
					</Field>
				</div>

				{
					/*
					 * A deadline bonus is paid per TICKET, and only a pipeline has tickets. On every other
					 * format the control is ABSENT rather than disabled: absence is for a capability that does
					 * not exist here, and a greyed switch would advertise one that does.
					 */
				}
				{setup.format === "pipeline" && (
					<div class="psu-toggles">
						<ToggleSwitch
							value={rules.allowDeadlineBonuses}
							onValueChange={(allowDeadlineBonuses: boolean) =>
								patchSetup({ rules: { allowDeadlineBonuses } })}
							label="Allow deadline bonuses on tickets"
						/>
						<Note>
							A freelancer who delivers a ticket ahead of its due date earns an extra{" "}
							{DEADLINE_BONUS_PERCENT}% of its price. Pipelines only — a one-off has one deadline,
							which is the delivery itself.
						</Note>
					</div>
				)}
			</Disclosure>
		</Section>
	);
}
// #endregion

// #region Dispatch
/** The ladder hint for a section's requirement, or `undefined` once it is satisfied. */
export function hintFor(setup: ProjectSetup, key: ProjectSetupStepKey): string | undefined {
	const step = setup.steps.find((s) => s.key === key);
	if (!step || step.done || !step.hint) return undefined;
	return step.hint;
}

/** Render one section by key, wired to the ladder hint that measures it. */
export function SetupSection(
	{ setup, section }: { setup: ProjectSetup; section: SetupSectionKey },
): JSX.Element | null {
	switch (section) {
		case "basics":
			return <BasicsSection setup={setup} hint={hintFor(setup, "title")} />;
		case "description":
			return <DescriptionSection setup={setup} hint={hintFor(setup, "description")} />;
		case "details":
			return <FlatDetailsSection setup={setup} hint={hintFor(setup, "pricing")} />;
		case "budget":
			return <BudgetSection setup={setup} hint={hintFor(setup, "pricing")} />;
		case "stages":
			// TWO rungs land on this one section, and it is the only section they can land on: with the
			// Budget section withheld from a staged run, `pricing` has no other home and would otherwise
			// be a requirement stated nowhere on the page. `stages` is preferred while it is outstanding
			// because the two are ordered in fact — there is no stage to price until one exists — so the
			// hint always names the thing the owner can actually do next.
			return (
				<StageListSection
					setup={setup}
					hint={hintFor(setup, "stages") ?? hintFor(setup, "pricing")}
				/>
			);
		case "roles":
			return <RoleListSection setup={setup} hint={hintFor(setup, "roles")} />;
		case "attachments":
			return <AttachmentsSection setup={setup} />;
		case "rules":
			return <RulesSection setup={setup} hint={hintFor(setup, "rules")} />;
	}
	return null;
}
// #endregion
