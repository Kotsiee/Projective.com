import { assertEquals } from "@std/assert";
import { SavePortfolioPieceSchema } from "@projective/types/profile";
import { portfolioPayload } from "./live-profile-writes.ts";

/**
 * live-profile-writes_test — the snake_case piece `org.save_portfolio_piece` reads (Decision #439):
 * every field travels, an empty client or category as none, and the cover is the RENDITION's id the
 * pipeline cut — never the library asset the editor named.
 */

Deno.test("a new piece travels with the rendition, not the library asset", () => {
	const input = SavePortfolioPieceSchema.parse({
		title: " Calm onboarding ",
		client: "  ",
		category: "Mobile",
		isPublic: false,
		cover: { sourceAssetId: "0b7c1e2d-3f4a-4b5c-8d6e-7f8091a2b3c4" },
	});
	assertEquals(portfolioPayload(input, "rendition-1"), {
		id: null,
		title: "Calm onboarding",
		client: null,
		category: "Mobile",
		description: "",
		is_public: false,
		cover_file_id: "rendition-1",
	});
});

Deno.test("an edit that keeps its cover sends none", () => {
	const input = SavePortfolioPieceSchema.parse({
		id: "6f1d2b8e-4a1c-4c55-9d1e-2f6b0e3a7c10",
		title: "Night mode",
		client: "Lantern Commerce",
		category: null,
		description: "Contrast and type at low light.",
		isPublic: true,
	});
	assertEquals(portfolioPayload(input, null), {
		id: "6f1d2b8e-4a1c-4c55-9d1e-2f6b0e3a7c10",
		title: "Night mode",
		client: "Lantern Commerce",
		category: null,
		description: "Contrast and type at low light.",
		is_public: true,
		cover_file_id: null,
	});
});
