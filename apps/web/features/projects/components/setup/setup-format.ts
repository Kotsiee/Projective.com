import type { DateValue, Option } from "@projective/ui/fields";
import { currencyExponent, DISPLAY_CURRENCIES } from "@projective/types/finance";
import { FileKind } from "@projective/types/files";
import {
	DEADLINE_BONUS_RATE,
	PROJECT_TYPE_HINT,
	PROJECT_TYPE_LABEL,
	ProjectTypeChoice,
	projectTypeOf,
	STAGE_DELAY_MAX_DAYS,
} from "../../types/projects-types.ts";
import type {
	IpOwnershipMode,
	PortfolioDisplayRights,
	ProjectFormat,
	ProjectSetup,
	ProjectVisibility,
	TimelinePreset,
} from "../../types/projects-types.ts";

/**
 * setup-format — the words and the numbers behind the Stage-2 setup form's controls: the label maps and
 * option lists every section's selects read, and the conversions between what the schema stores and
 * what a person types (minor units, ISO dates, clamped lags).
 *
 * Pure data and pure functions, with no JSX, so every section module reads one copy of each and the
 * two role editors, the two capacity groups and the four money fields cannot drift apart.
 */

// #region Label maps
/**
 * The human words for each enum member.
 *
 * Written as exhaustive `Record`s keyed on the SSOT enum types rather than as free option arrays, so
 * a member added to the schema fails to compile here instead of quietly rendering a dropdown that is
 * missing one of its own values.
 */
export const VISIBILITY_LABEL: Record<ProjectVisibility, string> = {
	public: "Public — listed on Explore",
	invite_only: "Invite only — reachable by invitation",
	unlisted: "Unlisted — reachable by link",
};

export const IP_LABEL: Record<IpOwnershipMode, string> = {
	exclusive_transfer: "Exclusive transfer to the client",
	licensed_use: "Licensed use",
	shared_ownership: "Shared ownership",
	projective_partner: "Projective partner terms",
};

export const PORTFOLIO_LABEL: Record<PortfolioDisplayRights, string> = {
	allowed: "May be shown publicly",
	forbidden: "May not be shown",
	embargoed: "May be shown after an embargo",
};

export const TIMELINE_LABEL: Record<TimelinePreset, string> = {
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
export function optionsOf<K extends string>(labels: Record<K, string>): Option[] {
	return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
}

/**
 * The SESSION segment, appended only to an engagement that already is one.
 *
 * A session is a service a freelancer sells, not a project a client posts — which is why
 * {@link ProjectTypeChoice} has three members and none of them is this. Offering it here as a target
 * would reintroduce exactly what the create modal refuses: a buyer minting an engagement with no
 * seller and no schedule. An existing session still has to be editable, so the option appears only
 * on a project that is one, and is then the value it is already set to rather than a destination.
 */
export const SESSION_TYPE_VALUE = "session";

/**
 * The type segments this engagement may show: the three the product offers, plus `session` where the
 * engagement already is one.
 *
 * Derived from the SSOT enum's own members rather than restated, so the settings selector, the create
 * modal and the lane's create menu are three renderings of one list.
 */
export function typeOptions(format: ProjectFormat): Option[] {
	const base: Option[] = ProjectTypeChoice.options.map((value) => ({
		value,
		label: PROJECT_TYPE_LABEL[value],
	}));
	return format === "session" ? [...base, { value: SESSION_TYPE_VALUE, label: "Sessions" }] : base;
}

/**
 * The sentence under the selector. The three product types read theirs from the SSOT; a session gets
 * its own, because it is a shape this form can describe and never offer.
 */
export function typeHint(setup: ProjectSetup): string {
	const type = projectTypeOf(setup.format, setup.structure);
	return type
		? PROJECT_TYPE_HINT[type]
		: "Booked time rather than tickets — one-to-one or a cohort.";
}

/*
 * TWO retired controls, and the one that replaced them.
 *
 * First a four-segment Shape control asked one question in two vocabularies — a pipeline chose
 * between "Staged" and "Single stage" while a one-off chose between "Milestones" and "Direct
 * deliverable" — so a reader had to learn two words for yes and two for no, and switching format
 * switched the vocabulary underneath them. It became a Type selector plus a has-stages TOGGLE, which
 * asked the bit directly but still spent two controls and four combinations on three products: one
 * combination (a pipeline with stages off) named a shape nothing in the product has a word for, and
 * two others were the same product stored differently depending on which surface minted it.
 *
 * Both are now the single three-segment selector in {@link BasicsSection}. `columnsForProjectType` is
 * the one mapping onto the stored pair and `projectTypeOf` reads it back, so the form, the create
 * modal and the lane's create menu are three renderings of one list.
 *
 * Two consequences worth stating. `single_task` — the Direct Deliverable — is reachable again, and
 * deliberately: it is what **Task** writes. And `single_stage` is no longer reachable at all, because
 * no type maps to it; a project already stored that way keeps rendering (`setupSections` still routes
 * a stage-less engagement to `details`) and reads as the type its FORMAT implies, so a stage-less
 * one-off shows as a Task and a stage-less pipeline as a Pipeline. Picking a different type converts
 * it, which is the escape.
 */

/** The uplift the deadline-bonus offer is stated as, from the one constant that carries the rate. */
export const DEADLINE_BONUS_PERCENT = Math.round(DEADLINE_BONUS_RATE * 100);

export const SESSION_KIND_OPTIONS: Option[] = [
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
export const LEGACY_HOURLY_NOTE =
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
export const ROLE_BONUS_HINT =
	"Any amount here is a bonus ON TOP of the ticket price — leave it empty for none.";
export const ROLE_INSTRUCTIONS_PLACEHOLDER = "Anything specific this role should know…";

/** The accessible name of a role's bonus field — it must carry the semantics the visible hint does. */
export function roleBonusLabel(name: string): string {
	return `Bonus on top of the ticket price for ${name.trim() || "this role"}`;
}

/** The accessible name of a role's instructions field. */
export function roleInstructionsLabel(name: string): string {
	return `Additional instructions for ${name.trim() || "this role"}`;
}

export const DEPENDENCY_OPTIONS: Option[] = [
	{ value: "sequential", label: "After the previous one" },
	{ value: "parallel", label: "Alongside the project" },
];

export const CAPACITY_OPTIONS: Option[] = [
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
export const CURRENCY_OPTIONS: Option[] = DISPLAY_CURRENCIES.map((c) => ({
	value: c.code,
	label: `${c.code} — ${c.label}`,
}));

export const FILE_KIND_OPTIONS: Option[] = FileKind.options.map((kind) => ({
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
export const LANGUAGE_OPTIONS: Option[] = [
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

export const LOCATION_OPTIONS: Option[] = [
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
 * A stored `YYYY-MM-DD` as the `Date` the picker binds — parsed in the reader's OWN timezone.
 *
 * `new Date("2026-09-05")` is not that: the ISO date-only form is defined as UTC midnight, so
 * anywhere west of Greenwich it lands on the 4th and the picker highlights the day before the one
 * that is stored. Constructing from the three parts makes the value local, which is what a delivery
 * date means to the person reading it.
 */
export function fromIsoDate(iso: string | null): Date | null {
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
export function toIsoDate(value: DateValue): string | null {
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
export function clampDelay(value: number | null): number {
	if (value === null || !Number.isFinite(value)) return 0;
	return Math.max(-STAGE_DELAY_MAX_DAYS, Math.min(STAGE_DELAY_MAX_DAYS, Math.round(value)));
}

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
export function toMajor(minor: number | null, currency: string): number | null {
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
export function minorUnit(currency: string): number {
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
export const MONEY_FIELD = {
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
export const COUNT_FIELD = {
	step: 1,
	maxFractionDigits: 0,
	enableIconScrub: true,
} as const;

// #endregion
