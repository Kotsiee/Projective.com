import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar, ProgressiveImage } from "@projective/ui/display";
import { ConfirmDialog, Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { SHOWCASE_SLOTS, type ShowcaseSlot } from "@projective/types/profile";
import { MediaCropModal } from "../media/MediaCropModal.tsx";
import { type ProfileMediaState, ProfileService } from "../../core/ProfileService.ts";
import { broadcastAvatar } from "@web/utils/avatar-sync.ts";

/**
 * MediaSection — the profile photo and the six-slot showcase grid, as the owner edits them.
 *
 * Media writes are IMMEDIATE, not part of the page's Save: applying a picture cuts a public rendition
 * on the server, so there is nothing to hold in a draft — the grid redraws from what the server says
 * is now stored. Every slot opens the same {@link MediaCropModal}: an empty slot is a dashed button
 * (a control, so it may be outlined — §B.4), a filled one shows its picture with Replace and Remove on
 * hover or focus (and always on a touch surface, which has no hover). Slot 1 is marked as the
 * primary: it is the thumbnail every card, search result and listing of this profile leads with, so
 * it only ever takes a still.
 *
 * A new profile photo is BROADCAST (`@web/utils/avatar-sync.ts`) so the account button and every other
 * picture of this person already on the page update without a reload.
 */
export interface MediaSectionProps {
	handle: string;
	name: string;
	/** Whether this profile is a person — only a person's photo is also their account avatar. */
	individual: boolean;
	userId: string;
	initial: ProfileMediaState;
	/** Say something in the editor's live region. */
	onNotice: (text: string) => void;
}

export function MediaSection(props: MediaSectionProps): JSX.Element {
	const { handle, name, onNotice } = props;
	const media = useSignal<ProfileMediaState>(props.initial);
	const modalOpen = useSignal(false);
	const modalTarget = useSignal<{ target: "avatar" | "showcase"; position?: number; alt?: string }>({
		target: "avatar",
	});
	const removing = useSignal<number | null>(null);
	const confirmOpen = useSignal(false);
	const busy = useSignal(false);

	const slots: Array<ShowcaseSlot | null> = Array.from({ length: SHOWCASE_SLOTS }, (_, i) =>
		media.value.showcase.find((s) => s.position === i + 1) ?? null
	);

	function open(target: "avatar" | "showcase", position?: number): void {
		const current = position ? media.peek().showcase.find((s) => s.position === position) : undefined;
		modalTarget.value = { target, position, alt: current?.alt };
		modalOpen.value = true;
	}

	function applied(state: ProfileMediaState): void {
		const target = modalTarget.peek();
		media.value = state;
		if (target.target === "avatar") {
			onNotice("Profile photo updated.");
			if (props.individual && state.avatar) broadcastAvatar(props.userId, state.avatar.url);
		} else {
			onNotice(`Showcase slot ${target.position ?? 1} updated.`);
		}
	}

	function askRemove(position: number): void {
		removing.value = position;
		confirmOpen.value = true;
	}

	async function remove(): Promise<void> {
		const position = removing.peek();
		if (position === null || busy.peek()) return;
		busy.value = true;
		const res = await ProfileService.saveShowcase(handle, {
			slots: media.peek().showcase
				.filter((s) => s.position !== position)
				.map((s) => ({ position: s.position, fileId: s.fileId, alt: s.alt })),
		});
		busy.value = false;
		removing.value = null;
		if (!res.ok || !res.data) {
			onNotice(res.message ?? "That slot couldn't be emptied.");
			return;
		}
		media.value = res.data;
		onNotice(`Showcase slot ${position} emptied.`);
	}

	const avatar = media.value.avatar;
	const target = modalTarget.value;

	return (
		<div class="pf-edit__media">
			<div class="pf-edit__avatar">
				<Avatar
					image={avatar?.url ?? ""}
					placeholder={avatar?.placeholder}
					label={name}
					size={96}
					shape="circle"
				/>
				<div class="pf-edit__avatartext">
					<p class="pf-edit__fieldname">Profile photo</p>
					<p class="pf-edit__hint">Shown in a circle everywhere your name appears.</p>
					<Button
						size="sm"
						variant="outlined"
						class="pf-edit__btn"
						icon={<Icon name="image" size="sm" />}
						onClick={() => open("avatar")}
					>
						{avatar ? "Change photo" : "Add photo"}
					</Button>
				</div>
			</div>

			<div class="pf-edit__showcase">
				<p class="pf-edit__fieldname">Showcase</p>
				<p class="pf-edit__hint">
					Up to six pictures or videos at the top of your profile. The first is your thumbnail on
					cards and in search, so it's always a picture.
				</p>
				<ol class="pf-showgrid" role="list">
					{slots.map((slot, i) => {
						const position = i + 1;
						const primary = position === 1;
						return (
							<li key={position} class="pf-showgrid__cell" data-primary={primary ? "true" : undefined}>
								{slot
									? (
										<div class="pf-showgrid__filled">
											<ProgressiveImage
												src={slot.thumb}
												alt={slot.alt || `Showcase ${position}`}
												placeholder={slot.placeholder ?? null}
												loading="lazy"
											/>
											{slot.kind === "video" && (
												<span class="pf-showgrid__mark" aria-hidden="true">
													<Icon name="play" size="xs" filled />
												</span>
											)}
											<span class="pf-showgrid__overlay">
												<Tooltip content="Replace" placement="top">
													<button
														type="button"
														class="pf-showgrid__action"
														aria-label={`Replace showcase ${position}`}
														onClick={() => open("showcase", position)}
													>
														<Icon name="refresh" size="sm" />
													</button>
												</Tooltip>
												<Tooltip content="Remove" placement="top">
													<button
														type="button"
														class="pf-showgrid__action"
														aria-label={`Remove showcase ${position}`}
														onClick={() => askRemove(position)}
													>
														<Icon name="trash" size="sm" />
													</button>
												</Tooltip>
											</span>
										</div>
									)
									: (
										<button
											type="button"
											class="pf-showgrid__empty"
											aria-label={`Add to showcase ${position}${primary ? " (your thumbnail)" : ""}`}
											onClick={() => open("showcase", position)}
										>
											<Icon name="plus" size="md" />
										</button>
									)}
								<span class="pf-showgrid__label">
									{primary ? "1 · Thumbnail" : String(position)}
								</span>
							</li>
						);
					})}
				</ol>
			</div>

			<MediaCropModal
				open={modalOpen}
				handle={handle}
				target={target.target}
				position={target.position}
				initialAlt={target.alt}
				onApplied={applied}
			/>
			<ConfirmDialog
				visible={confirmOpen}
				header="Empty this slot?"
				message="The picture leaves your profile. It stays in your library, so you can put it back."
				acceptLabel="Remove"
				rejectLabel="Keep"
				acceptSeverity="danger"
				onAccept={() => void remove()}
				onReject={() => (removing.value = null)}
			/>
		</div>
	);
}
