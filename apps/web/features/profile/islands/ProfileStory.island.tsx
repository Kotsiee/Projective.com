import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, Textarea } from "@projective/ui/fields";
import "../styles/profile.css";
import { ProfileIcon } from "../components/profile-glyphs.tsx";

/**
 * ProfileStory — the profile's story with DIRECT inline editing for the owner: a single click on the
 * prose swaps it for an auto-resizing multiline {@link Textarea} with Save / Cancel, no edit mode to
 * enter first. A visitor sees plain read-only prose in the body register. An owner with no story yet
 * sees a quiet placeholder in the same slot, so the way to write one is where the story will be.
 * Persistence is optimistic (kept in the signal) until the live profile-write path lands.
 */
export interface ProfileStoryProps {
	story: string;
	/** Whether the viewer owns this profile (unlocks inline editing). */
	canEdit: boolean;
}

const PLACEHOLDER = "Tell people what you do, who you work with, and how you work.";

export default function ProfileStory({ story, canEdit }: ProfileStoryProps): JSX.Element {
	const value = useSignal<string>(story);
	const draft = useSignal<string>(story);
	const editing = useSignal<boolean>(false);
	const root = useRef<HTMLDivElement>(null);

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
		return (
			<div class="pf-story">
				<p class="pf-story__text">{value.value}</p>
			</div>
		);
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
					placeholder={PLACEHOLDER}
					aria-label="Your story"
				/>
				<div class="pf-story__actions">
					<Button
						size="sm"
						variant="filled"
						class="pf-story__save"
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
						class="pf-story__cancel"
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

	const empty = value.value.trim().length === 0;

	return (
		<div class="pf-story">
			<button
				type="button"
				class="pf-story__editable"
				aria-label={empty ? "Write your story" : "Edit your story"}
				onClick={() => {
					draft.value = value.value;
					editing.value = true;
				}}
			>
				<p class={`pf-story__text${empty ? " pf-story__text--placeholder" : ""}`}>
					{empty ? PLACEHOLDER : value.value}
				</p>
				<span class="pf-story__hint">
					<ProfileIcon name="edit" class="pf-story__hint-icon" />
					{empty ? "Click to write" : "Click to edit"}
				</span>
			</button>
		</div>
	);
}
