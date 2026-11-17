import type { PortfolioCover, SavePortfolioPiece, WorkPiece } from "@projective/types/profile";

/**
 * owner-portfolio — the pure half of the owner's portfolio dialog (Decision #439): the draft a piece
 * opens on, and the request a save sends to `org.save_portfolio_piece`.
 */

/**
 * The category the public read shows for a piece filed under none (`live-profile.ts`
 * `fetchPortfolio`). It is a display fallback, not a stored value, so the dialog opens it as empty
 * rather than writing it back.
 */
export const UNFILED_CATEGORY = "Work";

/** A piece as the dialog edits it. */
export interface PieceDraft {
	title: string;
	client: string;
	category: string;
	description: string;
	isPublic: boolean;
	/** A newly chosen cover; `null` keeps the stored one. */
	cover: PortfolioCover | null;
	/** What the cover tile shows: the chosen picture, else the stored one. */
	coverPreview: string | null;
}

/** The draft a piece opens on — blank and public for a new one. */
export function pieceDraftOf(piece: WorkPiece | null): PieceDraft {
	if (!piece) {
		return {
			title: "",
			client: "",
			category: "",
			description: "",
			isPublic: true,
			cover: null,
			coverPreview: null,
		};
	}
	return {
		title: piece.title,
		client: piece.client ?? "",
		category: piece.category === UNFILED_CATEGORY ? "" : piece.category,
		description: piece.description ?? "",
		isPublic: piece.isPublic ?? true,
		cover: null,
		coverPreview: piece.media.kind === "video" ? piece.media.poster ?? null : piece.media.src,
	};
}

/** Whether the draft holds anything a save would change. */
export function pieceDirty(initial: PieceDraft, draft: PieceDraft): boolean {
	return draft.cover !== null ||
		draft.title !== initial.title ||
		draft.client !== initial.client ||
		draft.category !== initial.category ||
		draft.description !== initial.description ||
		draft.isPublic !== initial.isPublic;
}

/** The request a save sends: trimmed, an empty caption sent as none, the cover only when chosen. */
export function pieceInput(draft: PieceDraft, id: string | null): SavePortfolioPiece {
	const client = draft.client.trim();
	const category = draft.category.trim();
	return {
		...(id ? { id } : {}),
		title: draft.title.trim(),
		client: client || null,
		category: category || null,
		description: draft.description.trim(),
		isPublic: draft.isPublic,
		...(draft.cover ? { cover: draft.cover } : {}),
	};
}
