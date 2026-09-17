import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, InputText, Textarea } from "@projective/ui/fields";
import "../styles/profile.css";
import { ProfileIcon } from "../components/profile-glyphs.tsx";

/**
 * ProfileStory — the profile's editorial statement: the one-line HEADLINE over the STORY, each with
 * DIRECT inline editing for the owner. A single click on either swaps it for its field — a
 * single-line {@link InputText} for the headline, an auto-resizing {@link Textarea} for the story —
 * with Save / Cancel beneath, no edit mode to enter first. A visitor sees plain read-only prose in
 * the display and body registers; an owner with nothing written yet sees a quiet placeholder in the
 * same slot, so the way to write it is where it will appear.
 *
 * The two slots are one component ({@link EditableText}) so the headline and the story cannot
 * drift into two editing idioms sixteen pixels apart. The headline commits on Enter (a line has no
 * newline to keep); both cancel on Escape. A visitor's empty headline renders NOTHING — never a
 * platform default, because a sentence the platform wrote reads as one the person wrote.
 *
 * Persistence is optimistic (kept in the signal) until the live profile-write path lands.
 */
export interface ProfileStoryProps {
	headline: string;
	story: string;
	/** Whether the viewer owns this profile (unlocks inline editing). */
	canEdit: boolean;
}

const HEADLINE_PLACEHOLDER = "Add a headline — what you do, in one line.";
const STORY_PLACEHOLDER = "Tell people what you do, who you work with, and how you work.";
const HEADLINE_MAX = 120;

export default function ProfileStory({ headline, story, canEdit }: ProfileStoryProps): JSX.Element {
	return (
		<div class="pf-statement">
			<EditableText
				kind="headline"
				initial={headline}
				canEdit={canEdit}
				placeholder={HEADLINE_PLACEHOLDER}
				writeLabel="Write your headline"
				editLabel="Edit your headline"
			/>
			<EditableText
				kind="story"
				initial={story}
				canEdit={canEdit}
				placeholder={STORY_PLACEHOLDER}
				writeLabel="Write your story"
				editLabel="Edit your story"
			/>
		</div>
	);
}

// #region EditableText
interface EditableTextProps {
	kind: "headline" | "story";
	initial: string;
	canEdit: boolean;
	placeholder: string;
	writeLabel: string;
	editLabel: string;
}

function EditableText(
	{ kind, initial, canEdit, placeholder, writeLabel, editLabel }: EditableTextProps,
): JSX.Element | null {
	const value = useSignal<string>(initial);
	const draft = useSignal<string>(initial);
	const editing = useSignal<boolean>(false);
	const root = useRef<HTMLDivElement>(null);
	const isHeadline = kind === "headline";
	const blockClass = isHeadline ? "pf-headline" : "pf-story";

	useEffect(() => {
		if (!editing.value) return;
		const el = root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
			isHeadline ? "input" : "textarea",
		);
		if (el) {
			el.focus();
			const len = el.value.length;
			el.setSelectionRange(len, len);
		}
	}, [editing.value]);

	const empty = value.value.trim().length === 0;

	function save(): void {
		const next = draft.value.trim();
		// A cleared headline is a real choice — a person may prefer none. A cleared story keeps the
		// last one, matching the story's long-standing behaviour.
		value.value = isHeadline ? next : next || value.value;
		editing.value = false;
	}

	function cancel(): void {
		draft.value = value.value;
		editing.value = false;
	}

	if (!canEdit) {
		if (empty) return null;
		return isHeadline ? <p class="pf-context__headline">{value.value}</p> : (
			<div class="pf-story">
				<p class="pf-story__text">{value.value}</p>
			</div>
		);
	}

	// The keys are read on the wrapper, where both fields' presses bubble to: Escape cancels either
	// edit, and Enter commits the headline — a line has no newline to keep — while the story keeps
	// Enter for its paragraphs.
	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === "Escape") {
			e.preventDefault();
			cancel();
		} else if (isHeadline && e.key === "Enter") {
			e.preventDefault();
			save();
		}
	}

	if (editing.value) {
		return (
			<div
				class={`${blockClass} ${blockClass}--editing pf-inline--editing`}
				ref={root}
				onKeyDown={onKeyDown}
			>
				{isHeadline
					? (
						<InputText
							value={draft}
							variant="filled"
							fluid
							maxLength={HEADLINE_MAX}
							placeholder={placeholder}
							aria-label="Your headline"
							class="pf-headline__field"
						/>
					)
					: (
						<Textarea
							value={draft}
							autoResize
							rows={4}
							maxRows={18}
							variant="filled"
							fluid
							placeholder={placeholder}
							aria-label="Your story"
						/>
					)}
				<div class="pf-story__actions">
					<Button size="sm" variant="filled" class="pf-story__save" onClick={save}>
						Save
					</Button>
					<Button size="sm" variant="text" class="pf-story__cancel" onClick={cancel}>
						Cancel
					</Button>
				</div>
			</div>
		);
	}

	const textClass = isHeadline ? "pf-context__headline" : "pf-story__text";
	return (
		<div class={blockClass}>
			<button
				type="button"
				class="pf-story__editable"
				aria-label={empty ? writeLabel : editLabel}
				onClick={() => {
					draft.value = value.value;
					editing.value = true;
				}}
			>
				<p class={`${textClass}${empty ? ` ${textClass}--placeholder` : ""}`}>
					{empty ? placeholder : value.value}
				</p>
				<span class="pf-story__hint">
					<ProfileIcon name="edit" class="pf-story__hint-icon" />
					{empty ? "Click to write" : "Click to edit"}
				</span>
			</button>
		</div>
	);
}
// #endregion
