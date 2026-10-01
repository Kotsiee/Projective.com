import type { GroupPhotoInput, GroupPhotoSet } from "@projective/types/messaging";
import { variantObjectPath } from "@projective/types/files";
import type { ReadActor } from "../read-actor.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { readLibrarySource } from "../media/library.ts";
import { MediaRejectedError, MediaUnavailableError } from "../media/pipeline.ts";
import { type Rendition, retireRendition, writeRendition } from "../profile/live-profile-writes.ts";
import { refusalFrom, type WriteOutcome, type WriteRefusal } from "../projects/live-writes.ts";
import { UUID_RE } from "../projects/live-support.ts";
import { commsClient } from "./live-queries.ts";

/**
 * live-group-photo — a GROUP conversation's own picture.
 *
 * Cut exactly as a profile photo is (Decision #130): the viewer picks one of their own
 * media-library stills in the crop dialog, the server renders the square rendition from the ORIGINAL
 * into the public `avatars` bucket (`writeRendition`, shared with the profile), and the definer door
 * `comms.set_group_photo` points `comms.dm_threads.photo_file_id` at it — refusing a stranger, a
 * non-group, and a file that is not the caller's own processed rendition. A refused rendition is
 * retired again, so a failed write leaves no orphaned public object behind.
 */

type Actor = ReadActor & { accessToken: string };

/** A rendered group photo: the stored rendition and the URL a conversation row paints. */
export interface RenderedGroupPhoto {
	rendition: Rendition;
	url: string | null;
}

/** The URL a conversation row paints for a rendition (the `sm` tier — every surface is ≤ 48px). */
function renditionUrl(rendition: Rendition): string | null {
	const full = rendition.paths[0];
	return full ? publicObjectUrl(rendition.bucket, variantObjectPath(full, "sm")) : null;
}

/** Render the square photo from one of the caller's library stills. Shared by the live + stub paths. */
export async function renderGroupPhoto(
	actor: Actor,
	input: GroupPhotoInput,
): Promise<{ data: RenderedGroupPhoto } | { refusal: WriteRefusal }> {
	const source = await readLibrarySource(actor, input.sourceAssetId);
	if (!source) {
		return {
			refusal: {
				status: 404,
				message: "That picture isn't in your library any more.",
				errors: { sourceAssetId: "not_found" },
			},
		};
	}
	if (source.kind !== "image") {
		return {
			refusal: {
				status: 422,
				message: "A group photo has to be a still image.",
				errors: { sourceAssetId: "video" },
			},
		};
	}
	try {
		const rendition = await writeRendition(
			{ type: "user", id: actor.userId },
			actor,
			source,
			{ target: "avatar", sourceAssetId: input.sourceAssetId, crop: input.crop },
			"Group photo",
		);
		return { data: { rendition, url: renditionUrl(rendition) } };
	} catch (error) {
		if (error instanceof MediaRejectedError) {
			return {
				refusal: { status: 422, message: error.message, errors: { sourceAssetId: "unsupported" } },
			};
		}
		return {
			refusal: {
				status: 503,
				message: error instanceof MediaUnavailableError
					? error.message
					: "The photo couldn't be processed right now. Try again.",
			},
		};
	}
}

/** The door's two sentences, mapped; everything else goes through the shared mapper. */
function photoRefusal(message: string): WriteRefusal {
	if (message.includes("Not a participant")) {
		return { status: 403, message: "You can only change the photo of a group you're in." };
	}
	if (message.includes("Only a group")) {
		return { status: 422, message: "Only a group conversation has its own photo." };
	}
	return refusalFrom(message, "photo");
}

/**
 * Set (or clear, with `null`) a group's photo. `null` outcome when the id addresses no thread — a
 * group is always a uuid-addressed thread on the live path.
 */
export async function setLiveGroupPhoto(
	actor: Actor,
	conversationId: string,
	photo: GroupPhotoInput | null,
): Promise<WriteOutcome<GroupPhotoSet>> {
	if (!UUID_RE.test(conversationId)) return null;

	let rendered: RenderedGroupPhoto | null = null;
	if (photo) {
		const result = await renderGroupPhoto(actor, photo);
		if ("refusal" in result) return result;
		rendered = result.data;
	}

	const { error } = await commsClient(actor).rpc("set_group_photo", {
		p_thread_id: conversationId,
		p_file_id: rendered?.rendition.id ?? null,
	});
	if (error) {
		if (rendered) await retireRendition(rendered.rendition);
		return { refusal: photoRefusal(error.message) };
	}
	return { data: { id: conversationId, avatar: rendered?.url ?? null } };
}
