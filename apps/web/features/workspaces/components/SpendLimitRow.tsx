import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button, FormControl, MoneyInput, SelectButton, ToggleSwitch } from "@projective/ui/fields";
import { ProgressBar, Tooltip } from "@projective/ui/feedback";
import { MetaLine } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import type { SpendLimit, SpendPeriod } from "@projective/types/workspace";
import { type LimitDraft, PERIOD_OPTIONS, rowFace, type RowView } from "../core/spend-model.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * SpendLimitRow — one member's spend envelope on a business's pooled wallet (BU2, Decision #246).
 *
 * Read mode is a record: who, their envelope in one line ("US$500.00 / month · US$100.00 per purchase"
 * · "No ceiling" · "Spending off"), and — when there is a ceiling — a ProgressBar of how much of it is
 * gone, from the server's own `usedFraction`. The client never divides spent by the ceiling.
 *
 * ### A drafted row draws the draft's price, or says it is waiting
 * While the editor's draft for a row differs from what is saved, the row draws the server's preview
 * of THAT draft (`POST /api/workspace/spend/preview`) behind "Not saved yet", its meter in the muted
 * secondary ramp (`rowFace`) — or, until it arrives, says so instead of drawing a figure. It never
 * draws a stored figure with a field patched in: that is how an unlimited member given a ceiling once
 * showed what they had spent as the ceiling (BD2).
 *
 * ### Tone: an exhausted allowance is not a failure
 * The bar turns amber from four-fifths used, and it never goes red: spending your whole allowance is
 * the tool working.
 *
 * ### A member who may not spend keeps their row
 * `canSpend: false` reads "Spending off" rather than removing the row: absence would hide a decision
 * somebody made about this person.
 *
 * ### Grid arithmetic
 * `.wsp-spend__limit` defines four tracks (avatar · identity · meter · action). The inline editor is a
 * fifth child that spans `1 / -1`, so it takes a second row instead of pushing the action cell out.
 */

// #region Props
/** Props for {@link SpendLimitRow}. */
export interface SpendLimitRowProps {
	/** The saved envelope — the row's identity and face. */
	limit: SpendLimit;
	/** What the row draws (`rowView`): the saved envelope, the draft's price, or nothing yet. */
	view: RowView;
	/** The preview could not price this row's draft. */
	previewFailed?: boolean;
	/** The policy's currency — what a typed ceiling is denominated in. */
	currency: string;
	/** Whether this row is the viewer's own envelope. */
	isSelf?: boolean;
	/** Whether the viewer may change this row (the server's `editableMemberIds`). */
	editable?: boolean;
	/** Whether this row's inline editor is open. The parent owns it, so only one row opens at a time. */
	editing?: boolean;
	/** Toggle this row's inline editor. */
	onToggleEditing?: (memberId: string) => void;
	/** The row's draft, which the inline editor seeds from when it opens. */
	draft?: LimitDraft;
	/** The draft changed. */
	onDraft?: (memberId: string, next: LimitDraft) => void;
	/**
	 * Setting a ceiling would be refused by the Business Pro gate (`limitsPlanGated`): a field with no
	 * stored ceiling is disabled; one with a ceiling stays editable, so it can be cleared.
	 */
	plansGated?: boolean;
	/**
	 * The viewer holds `spend_funds`, so may switch spending on for somebody — a mirror of
	 * save_spend_policy's "never grant what you do not hold" (Decision #246 ruling (h)).
	 */
	canGrantSpend?: boolean;
}
// #endregion

// #region The inline editor
interface LimitFormProps {
	id: string;
	limit: SpendLimit;
	draft: LimitDraft;
	currency: string;
	plansGated: boolean;
	canGrantSpend: boolean;
	onDraft: (memberId: string, next: LimitDraft) => void;
}

/**
 * The four fields of an envelope, each in a FormControl. Seeded from the row's draft when it opens,
 * then owning its own signals (bound, never `value={x.value}`); every change hands the whole draft row
 * back to the parent, which prices it.
 */
function LimitForm(props: LimitFormProps): JSX.Element {
	const { limit, draft } = props;
	const canSpend = useSignal(draft.canSpend);
	const cap = useSignal<number | null>(draft.limitMinor);
	const perPurchase = useSignal<number | null>(draft.perTransactionMinor);
	const period = useSignal<string | string[]>(draft.period);

	const emit = (): void => {
		const picked = period.peek();
		props.onDraft(limit.memberId, {
			canSpend: canSpend.peek(),
			limitMinor: cap.peek(),
			perTransactionMinor: perPurchase.peek(),
			period: (typeof picked === "string" ? picked : draft.period) as SpendPeriod,
		});
	};

	const off = !canSpend.value;
	// Mirrors of save_spend_policy's Business Pro rule (Decision #246 ruling (h), pinned to the SQL by
	// workspace.contract.test.ts): typing a ceiling where none is stored SETS one, and so does moving
	// the window of a row that keeps one; clearing never is. The save still refuses on its own.
	const capLocked = props.plansGated && limit.limitMinor === null;
	const perLocked = props.plansGated && limit.perTransactionMinor === null;
	const periodLocked = props.plansGated && cap.value !== null;
	const periodLabelId = `${props.id}-period`;
	const PRO = "Setting one is part of Business Pro.";

	return (
		<div class="wsp-spend__limit-form" id={props.id}>
			<FormControl collapseHint>
				{({ id, describedBy }) => (
					<ToggleSwitch
						id={id}
						value={canSpend}
						label="Can spend from the wallet"
						aria-describedby={describedBy}
						disabled={!props.canGrantSpend && !limit.canSpend}
						onValueChange={emit}
					/>
				)}
			</FormControl>

			<FormControl label="Spending limit" hint={capLocked ? PRO : "Empty means no ceiling."}>
				{({ id, describedBy }) => (
					<MoneyInput
						id={id}
						value={cap}
						currency={props.currency}
						min={0}
						fluid
						disabled={off || capLocked}
						aria-describedby={describedBy}
						onValueChange={emit}
					/>
				)}
			</FormControl>

			<FormControl label="Per purchase" hint={perLocked ? PRO : "Empty means any size."}>
				{({ id, describedBy }) => (
					<MoneyInput
						id={id}
						value={perPurchase}
						currency={props.currency}
						min={0}
						fluid
						disabled={off || perLocked}
						aria-describedby={describedBy}
						onValueChange={emit}
					/>
				)}
			</FormControl>

			{
				/*
				 * One name, from the visible text: a `<label for>` cannot name the SelectButton's radiogroup
				 * (not a labelable element) and `BaseFieldProps` carries no `aria-labelledby`, so the group
				 * around it is labelled by the text instead — never that text AND a repeated `aria-label`.
				 * The text is the feature's own element, set in the field-label tokens, not packages/ui's
				 * private `ui-field-label` class.
				 */
			}
			<div class="wsp-spend__limit-field" role="group" aria-labelledby={periodLabelId}>
				<span class="wsp-spend__limit-label" id={periodLabelId}>Period</span>
				<FormControl
					hint={periodLocked ? "Moving a ceiling's window is part of Business Pro." : undefined}
					collapseHint={!periodLocked}
				>
					{({ id, describedBy }) => (
						<SelectButton
							id={id}
							options={PERIOD_OPTIONS.map((o) => ({ ...o }))}
							value={period}
							disabled={off || periodLocked}
							aria-describedby={describedBy}
							onValueChange={emit}
						/>
					)}
				</FormControl>
			</div>

			<p class="wsp-spend__limit-formnote">
				Anything over a limit still goes through as a request for an approver, never a refusal.
				Changing the period keeps what was spent in the current one.
			</p>
		</div>
	);
}
// #endregion

// #region Component
/**
 * One member's envelope: a readable record with one affordance (tier 5 — a row action), and the
 * inline editor behind it.
 */
export function SpendLimitRow(props: SpendLimitRowProps): JSX.Element {
	const { limit, view, editable = false, editing = false, isSelf = false } = props;
	const shown = view.shown;
	const { facts, meter } = rowFace(view, props.previewFailed === true);
	const formId = `wsp-limit-form-${limit.memberId}`;
	const action = editing ? `Close ${limit.name}'s limit` : `Edit ${limit.name}'s limit`;

	return (
		<li
			class="wsp-spend__limit"
			data-can={(shown ?? limit).canSpend ? "true" : "false"}
			data-draft={view.draft ? "true" : undefined}
		>
			<UserAvatar
				class="wsp-spend__limit-avatar"
				image={limit.avatar || undefined}
				label={limit.name}
				size="sm"
				shape="circle"
			/>

			<span class="wsp-spend__limit-ident">
				<span class="wsp-spend__limit-name">
					<a class="wsp-spend__limit-link" href={`/@${limit.handle}`}>{limit.name}</a>
					{isSelf && <span class="ui-visually-hidden">(you)</span>}
				</span>
				<MetaLine as="span" size="xs" class="wsp-spend__limit-sub" items={facts} />
			</span>

			<div class="wsp-spend__limit-meter">
				{meter && (
					<>
						<ProgressBar
							value={meter.percent}
							severity={meter.severity}
							aria-label={view.draft
								? `Share of ${limit.name}'s limit used, not saved yet`
								: `Share of ${limit.name}'s limit used`}
						/>
						<MetaLine as="span" size="xs" items={meter.caption} />
					</>
				)}
			</div>

			{editable
				? (
					<Tooltip content={action} placement="top">
						<Button
							class="wsp-spend__limit-edit"
							severity="secondary"
							variant="text"
							iconOnly
							icon={<Icon name={editing ? "check" : "edit"} />}
							aria-label={action}
							aria-expanded={editing}
							aria-controls={editing ? formId : undefined}
							onClick={() => props.onToggleEditing?.(limit.memberId)}
						/>
					</Tooltip>
				)
				: <span class="wsp-spend__limit-edit" aria-hidden="true" />}

			{editing && editable && props.draft && props.onDraft && (
				<LimitForm
					id={formId}
					limit={limit}
					draft={props.draft}
					currency={props.currency}
					plansGated={props.plansGated === true}
					canGrantSpend={props.canGrantSpend === true}
					onDraft={props.onDraft}
				/>
			)}
		</li>
	);
}
// #endregion
