import { assertEquals } from "@std/assert";
import { SavePortfolioPieceSchema, type WorkPiece } from "@projective/types/profile";
import { pieceDirty, pieceDraftOf, pieceInput, UNFILED_CATEGORY } from "./owner-portfolio.ts";

const PIECE_ID = "44444444-4444-4444-8444-444444444444";
const ASSET_ID = "55555555-5555-4555-8555-555555555555";

const piece: WorkPiece = {
	id: PIECE_ID,
	title: "Calm onboarding",
	category: UNFILED_CATEGORY,
	media: { kind: "image", src: "/m.webp", aspect: 1.6, alt: "Calm onboarding" },
	href: "/l.webp",
	description: "Four questions.",
	isPublic: false,
};

Deno.test("a new piece opens blank and public, with no cover", () => {
	const draft = pieceDraftOf(null);
	assertEquals(draft.isPublic, true);
	assertEquals(draft.cover, null);
	assertEquals(pieceDirty(draft, draft), false);
});

Deno.test("the read's unfiled fallback opens as no category, so a save never writes it", () => {
	const draft = pieceDraftOf(piece);
	assertEquals(draft.category, "");
	assertEquals(draft.coverPreview, "/m.webp");
	assertEquals(pieceInput(draft, PIECE_ID).category, null);
});

Deno.test("an edit keeps its cover unless a new one is chosen", () => {
	const draft = pieceDraftOf(piece);
	assertEquals("cover" in pieceInput(draft, PIECE_ID), false);
	const recovered = { ...draft, cover: { sourceAssetId: ASSET_ID } };
	assertEquals(pieceDirty(draft, recovered), true);
	assertEquals(pieceInput(recovered, PIECE_ID).cover, { sourceAssetId: ASSET_ID });
});

Deno.test("the request is trimmed, empty captions travel as none, and the schema accepts it", () => {
	const input = pieceInput(
		{
			...pieceDraftOf(null),
			title: "  Night mode ",
			client: "  ",
			cover: { sourceAssetId: ASSET_ID },
		},
		null,
	);
	assertEquals(input.title, "Night mode");
	assertEquals(input.client, null);
	assertEquals("id" in input, false);
	assertEquals(SavePortfolioPieceSchema.safeParse(input).success, true);
});

Deno.test("a new piece without a cover is refused before it travels", () => {
	const parsed = SavePortfolioPieceSchema.safeParse(
		pieceInput({ ...pieceDraftOf(null), title: "x" }, null),
	);
	assertEquals(parsed.success, false);
});
