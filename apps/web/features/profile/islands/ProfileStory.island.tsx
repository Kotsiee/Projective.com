import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Textarea } from "@projective/ui/fields";
import { Button } from "@projective/ui/fields";
import "../styles/profile.css";
import { ProfileIcon } from "../components/profile-glyphs.tsx";

/**
 * ProfileStory — the profile's story/description with DIRECT inline editing for the owner (root
 * CLAUDE.md Part 3.3): no formal "Edit mode" needed — a single click on the text swaps it for an
 * auto-resizing multiline {@link Textarea}, with Save/Cancel. A non-owner sees plain read-only prose.
 * Persistence is optimistic/stubbed (kept in the signal) until the live profile-write path lands.
 */
export interface ProfileStoryProps {
	story: string;
	/** Whether the viewer owns this profile (unlocks inline editing). */
	canEdit: boolean;
}

export default function ProfileStory({ story, canEdit }: ProfileStoryProps): JSX.Element {
	const value = useSignal<string>(story);
	const draft = useSignal<string>(story);
	const editing = useSignal<boolean>(false);
	const root = useRef<HTMLDivElement>(null);

	// Focus the textarea the moment we enter edit mode (single-click → typing).
	useEffect(() => {
		if (!editing.value) return;
		const el = root.current?.querySelector("textarea");
		if (el) {
			el.focus();
			const len = el.value.length;
			el.setSelectionRange(len, len);
		}
	}, [editing.value]);

	if (!canEdit) {
		return <p class="pf-story__text">{value.value}</p>;
	}

	if (editing.value) {
		return (
			<div class="pf-story pf-story--editing" ref={root}>
				<Textarea
					value={draft}
					autoResize
					rows={4}
					maxRows={18}
					variant="filled"
					fluid
					aria-label="Your story"
				/>
				<div class="pf-story__actions">
					<Button
						size="sm"
						variant="filled"
						onClick={() => {
							value.value = draft.value.trim() || value.value;
							editing.value = false;
						}}
					>
						Save
					</Button>
					<Button
						size="sm"
						variant="text"
						onClick={() => {
							draft.value = value.value;
							editing.value = false;
						}}
					>
						Cancel
					</Button>
				</div>
			</div>
		);
	}

	return (
		<button
			type="button"
			class="pf-story__editable"
			aria-label="Edit your story"
			onClick={() => {
				draft.value = value.value;
				editing.value = true;
			}}
		>
			<p class="pf-story__text">{value.value}</p>
			<span class="pf-story__hint">
				<ProfileIcon name="edit" class="pf-story__hint-icon" />
				Click to edit
			</span>
		</button>
	);
}
