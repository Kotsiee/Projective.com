import type {
	AvailabilityPreset,
	BindListingAvailability,
	SavePresetInput,
	SavePresetResult,
} from "@projective/types/scheduling";
import { getCatalogue, postCatalogue, putCatalogue } from "./api.ts";
import type {
	ApplyListingMediaInput,
	BindListingAvailabilityResult,
	ClientPipeline,
	ListingMediaSlot,
	ReorderListingMediaInput,
	SaveListingShowcaseInput,
	SkillRef,
} from "../types/catalogue-types.ts";
import type { CatalogueResult } from "../types/results.ts";

/**
 * WorkspaceService — the THIN client for the item workspace's own endpoints: the showcase writes,
 * the skills and tag typeaheads, the availability presets and binding, and the Clients tab's count.
 * Each call forwards to a thin route and returns a soft {@link CatalogueResult}; the listing reads
 * and saves stay on `CatalogueService`.
 */
export const WorkspaceService = {
	/** Cut library assets into showcase slots. */
	applyMedia(input: ApplyListingMediaInput): Promise<CatalogueResult<ListingMediaSlot[]>> {
		return postCatalogue<ListingMediaSlot[]>("/api/catalogue/media", input);
	},

	/** Move showcase items between their filled slots. */
	reorderMedia(input: ReorderListingMediaInput): Promise<CatalogueResult<ListingMediaSlot[]>> {
		return postCatalogue<ListingMediaSlot[]>("/api/catalogue/media/reorder", input);
	},

	/** Save the showcase as a whole (empty a slot, edit alt text). */
	saveShowcase(input: SaveListingShowcaseInput): Promise<CatalogueResult<ListingMediaSlot[]>> {
		return postCatalogue<ListingMediaSlot[]>("/api/catalogue/media/save", input);
	},

	/** `org.skills` labels matching a typed prefix. */
	skills(q: string): Promise<CatalogueResult<{ skills: SkillRef[] }>> {
		return getCatalogue<{ skills: SkillRef[] }>(
			`/api/catalogue/skills?${new URLSearchParams({ q })}`,
		);
	},

	/** Search tags to offer for a typed prefix. */
	suggestTags(q: string): Promise<CatalogueResult<{ tags: string[] }>> {
		return getCatalogue<{ tags: string[] }>(
			`/api/search/suggest-tags?${new URLSearchParams({ q })}`,
		);
	},

	/** The seller's live availability presets: library presets first, then service forks. */
	presets(): Promise<CatalogueResult<{ presets: AvailabilityPreset[] }>> {
		return getCatalogue<{ presets: AvailabilityPreset[] }>("/api/scheduling/presets");
	},

	/** Save a preset whole; it is compiled for the booking gate on the way. */
	savePreset(input: SavePresetInput): Promise<CatalogueResult<SavePresetResult>> {
		return putCatalogue<SavePresetResult>("/api/scheduling/presets", input);
	},

	/** Bind a session listing to its default preset, a library preset, or its own fork. */
	bindAvailability(
		input: BindListingAvailability,
	): Promise<CatalogueResult<BindListingAvailabilityResult>> {
		return postCatalogue<BindListingAvailabilityResult>("/api/catalogue/availability", input);
	},

	/** One listing's client pipeline (the Clients tab's lanes and counts). */
	clients(slug: string): Promise<CatalogueResult<ClientPipeline>> {
		return getCatalogue<ClientPipeline>(
			`/api/catalogue/clients?${new URLSearchParams({ listing: slug })}`,
		);
	},
};
