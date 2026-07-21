import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import "../styles/profile.css";
import { ProfileIcon } from "../components/profile-glyphs.tsx";

/**
 * TabCreateButton — the owner's direct "+ New …" action rendered in a tab panel's header (root
 * CLAUDE.md Part 3.3): an explicit icon button that opens a creation modal immediately, with NO formal
 * Edit mode required. STUB: the creation flow itself lands with the live write path; for now the modal
 * confirms the intent and points to the workspace. Uses the `@projective/ui` {@link Dialog} (portal +
 * focus trap + backdrop) with a `Signal` `visible` so it is properly controlled.
 */
export interface TabCreateButtonProps {
	/** Full action label, e.g. "New service". */
	label: string;
	/** The singular noun for the modal body, e.g. "service". */
	noun: string;
}

export default function TabCreateButton({ label, noun }: TabCreateButtonProps): JSX.Element {
	const open = useSignal<boolean>(false);
	return (
		<>
			<button
				type="button"
				class="pf-create"
				aria-label={label}
				onClick={() => (open.value = true)}
			>
				<ProfileIcon name="plus" class="pf-create__icon" />
				<span class="pf-create__label">{label}</span>
			</button>

			<Dialog
				visible={open}
				header={label}
				modal
				footer={
					<div class="pf-modal__actions">
						<Button variant="text" onClick={() => (open.value = false)}>Close</Button>
						<Button variant="filled" onClick={() => (open.value = false)}>Got it</Button>
					</div>
				}
			>
				<p class="pf-modal__body">
					Publishing a new {noun} straight from your profile is coming soon. For now, set it up
					in your workspace — it will appear here automatically once it's live.
				</p>
			</Dialog>
		</>
	);
}
