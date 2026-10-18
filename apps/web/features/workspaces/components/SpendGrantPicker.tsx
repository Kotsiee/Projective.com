import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { FormControl, Listbox } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { MetaLine } from "@projective/ui/display";
import type { GrantView } from "../core/spend-model.ts";

/**
 * SpendGrantPicker — one of the Spend module's two grant pickers ("Who can approve", "Who can add
 * money"): a multi-select Listbox over the members the SERVER said the viewer may change
 * (`editableMemberIds` — never the owner, never themselves, only somebody they outrank), with the
 * holders out of their reach named under it. A reader who may not edit the policy reads the holders as
 * a MetaLine instead; nothing is drawn that does nothing (§3.11).
 *
 * Its container carries `id`, the in-page address the "Choose approvers" link lands on; the link moves
 * focus into the listbox itself.
 *
 * One name per list: the visible label is the picker's heading (as in the read-only form), and the
 * Listbox's own name repeats it verbatim in `aria-label` — a `<label for>` cannot name a `role="listbox"`
 * list and `BaseFieldProps` carries no `aria-labelledby`, so FormControl is used for its hint alone.
 */

// #region Props
/** Props for {@link SpendGrantPicker}. */
export interface SpendGrantPickerProps {
	/** The container's id — the picker's in-page address. */
	id: string;
	/** The picker's label ("Who can approve"). */
	label: string;
	/** Whether the viewer may edit the policy (`viewerCan.editPolicy`). */
	editable: boolean;
	/** The rows, the fixed holders and the picks (`grantView`). */
	view: GrantView;
	/** Under the list: who else holds it (`fixedHint`). */
	hint: string;
	/** A refused save that names this grant — drawn as the list's own error, in place of the hint. */
	error?: string;
	/** The picks, bound so a re-read reaches the list. */
	value: Signal<string | string[]>;
	/** Every holder by name, for a reader who may not edit (`holderNames`). */
	holders: readonly string[];
	/** The picks changed. */
	onPick: (picked: string[]) => void;
}
// #endregion

// #region Component
/** One grant picker — editable list, or the holders for a reader. */
export function SpendGrantPicker(props: SpendGrantPickerProps): JSX.Element {
	if (!props.editable) {
		return (
			<div class="wsp-spend__picker" id={props.id}>
				<h3 class="wsp-spend__picker-label">{props.label}</h3>
				<MetaLine items={props.holders.length > 0 ? props.holders : ["Nobody yet"]} />
			</div>
		);
	}
	if (props.view.options.length === 0) {
		return (
			<div class="wsp-spend__picker" id={props.id}>
				<h3 class="wsp-spend__picker-label">{props.label}</h3>
				<MetaLine items={[props.hint || "Only the owner", "There is nobody here you can change"]} />
				{props.error && <InlineNotice align="start" assertive text={props.error} />}
			</div>
		);
	}
	return (
		<div class="wsp-spend__picker" id={props.id}>
			<h3 class="wsp-spend__picker-label">{props.label}</h3>
			<FormControl
				hint={props.hint || undefined}
				error={props.error}
				status={props.error ? "invalid" : "default"}
				collapseHint={!props.hint}
			>
				{({ id, describedBy, status }) => (
					<Listbox
						id={id}
						options={props.view.options}
						value={props.value}
						multiple
						checkbox
						filter={props.view.options.length > 6}
						filterPlaceholder="Find a member"
						fluid
						status={status}
						aria-label={props.label}
						aria-describedby={describedBy}
						onValueChange={(next) => props.onPick(Array.isArray(next) ? next : [next])}
					/>
				)}
			</FormControl>
		</div>
	);
}
// #endregion
