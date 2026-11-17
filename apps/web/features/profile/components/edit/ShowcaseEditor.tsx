import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { moveSlots } from "@projective/ui/display";
import { ConfirmDialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import type { ShowcaseSlot } from "@projective/types/profile";
import { ShowcaseSlots } from "@web/features/files/components/showcase/ShowcaseSlots.tsx";
import type { MediaCropChoice } from "@web/features/files/core/media/media-pick.ts";
import { type ProfileMediaState, ProfileService } from "../../core/ProfileService.ts";
import { applyProfileMedia } from "../../core/media-apply.ts";

/**
 * ShowcaseEditor — the six-slot showcase, managed in place in the hero's showcase column (Decision
 * #439): every slot opens the File Picker in media mode, slots reorder by drag or keyboard, and a
 * filled slot empties after a confirm. Each change is IMMEDIATE — applying a picture already cuts a
 * public rendition on the server — so there is no draft and no Save, only Done; the grid redraws from
 * what the server says is stored, and `onChanged` lets the hero re-read its showcase. Slot 1 is the
 * thumbnail every card of this profile leads with, so it only ever takes a still.
 */
export interface ShowcaseEditorProps {
	handle: string;
	initial: readonly ShowcaseSlot[];
	/** A write landed: the stored slots, for the page to redraw from. */
	onChanged: (slots: ShowcaseSlot[]) => void;
	onDone: () => void;
}

export function ShowcaseEditor(props: ShowcaseEditorProps): JSX.Element {
	const { handle } = props;
	const slots = useSignal<ShowcaseSlot[]>([...props.initial]);
	const notice = useSignal("");
	const removing = useSignal<number | null>(null);
	const confirmOpen = useSignal(false);
	const busy = useSignal(false);

	function adopt(state: ProfileMediaState): void {
		slots.value = state.showcase;
		props.onChanged(state.showcase);
	}

	async function apply(choices: MediaCropChoice[]): Promise<string | null> {
		const done: number[] = [];
		for (const choice of choices) {
			const res = await applyProfileMedia(
				{ handle, target: "showcase", position: choice.position },
				choice,
			);
			if (!res.ok) {
				if (done.length > 0) notice.value = `Showcase slots ${done.join(", ")} updated.`;
				return res.message;
			}
			adopt(res.state);
			if (choice.position) done.push(choice.position);
		}
		notice.value = done.length === 1
			? `Showcase slot ${done[0]} updated.`
			: `Showcase slots ${done.join(", ")} updated.`;
		return null;
	}

	async function store(
		next: readonly ShowcaseSlot[],
		success: string,
		failure: string,
	): Promise<void> {
		if (busy.peek()) return;
		busy.value = true;
		const res = await ProfileService.saveShowcase(handle, {
			slots: next.map((s) => ({ position: s.position, fileId: s.fileId, alt: s.alt })),
		});
		busy.value = false;
		if (!res.ok || !res.data) {
			notice.value = res.message ?? failure;
			return;
		}
		adopt(res.data);
		notice.value = success;
	}

	function remove(): void {
		const position = removing.peek();
		removing.value = null;
		if (position === null) return;
		void store(
			slots.peek().filter((s) => s.position !== position),
			`Showcase slot ${position} emptied.`,
			"That slot couldn't be emptied.",
		);
	}

	return (
		<div class="pf-showcase-edit" role="group" aria-label="Edit your showcase">
			<div class="pf-showcase-edit__head">
				<p class="pf-edit__hint">
					Up to six pictures or videos. The first is your thumbnail on cards and in search, so it's
					always a picture.
				</p>
				<Button class="pf-edit__save" onClick={props.onDone}>Done</Button>
			</div>
			<ShowcaseSlots
				requesterId="profile-showcase"
				slots={slots.value}
				coverLabel="1 · Thumbnail"
				coverName="thumbnail"
				disabled={busy.value}
				onSave={apply}
				onRemove={(position) => {
					removing.value = position;
					confirmOpen.value = true;
				}}
				onReorder={(from, to) =>
					void store(
						moveSlots(slots.peek(), from, to),
						`Showcase slot ${from} moved to slot ${to}.`,
						"That move couldn't be saved.",
					)}
			/>
			<p class="pf-inline__status" role="status" aria-live="polite">{notice.value}</p>
			<ConfirmDialog
				visible={confirmOpen}
				header="Empty this slot?"
				message="The picture leaves your profile. It stays in your library, so you can put it back."
				acceptLabel="Remove"
				rejectLabel="Keep"
				acceptSeverity="danger"
				onAccept={remove}
				onReject={() => (removing.value = null)}
			/>
		</div>
	);
}
