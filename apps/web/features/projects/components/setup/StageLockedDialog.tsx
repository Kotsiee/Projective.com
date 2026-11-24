import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { useIsMobile } from "@projective/ui/hooks";
import { STAGE_REMOVAL_LOCKED_MESSAGE } from "../../types/projects-types.ts";

/**
 * StageLockedDialog — why Remove did not delete a stage with work or money on it (PROJECTS ST2,
 * Decision #553): the database's own refusal sentence, and nothing moved. A bottom sheet on a phone.
 *
 * **Owned by PM-WP4b:** once a touched stage can be archived, Remove archives it and this dialog
 * becomes that archive's confirmation.
 */
export interface StageLockedDialogProps {
	visible: Signal<boolean>;
	/** The stage's name, or its item label ("stage", "milestone", "session") when it has none. */
	name: string;
}

export function StageLockedDialog(props: StageLockedDialogProps): JSX.Element {
	const mobile = useIsMobile();
	return (
		<Dialog
			visible={props.visible}
			position={mobile ? "bottom" : "center"}
			header={`${props.name} can't be removed yet`}
			width="min(30rem, calc(100vw - 2rem))"
			footer={<Button label="Got it" onClick={() => (props.visible.value = false)} />}
		>
			<p>{STAGE_REMOVAL_LOCKED_MESSAGE}</p>
		</Dialog>
	);
}
