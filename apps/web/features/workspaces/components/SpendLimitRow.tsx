import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { InputNumber, ToggleSwitch } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { styleVars } from "@ui/core/style.ts";
import { currencyExponent } from "@projective/types/finance";
import type { SpendLimit } from "@projective/types/workspace";
import { PolicyAmount } from "./PolicyAmount.tsx";
import { DoneGlyph, EditGlyph } from "./policy-glyphs.tsx";

/**
 * SpendLimitRow — one member's spend envelope on a business's pooled wallet.
 *
 * Read mode is a record: who, how much of their allowance is gone, and what their ceiling is. The
 * envelope meter's fill is the server's own `usedFraction` — the client never divides spent by limit, and
 * never animates the fill, because that width encodes how much of somebody's budget is left and a frozen
 * animation clock must not be able to render it as "none of it".
 *
 * ### Tone: an exhausted allowance is not a failure
 * The meter warms as it fills and goes amber at the ceiling, and it never goes red. Spending your whole
 * allowance is using the tool exactly as intended; red would frame a member's own budget as a mistake.
 *
 * ### A member who may not spend keeps their row
 * `canSpend: false` dims the row rather than removing it. Absence would hide a decision somebody made
 * about this person, and the reader of a spend policy needs the whole roster to know what the policy is.
 *
 * ### Two ceilings, two different promises
 * The rolling ceiling is how much a member may spend over a period; the per-purchase ceiling is how large
 * a single purchase may be. A member can have plenty of allowance left and still be unable to make one
 * large purchase alone, so the two are surfaced separately and never summarised into one number.
 *
 * ### Grid arithmetic
 * `.wsp-spend__limit` defines five tracks (avatar · identity · meter · ceiling · action). The inline
 * editor is a sixth child that explicitly spans `1 / -1`, so it takes a second row instead of silently
 * pushing the action cell out of alignment.
 */

// #region Props
/** The patch a row emits. Minor units and integers only — the wire never carries a float. */
export interface SpendLimitPatch {
	memberId: string;
	canSpend: boolean;
	/** Rolling ceiling in minor units, or `null` for unlimited. */
	limitMinor: number | null;
	/** Per-transaction ceiling in minor units, or `null` for none. */
	perTransactionMinor: number | null;
}

export interface SpendLimitRowProps {
	/** The server projection, with `usedFraction` already computed. */
	limit: SpendLimit;
	/** Whether this row is the viewer's own envelope. */
	isSelf?: boolean;
	/** Whether the viewer may rewrite envelopes (`manage_finances`). */
	editable?: boolean;
	/** Whether this row's inline editor is open. The parent owns it, so only one row opens at a time. */
	editing?: boolean;
	/** Toggle this row's inline editor. */
	onToggleEditing?: (memberId: string) => void;
	/** A committed change to the envelope. */
	onChange?: (patch: SpendLimitPatch) => void;
}
// #endregion

// #region Helpers
/**
 * The meter's tonal step. `near` from four-fifths spent, `full` at the ceiling — the thresholds live here
 * rather than in CSS because the same boundaries also decide what the row says about itself.
 */
function meterTone(fraction: number): "normal" | "near" | "full" {
	if (fraction >= 1) return "full";
	if (fraction >= 0.8) return "near";
	return "normal";
}

/**
 * Convert major units typed into a currency field to the integer minor units the wire carries.
 *
 * This is a **unit conversion for entry**, not money arithmetic: no balance, total, split, fee or rate is
 * derived from it, the server re-validates the integer it receives, and every figure this row *displays*
 * outside a form field remains a server-computed `MoneyView`.
 */
function toMinor(major: number | null, currency: string): number | null {
	if (major === null || !Number.isFinite(major)) return null;
	return Math.max(0, Math.round(major * 10 ** currencyExponent(currency)));
}

/** The inverse, seeding a field from the stored ceiling. */
function toMajor(minor: number | null, currency: string): number | null {
	if (minor === null) return null;
	return minor / 10 ** currencyExponent(currency);
}
// #endregion

// #region Component
/**
 * One member's envelope: a readable record with one affordance, and an inline editor behind it.
 *
 * The editor's fields are seeded from the parent's draft on mount and thereafter own their own text
 * (`useControllable` treats a raw value as a one-shot seed), which is the right behaviour for something
 * being typed into. Every keystroke that commits emits a full patch, so the parent's draft stays the
 * single record of intent and closing the editor re-seeds from it.
 */
export function SpendLimitRow(props: SpendLimitRowProps): JSX.Element {
	const { limit, editable = false, editing = false, isSelf = false } = props;
	const currency = limit.spent.currency;
	const tone = meterTone(limit.usedFraction);
	const unlimited = limit.limitMinor === null;
	const capId = `wsp-cap-${limit.memberId}`;
	const perId = `wsp-per-${limit.memberId}`;

	const emit = (patch: Partial<SpendLimitPatch>): void => {
		props.onChange?.({
			memberId: limit.memberId,
			canSpend: limit.canSpend,
			limitMinor: limit.limitMinor,
			perTransactionMinor: limit.perTransactionMinor,
			...patch,
		});
	};

	return (
		<li class="wsp-spend__limit" data-can={limit.canSpend ? "true" : "false"}>
			<Avatar
				class="wsp-spend__limit-avatar"
				image={limit.avatar || undefined}
				label={limit.name}
				size="sm"
				shape="circle"
			/>

			<span class="wsp-spend__limit-ident">
				<span class="wsp-spend__limit-name">
					<a href={`/@${limit.handle}`}>{limit.name}</a>
					{isSelf && <span class="ui-visually-hidden">(you)</span>}
				</span>
				<span class="wsp-spend__limit-sub">
					{limit.canSpend ? `@${limit.handle}` : "Cannot spend from this wallet"}
				</span>
			</span>

			{limit.canSpend && !unlimited
				? (
					<span class="wsp-spend__meter" data-tone={tone === "normal" ? undefined : tone}>
						{
							/*
							 * The track is decorative: the text under it carries both figures, so a reader who cannot
							 * compare two bar widths loses nothing. `--wsp-fill` is the server's own fraction.
							 */
						}
						<span class="wsp-spend__meter-track" aria-hidden="true">
							<span
								class="wsp-spend__meter-fill"
								style={styleVars({ "--wsp-fill": limit.usedFraction })}
							/>
						</span>
						<span class="wsp-spend__meter-text">
							<PolicyAmount value={limit.spent} size="micro" muted />
							<span>of {limit.limit?.display ?? ""} used</span>
						</span>
					</span>
				)
				: (
					<span class="wsp-spend__unlimited">
						{limit.canSpend ? "Spends without a rolling ceiling" : "Spending is off"}
					</span>
				)}

			<span class="wsp-spend__limit-cap">
				{unlimited
					? <span class="wsp-chip" data-tone="muted">Unlimited</span>
					: <PolicyAmount value={limit.limit ?? limit.spent} size="body" />}
				{limit.perTransactionMinor !== null && (
					<Tooltip
						content="A single purchase above this member's per-purchase ceiling becomes a request for an approver."
						placement="top"
					>
						<span class="wsp-chip" data-tone="muted">Per purchase</span>
					</Tooltip>
				)}
			</span>

			{editable
				? (
					<Tooltip
						content={editing
							? `Close ${limit.name}'s envelope`
							: `Edit ${limit.name}'s spend envelope`}
						placement="top"
					>
						<button
							type="button"
							class="wsp-spend__limit-edit"
							aria-expanded={editing ? "true" : "false"}
							aria-label={editing
								? `Close ${limit.name}'s envelope`
								: `Edit ${limit.name}'s spend envelope`}
							onClick={() => props.onToggleEditing?.(limit.memberId)}
						>
							{editing ? DoneGlyph : EditGlyph}
						</button>
					</Tooltip>
				)
				: <span class="wsp-spend__limit-edit" aria-hidden="true" />}

			{editing && editable && (
				<div class="wsp-spend__limit-form">
					<div class="wsp-spend__limit-field">
						<ToggleSwitch
							value={limit.canSpend}
							label="May spend from the pooled wallet"
							onValueChange={(next) => emit({ canSpend: next })}
						/>
					</div>

					<div class="wsp-spend__limit-field">
						<label class="wsp-label" for={capId}>Rolling ceiling</label>
						<InputNumber
							id={capId}
							value={toMajor(limit.limitMinor, currency)}
							mode="currency"
							currency={currency}
							min={0}
							step={50}
							fluid
							disabled={!limit.canSpend}
							onValueChange={(next) => emit({ limitMinor: toMinor(next, currency) })}
						/>
					</div>

					<div class="wsp-spend__limit-field">
						<label class="wsp-label" for={perId}>Per purchase</label>
						<InputNumber
							id={perId}
							value={toMajor(limit.perTransactionMinor, currency)}
							mode="currency"
							currency={currency}
							min={0}
							step={50}
							fluid
							disabled={!limit.canSpend}
							onValueChange={(next) => emit({ perTransactionMinor: toMinor(next, currency) })}
						/>
					</div>

					<p class="wsp-spend__limit-formnote">
						Clearing a ceiling removes it. Anything over a ceiling still goes through — it becomes a
						request for an approver, never a refusal.
					</p>
				</div>
			)}
		</li>
	);
}
// #endregion
