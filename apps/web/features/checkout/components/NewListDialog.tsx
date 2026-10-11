import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button, InputText } from "@projective/ui/fields";

/**
 * NewListDialog — names a new list (a non-default `finance.baskets` row, Decision #70). Shared by the
 * basket lane and the header drawer's switcher; the caller owns the write and what opens afterwards.
 */

// #region Props
/** Props for {@link NewListDialog}. */
export interface NewListDialogProps {
	visible: Signal<boolean>;
	/** The typed name; cleared when the dialog closes. */
	name: Signal<string>;
	/** A create is in flight. */
	creating: boolean;
	onCreate: () => void;
}
// #endregion

export function NewListDialog(props: NewListDialogProps): JSX.Element {
	const { visible, name, creating, onCreate } = props;
	return (
		<Dialog
			visible={visible}
			header="New list"
			width="26rem"
			onVisibleChange={(open) => {
				if (!open) name.value = "";
			}}
			footer={
				<>
					<Button
						variant="text"
						severity="secondary"
						disabled={creating}
						onClick={() => (visible.value = false)}
					>
						Cancel
					</Button>
					<Button
						variant="filled"
						severity="primary"
						loading={creating}
						disabled={name.value.trim() === ""}
						onClick={onCreate}
					>
						Create list
					</Button>
				</>
			}
		>
			<p class="bsk-lane__dialognote">
				A list is a basket you have named. Anything parked in one stays there until you move it
				back, and nothing in it is charged for.
			</p>
			<label class="bsk-lane__dialoglabel" for="bsk-new-list">List name</label>
			<InputText
				id="bsk-new-list"
				fluid
				placeholder="3D assets"
				autoComplete="off"
				value={name}
				disabled={creating}
			/>
		</Dialog>
	);
}
