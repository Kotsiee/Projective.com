import type { JSX } from "preact";
import { Select, SelectButton, ToggleSwitch } from "@projective/ui/fields";
import { ListingLicence, ListingProductFormat } from "@projective/types/catalogue";
import type { ProductOffer as ProductOfferValue } from "../../../types/catalogue-types.ts";
import { LICENCE_SUMMARY } from "../../../core/offer-model.ts";
import { checkOffer, commitOffer } from "../../../core/offer-commit.ts";
import { useGatedDraft } from "../../../hooks/useGatedDraft.ts";
import { OfferGroup } from "./OfferGroup.tsx";
import { AttachmentList } from "./AttachmentList.tsx";

const FORMAT_LABELS: Readonly<Record<ListingProductFormat, string>> = {
	download: "Download",
	template: "Template",
	preset: "Preset",
	font: "Font",
	course: "Course",
	ebook: "E-book",
	source_code: "Source code",
	bundle: "Bundle",
};

const FORMAT_OPTIONS = ListingProductFormat.options.map((value) => ({
	label: FORMAT_LABELS[value],
	value,
}));

const LICENCE_OPTIONS = [
	{ label: "Personal", value: "personal" },
	{ label: "Commercial", value: "commercial" },
	{ label: "Extended", value: "extended" },
];

const FORMAT_ID = "cat-offer-format";
const LICENCE_HINT_ID = "cat-offer-licence-hint";
const ATTRIBUTION_HINT_ID = "cat-offer-attribution-hint";

/**
 * ProductOffer — what a digital product is and the terms it is sold on: its format, its licence
 * (with what each allows, in a sentence), whether buyers must credit it, and the files it delivers.
 */
export function ProductOffer(props: { offer: ProductOfferValue }): JSX.Element {
	const gated = useGatedDraft(props.offer, checkOffer, commitOffer);
	const offer = gated.value.value as ProductOfferValue;
	const update = (patch: Partial<ProductOfferValue>) => gated.set({ ...offer, ...patch });

	return (
		<>
			<OfferGroup title="Format and licence">
				<div class="cat-sec__field">
					<label class="cat-sec__label" for={FORMAT_ID}>Format</label>
					<Select
						id={FORMAT_ID}
						options={FORMAT_OPTIONS}
						value={offer.format}
						onValueChange={(v) => {
							const parsed = ListingProductFormat.safeParse(v);
							if (parsed.success) update({ format: parsed.data });
						}}
					/>
				</div>
				<div class="cat-sec__field">
					<span class="cat-sec__label" aria-hidden="true">Licence</span>
					<SelectButton
						options={LICENCE_OPTIONS}
						value={offer.licence}
						onValueChange={(v) => {
							const parsed = ListingLicence.safeParse(v);
							if (parsed.success) update({ licence: parsed.data });
						}}
						aria-label="Licence"
						aria-describedby={LICENCE_HINT_ID}
					/>
					<p class="cat-sec__hint" id={LICENCE_HINT_ID}>{LICENCE_SUMMARY[offer.licence]}</p>
				</div>
				<div class="cat-sec__field">
					<ToggleSwitch
						value={offer.attributionRequired}
						onValueChange={(attributionRequired) => update({ attributionRequired })}
						label="Buyers must credit you"
						aria-describedby={ATTRIBUTION_HINT_ID}
					/>
					<p class="cat-sec__hint" id={ATTRIBUTION_HINT_ID}>
						{offer.attributionRequired
							? "Anything made with this names you as its source."
							: "Buyers may use it without naming you."}
					</p>
				</div>
			</OfferGroup>

			<OfferGroup title="Files" hint="What the buyer downloads.">
				<AttachmentList
					attachments={offer.attachments}
					onChange={(attachments) => update({ attachments: [...attachments] })}
				/>
			</OfferGroup>
		</>
	);
}
