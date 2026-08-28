import type { ComponentChildren, JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { displayCurrency, displayLocale, formatMoney } from "@projective/ui/display/money";
import type { SeatCapacity } from "../core/entity-archetype.ts";

/**
 * Entity View — the unboxed composition primitives.
 *
 * Every archetype body is assembled from these, and each one exists to make the correct thing the
 * easy thing. `DESIGN_SYSTEM.md` §B.9.7 bans a card around static content and §B.11 bans a pill
 * around metadata, but a rule only holds if there is a component that obeys it sitting where the
 * violation used to be — otherwise the next author reaches for `Card` and `Tag` because they are what
 * is available.
 *
 * All of these are SERVER components (no island, no state). Their sheet is `entity-view.css`, which
 * reaches the page through the lane island and `ViewStyleAnchor` (§C.1 — an app-local sheet imported
 * only by a server component never ships).
 */

// #region Section
/**
 * A page section: a §A.4 Section-header register label over its content, separated by ASYMMETRIC
 * spacing (`--space-7` above, `--space-3` below) and nothing else. No box, no border, no tint.
 *
 * The heading is optional. A section without one is still a section — it just relies on tier-1
 * spacing alone, which is §B.4's first choice and is frequently enough.
 */
export function Section(
	{ title, aside, id, children, class: cls }: {
		title?: string;
		/** A trailing element on the header row (a count, a link). Never a control cluster. */
		aside?: ComponentChildren;
		id?: string;
		children: ComponentChildren;
		class?: string;
	},
): JSX.Element {
	return (
		<section class={`evp-section${cls ? ` ${cls}` : ""}`} id={id}>
			{title && (
				<div class="evp-section__head">
					<h2 class="evp-section__title">{title}</h2>
					{aside && <div class="evp-section__aside">{aside}</div>}
				</div>
			)}
			{children}
		</section>
	);
}
// #endregion

// #region Inline metadata (§B.11.2)
/**
 * Non-actionable metadata as one muted line separated by middots.
 *
 * The separators are `aria-hidden` spans between sibling items rather than characters inside the
 * text, so a screen reader announces a list of facts and not a sentence full of punctuation. The
 * items are plain strings by signature — there is no `tone`, so a consumer cannot reintroduce a fill
 * without changing the component.
 */
export function MetaLine(
	{ items, class: cls }: { items: readonly string[]; class?: string },
): JSX.Element | null {
	if (!items.length) return null;
	return (
		<p class={`evp-meta${cls ? ` ${cls}` : ""}`}>
			{
				/*
			  Keyed by INDEX, not by value. `inlineMetaFor` dedupes, but a component must not depend on
			  its caller having done so — a category and a skill frequently share a word, and keying by
			  the string made Preact warn about duplicate keys and risk mis-reconciling the row.
			*/
			}
			{items.map((item, i) => (
				<span class="evp-meta__item" key={`${i}:${item}`}>
					{i > 0 && <span class="evp-meta__sep" aria-hidden="true">·</span>}
					<span class="evp-meta__text">{item}</span>
				</span>
			))}
		</p>
	);
}
// #endregion

// #region Scope checklist (§B.9.8)
/**
 * An unboxed checklist: a check glyph in the accent plus the item in Body register, one row per item.
 * No per-row surface, no per-row border, no per-row chip — the glyph is the only ink the row spends,
 * and it does the work a box would have done worse.
 */
export function ScopeChecklist(
	{ items, dense }: { items: readonly string[]; dense?: boolean },
): JSX.Element | null {
	if (!items.length) return null;
	return (
		<ul class={`evp-check${dense ? " evp-check--dense" : ""}`}>
			{items.map((item, i) => (
				<li class="evp-check__row" key={`${i}:${item}`}>
					<Icon name="check" size="sm" class="evp-check__mark" aria-hidden />
					<span class="evp-check__text">{item}</span>
				</li>
			))}
		</ul>
	);
}
// #endregion

// #region Specification ledger
/** One key–value row in a specification ledger. */
export interface LedgerRow {
	label: string;
	value: ComponentChildren;
	/** Renders the value in the accent — for the one row that is the headline fact. */
	emphasis?: boolean;
}

/**
 * A key–value ledger as a real `<dl>` with single hairlines between rows.
 *
 * A `<table>` was the obvious reach and is wrong twice: these are name/value pairs rather than a grid
 * of comparable records, and a table brings a bordered frame that §B.4 spends on nothing. One
 * hairline per boundary, no outer contour, no cell borders — the §B.9.3 budget spent exactly once.
 */
export function SpecLedger(
	{ rows, columns, class: cls }: {
		rows: readonly LedgerRow[];
		/** Two columns on wide containers, collapsing to one. Default single. */
		columns?: boolean;
		class?: string;
	},
): JSX.Element | null {
	if (!rows.length) return null;
	return (
		<dl class={`evp-ledger${columns ? " evp-ledger--cols" : ""}${cls ? ` ${cls}` : ""}`}>
			{rows.map((row) => (
				<div class="evp-ledger__row" key={row.label}>
					<dt class="evp-ledger__label">{row.label}</dt>
					<dd class={`evp-ledger__value${row.emphasis ? " evp-ledger__value--key" : ""}`}>
						{row.value}
					</dd>
				</div>
			))}
		</dl>
	);
}
// #endregion

// #region Permission ledger
/**
 * A licence's permissions as explicit allowed/denied rows.
 *
 * Both states carry a glyph AND the word, because colour alone is not a channel a colour-blind reader
 * receives and this is the term of a sale. The denied rows are shown rather than omitted: an absent
 * permission reads as an oversight, a denied one reads as a term.
 */
export function PermissionLedger(
	{ permissions }: { permissions: readonly { label: string; allowed: boolean }[] },
): JSX.Element | null {
	if (!permissions.length) return null;
	return (
		<ul class="evp-perms">
			{permissions.map((p) => (
				<li class="evp-perms__row" key={p.label} data-allowed={p.allowed ? "yes" : "no"}>
					<Icon
						name={p.allowed ? "check" : "close"}
						size="sm"
						class="evp-perms__mark"
						aria-hidden
					/>
					<span class="evp-perms__text">{p.label}</span>
					<span class="evp-perms__state">{p.allowed ? "Included" : "Not permitted"}</span>
				</li>
			))}
		</ul>
	);
}
// #endregion

// #region Seat meter (§D.8.4)
/**
 * A segmented seat-capacity meter.
 *
 * Three rules are load-bearing and each has cost something to learn:
 *
 * 1. **The geometry is set directly and never animated.** A background tab freezes the animation
 *    clock, and a meter whose widths arrive by transition then draws an empty cohort as full — a
 *    frame in which the interface states something false about availability (§8 Decision #60).
 * 2. **The track is `aria-hidden` and the SENTENCE is the fact.** A bar cannot be read aloud, and a
 *    nearly-full cohort is exactly when the number matters.
 * 3. **Segments, not a proportional fill.** At small counts a percentage bar is unreadable — "4 of
 *    10" as 60% of a rail communicates less than six discrete marks — and the seam between segments
 *    is `--space-px`, the sub-ramp step that exists precisely for a graphical seam (§A.3).
 */
export function SeatMeter({ capacity }: { capacity: SeatCapacity }): JSX.Element {
	// Cap the drawn segments so a large cohort degrades to a proportional rail rather than to 400
	// slivers. Beyond the cap the sentence is doing all the work anyway.
	const segments = capacity.total <= 24 ? capacity.total : 24;
	const takenSegments = capacity.total <= 24
		? capacity.taken
		: Math.round((capacity.taken / capacity.total) * 24);

	return (
		<div class="evp-seats">
			<div class="evp-seats__track" aria-hidden="true">
				{Array.from({ length: segments }, (_, i) => (
					<span
						class="evp-seats__seg"
						key={i}
						data-state={i < takenSegments ? "taken" : "open"}
					/>
				))}
			</div>
			<p class="evp-seats__fact">{capacity.sentence}</p>
		</div>
	);
}
// #endregion

// #region Trust signals (§B.11.4)
/** One earned trust signal — an inline text item with an explanation available on demand. */
export interface TrustSignal {
	label: string;
	/** What earned it. Surfaced as the `title`; the lane island upgrades this to a portal `Tooltip`. */
	explanation: string;
}

/**
 * Derived trust signals as inline text, never badges.
 *
 * A fill here would make six earned signals compete with the one lifecycle status that genuinely
 * needs the colour channel (§B.11.4). They read as subtle accented text with an underline on hover,
 * which is the affordance for "there is more to this" without claiming to be a control.
 */
export function TrustSignals({ signals }: { signals: readonly TrustSignal[] }): JSX.Element | null {
	if (!signals.length) return null;
	return (
		<p class="evp-signals">
			{signals.map((s, i) => (
				<span class="evp-signals__item" key={`${i}:${s.label}`}>
					{i > 0 && <span class="evp-signals__sep" aria-hidden="true">·</span>}
					<span class="evp-signals__text" title={s.explanation}>{s.label}</span>
				</span>
			))}
		</p>
	);
}
// #endregion

// #region Status (§B.11.3 — the ONE thing that keeps its fill)
/**
 * A lifecycle status.
 *
 * This is the single element on the surface permitted a fill, because the fill IS the semantic
 * channel (§A.1 role colours) and the state can change. It is deliberately a separate component from
 * {@link MetaLine} so the distinction stays visible in the source: a status is a state that can
 * change, a category is what a thing permanently is.
 *
 * The ink mixes the role colour toward `--on-surface` rather than using it raw, because four of the
 * theme's seven `--on-<role>` pairs measure ~3.17:1 in LIGHT mode. The mix is self-correcting in both
 * themes: `--on-surface` is near-white in dark and near-black in light, so it always moves the ink
 * away from the fill.
 */
export function StatusMark(
	{ label, tone = "info" }: {
		label: string;
		tone?: "success" | "warning" | "danger" | "info" | "neutral";
	},
): JSX.Element {
	return <span class="evp-status" data-tone={tone}>{label}</span>;
}
// #endregion

// #region Price origin
/**
 * The creator's original currency, shown BENEATH a converted headline figure.
 *
 * **It renders nothing when the viewer is already reading in that currency.** That guard is the whole
 * component: without it the line printed unconditionally, so a viewer whose display currency matched
 * the listing saw the same amount twice — the second time prefixed "Orig.", which reads as a
 * conversion that did not happen and invites the question of why two identical numbers disagree about
 * being the same. `MoneyView` has exactly this guard internally and it was bypassed by hand-rolling
 * the line.
 *
 * It is a client component because the answer depends on the VIEWER's display currency, which is a
 * signal the currency store owns; during SSR the store holds the request's resolved currency, so the
 * first byte is already correct and hydration does not flip it.
 */
export function PriceOrigin(
	{ minor, currency }: { minor: number; currency: string },
): JSX.Element | null {
	const viewing = displayCurrency.value?.toUpperCase();
	const origin = currency.toUpperCase();
	if (!viewing || viewing === origin) return null;
	return (
		<span class="evp-price__origin">
			Orig. {formatMoney(minor, origin, displayLocale.value || "en-GB")} {origin}
		</span>
	);
}
// #endregion
