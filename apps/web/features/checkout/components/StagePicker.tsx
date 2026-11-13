import type { JSX } from "preact";
import { type Signal, useComputed } from "@preact/signals";
import "../styles/stage-picker.css";
import { Checkbox } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	PREPAY_TERMS,
	TICKET_FUNDING_BLOCK_SENTENCE,
	type TicketFundingQuote,
} from "@projective/types/finance";
import { Amount } from "./Amount.tsx";
import {
	selectAllStages,
	selectAllState,
	selectsLaterStage,
	stagePhaseNote,
	type StagePickerRow,
	stagePickerRows,
	toggleStage,
} from "../core/stage-picker.ts";

/**
 * StagePicker — which of a ticket's stages to pay for (Decision #430), the one stage list Buy now and
 * the Add to basket popover share. A stage the server marks `fundable` gets a checkbox; a finished,
 * held or prepaid stage is a static row whose phase is meta text. Prices are the server's `MoneyView`s;
 * the host owns the selection and every write it causes.
 */
export interface StagePickerProps {
	quote: TicketFundingQuote;
	/** The chosen stage ids. */
	selected: Signal<readonly string[]>;
	/** A new selection, already narrowed to fundable stages in the ticket's order. */
	onChange: (next: string[]) => void;
	/** Holds every checkbox while the host writes the last change. */
	disabled?: boolean;
	/** Unique per mounted picker, so two pickers never share element ids. */
	idPrefix: string;
	/** The id of the heading that names the list. */
	labelledBy: string;
}

export function StagePicker(props: StagePickerProps): JSX.Element {
	const { quote, selected, idPrefix } = props;
	const rows = stagePickerRows(quote);
	const fundable = rows.filter((r) => r.fundable).map((r) => r.stageId);
	const chosen = selected.value;
	const all = selectAllState(quote, chosen);

	return (
		<div class="stp">
			{quote.blocked
				? <p class="stp__blocked" role="status">{TICKET_FUNDING_BLOCK_SENTENCE[quote.blocked]}</p>
				: null}

			{fundable.length > 1
				? (
					<SelectAll
						key={fundable.join(",")}
						id={`${idPrefix}-all`}
						fundable={fundable}
						selected={selected}
						partial={all === "some"}
						disabled={props.disabled}
						onChange={(on) => props.onChange(selectAllStages(quote, on))}
					/>
				)
				: null}

			<ul class="stp__list" aria-labelledby={props.labelledBy}>
				{rows.map((row) => (
					<StageRow
						key={row.stageId}
						row={row}
						id={`${idPrefix}-${row.stageId}`}
						selected={selected}
						disabled={props.disabled}
						onToggle={(on) => props.onChange(toggleStage(quote, selected.peek(), row.stageId, on))}
					/>
				))}
			</ul>

			{selectsLaterStage(quote, chosen) ? <p class="stp__terms">{PREPAY_TERMS}</p> : null}
		</div>
	);
}

function SelectAll(props: {
	id: string;
	fundable: readonly string[];
	selected: Signal<readonly string[]>;
	partial: boolean;
	disabled?: boolean;
	onChange: (on: boolean) => void;
}): JSX.Element {
	const every = useComputed(() => props.fundable.every((id) => props.selected.value.includes(id)));
	return (
		<div class="stp__all">
			<Checkbox
				id={props.id}
				value={every}
				indeterminate={props.partial}
				disabled={props.disabled}
				label="Select all stages"
				onValueChange={(on) => props.onChange(props.partial ? true : on)}
			/>
		</div>
	);
}

function StageRow(props: {
	row: StagePickerRow;
	id: string;
	selected: Signal<readonly string[]>;
	disabled?: boolean;
	onToggle: (on: boolean) => void;
}): JSX.Element {
	const { row, id } = props;
	const checked = useComputed(() => props.selected.value.includes(row.stageId));
	const noteId = `${id}-note`;
	const marked = row.phase === "funded" || row.phase === "prepaid" || row.phase === "done";

	return (
		<li class="stp__row" data-phase={row.phase} data-fundable={row.fundable ? "true" : "false"}>
			<span class="stp__control">
				{row.fundable
					? (
						<Checkbox
							id={id}
							value={checked}
							disabled={props.disabled}
							aria-describedby={noteId}
							onValueChange={props.onToggle}
						/>
					)
					: marked
					? <Icon name="check" size="sm" class="stp__mark" />
					: null}
			</span>
			<span class="stp__body">
				{row.fundable
					? <label class="stp__name" for={id}>{row.name}</label>
					: <span class="stp__name">{row.name}</span>}
				<span class="stp__note" id={noteId}>{stagePhaseNote(row.phase, checked.value)}</span>
			</span>
			<span class="stp__price">
				{row.amount
					? <Amount value={row.amount} size="body" hideOrigin />
					: <span class="stp__unpriced">No price yet</span>}
			</span>
		</li>
	);
}
