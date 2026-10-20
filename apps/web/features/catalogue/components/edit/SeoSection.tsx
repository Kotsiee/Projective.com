import type { JSX } from "preact";
import "../../styles/seo.css";
import { InputText, TagCombobox, Textarea } from "@projective/ui/fields";
import {
	LISTING_TAG_LENGTH_MAX,
	LISTING_TAGS_MAX,
	type ListingDetail,
	type ListingSeo,
} from "../../types/catalogue-types.ts";
import { draft, edit } from "../../core/workspace-store.ts";
import { WorkspaceService } from "../../core/WorkspaceService.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";
import { SerpPreview } from "./SerpPreview.tsx";
import { FieldHead } from "./FieldHead.tsx";

const SEO_TITLE_MAX = 70;
const SEO_DESCRIPTION_MAX = 160;

const TITLE_ID = "cat-seo-title";
const TITLE_COUNT_ID = "cat-seo-title-count";
const DESC_ID = "cat-seo-desc";
const DESC_COUNT_ID = "cat-seo-desc-count";
const TAGS_ID = "cat-seo-tags";
const TAGS_HINT_ID = "cat-seo-tags-hint";

async function suggest(q: string): Promise<string[]> {
	const res = await WorkspaceService.suggestTags(q);
	if (!res.ok || !res.data) throw new Error(res.message ?? "Suggestions aren't available.");
	return res.data.tags;
}

/**
 * SeoSection — how the listing reads in search and the tags it is found by: a live search-result
 * preview, the meta title and description overrides with their live counts, and up to ten search
 * tags with suggestions from the discovery typeahead. Empty overrides fall back to the title and
 * the description, which the preview shows.
 */
export function SeoSection(props: { listing: ListingDetail }): JSX.Element {
	const { listing } = props;
	const editSeo = (patch: Partial<ListingSeo>) =>
		edit("seo", { ...(draft.peek()?.seo ?? listing.seo), ...patch });

	return (
		<EditSectionFrame
			section="seo"
			intro="How this listing reads in a search result. Leave a field empty to use the title or description."
		>
			<SerpPreview
				input={{
					slug: listing.id,
					title: listing.title,
					descriptionText: listing.descriptionText,
					seo: listing.seo,
				}}
			/>

			<div class="cat-sec__field">
				<div class="cat-sec__labelrow">
					<label class="cat-sec__label" for={TITLE_ID}>Meta title</label>
					<span class="cat-sec__count" id={TITLE_COUNT_ID}>
						{listing.seo.seoTitle.length} / {SEO_TITLE_MAX}
					</span>
				</div>
				<InputText
					id={TITLE_ID}
					value={listing.seo.seoTitle}
					onValueChange={(v) => editSeo({ seoTitle: v })}
					maxLength={SEO_TITLE_MAX}
					placeholder={listing.title}
					aria-describedby={TITLE_COUNT_ID}
					block
				/>
			</div>

			<div class="cat-sec__field">
				<div class="cat-sec__labelrow">
					<label class="cat-sec__label" for={DESC_ID}>Meta description</label>
					<span class="cat-sec__count" id={DESC_COUNT_ID}>
						{listing.seo.seoDescription.length} / {SEO_DESCRIPTION_MAX}
					</span>
				</div>
				<Textarea
					id={DESC_ID}
					value={listing.seo.seoDescription}
					onValueChange={(v) => editSeo({ seoDescription: v })}
					maxLength={SEO_DESCRIPTION_MAX}
					rows={3}
					autoResize
					maxRows={6}
					placeholder={listing.descriptionText.slice(0, SEO_DESCRIPTION_MAX)}
					aria-describedby={DESC_COUNT_ID}
					fluid
				/>
			</div>

			<div class="cat-sec__field">
				<FieldHead
					label="Search tags"
					htmlFor={TAGS_ID}
					hint="Words buyers search for that aren't already in your title. Tags rank below the title."
					hintId={TAGS_HINT_ID}
				/>
				<TagCombobox
					id={TAGS_ID}
					value={listing.tags}
					onValueChange={(tags) => edit("tags", tags)}
					suggest={suggest}
					max={LISTING_TAGS_MAX}
					maxLength={LISTING_TAG_LENGTH_MAX}
					placeholder="Add a tag, then press Enter"
					aria-describedby={TAGS_HINT_ID}
					fluid
				/>
			</div>
		</EditSectionFrame>
	);
}
