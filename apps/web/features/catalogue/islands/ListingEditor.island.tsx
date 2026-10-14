import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/catalogue.css";
// The explore card CSS is app-local + island-bundled (Decision #39): importing it here styles the REAL
// `ServiceCard`/`ProductCard` rendered in the live preview. Their `@projective/ui` component CSS
// (Avatar · RatingStars) rides the island graph automatically (the cards import those modules).
import "@features/explore/styles/explore.css";
import { RichTextEditor } from "@projective/ui/editor";
import { Chips, InputText, Select } from "@projective/ui/fields";
import { ServiceCard } from "@features/explore/components/cards/ServiceCard.tsx";
import { ProductCard } from "@features/explore/components/cards/ProductCard.tsx";
import { listingCardItem } from "@projective/types/explore";
import { flattenRichText } from "@projective/types/richtext";
import { CatalogueService } from "../core/CatalogueService.ts";
import { MODEL_OPTIONS, publicListingHref } from "../core/catalogue-model.ts";
import { EyeIcon, ImageIcon } from "../components/catalogue-glyphs.tsx";
import {
	editorMissing,
	editorReady,
	editorSaveState,
	editorStatus,
	editorStatusRequest,
	editorTitle,
} from "../core/catalogue-state.ts";
import {
	LISTING_TAGS_MAX,
	type ListingDetail,
	type ListingPricing,
	type ListingStatus,
	publishReadiness,
	resolveListingPricing,
	type ServiceType,
	type UpdateListingInput,
} from "../types/catalogue-types.ts";

/**
 * ListingEditor — the manage page BODY: the rich editor form (left) beside a LIVE preview rendering
 * the REAL `ServiceCard`/`ProductCard` (right). Products vs services diverge only in the
 * delivery-model + pricing fields (branch on `kind`, like `EntityViewScreen`).
 *
 * The page's chrome is no longer here. Identity, status and the autosave indicator went to the header
 * band; the publish gate and its lifecycle actions went to the footer band. Both used to sit in
 * `.cat-editor__bar`, a `position: static` strip at the top of a 1264px scrolling body — so the moment
 * the seller reached the fields they were editing, they lost the save state, the status and the
 * Publish button together.
 *
 * The body keeps the *authority* it has to keep: it holds the unsaved draft, so it is the only thing
 * allowed to perform a lifecycle change. The footer publishes an intent; this island flushes the
 * pending autosave and then acts, so Publish is always judged against what the seller actually typed.
 */

// #region Props + constants
export interface ListingEditorProps {
	initial: ListingDetail;
}
const SAVE_DEBOUNCE_MS = 800;

const num = (s: string): number => Number(s.replace(/[^0-9.]/g, "")) || 0;
const numOrNull = (s: string): number | null => {
	const n = num(s);
	return n > 0 ? n : null;
};
// #endregion

export default function ListingEditor({ initial }: ListingEditorProps): JSX.Element {
	const isService = initial.kind === "service";

	// #region Signals (editable state)
	const title = useSignal(initial.title);
	const category = useSignal(initial.category);
	const serviceType = useSignal<ServiceType>(initial.serviceType ?? "One-Off");
	const description = useSignal(initial.description);
	const tags = useSignal<string[]>(initial.tags);
	const collections = useSignal<string[]>(initial.collections);
	const delivery = useSignal(initial.delivery);
	const amount = useSignal(initial.pricing.amount ? String(initial.pricing.amount) : "");
	const ticket = useSignal(initial.pricing.ticketPrice ? String(initial.pricing.ticketPrice) : "");
	const session = useSignal(
		initial.pricing.sessionPrice ? String(initial.pricing.sessionPrice) : "",
	);
	const seats = useSignal(
		initial.pricing.seatsPerSession ? String(initial.pricing.seatsPerSession) : "8",
	);
	/*
	 * Revisions. Both seed from `?? ""` and NOT from `|| ""`: a declared `0` is a real, distinct offer
	 * on each field — no rounds included, and further rounds free — and `||` would erase both back to
	 * "not declared", which is what the corpus default then fills in.
	 */
	const freeRevisions = useSignal(
		initial.pricing.freeRevisions !== null ? String(initial.pricing.freeRevisions) : "",
	);
	const extraRevision = useSignal(
		initial.pricing.extraRevisionPrice !== null ? String(initial.pricing.extraRevisionPrice) : "",
	);
	// Lifecycle + save
	const status = useSignal<ListingStatus>(initial.status);
	const saveState = useSignal<"saved" | "saving" | "unsaved">("saved");
	const notice = useSignal<string | null>(null);
	const saveTimer = useRef<number | null>(null);
	const lastUpdatedAt = useRef(initial.updatedAt);
	// #endregion

	// #region Derived (preview detail + publish gate)
	/**
	 * Whether this listing delivers something a buyer can send back for another round.
	 *
	 * Every service model except the two SESSION ones: a sitting is consumed as it happens, so there is
	 * no artefact to revise and no honest number to put in the field. A product is a finished download,
	 * bought as-is.
	 */
	const revisable = isService && serviceType.value !== "Session" &&
		serviceType.value !== "Group Session";

	const pricing = useComputed<ListingPricing>(() => ({
		amount: num(amount.value),
		ticketPrice: isService && serviceType.value === "Pipeline" ? numOrNull(ticket.value) : null,
		sessionPrice:
			isService && (serviceType.value === "Session" || serviceType.value === "Group Session")
				? numOrNull(session.value)
				: null,
		seatsPerSession: isService && serviceType.value === "Group Session"
			? numOrNull(seats.value) ?? 8
			: null,
		/*
		 * Only a service that actually DELIVERS something revisable carries an allowance. A sitting that
		 * has already happened cannot be revised, so a Session listing publishes `null` rather than a
		 * zero — the absence is the honest statement, and a zero would render as "0 included".
		 *
		 * `numOrNull` maps "" to null and "0" to 0, which is exactly the distinction these two fields
		 * need to keep.
		 */
		freeRevisions: revisable ? numOrNull(freeRevisions.value) : null,
		extraRevisionPrice: revisable ? numOrNull(extraRevision.value) : null,
	}));

	const preview = useComputed<ListingDetail>(() => {
		const st = isService ? serviceType.value : null;
		return {
			...initial,
			title: title.value,
			category: category.value,
			serviceType: st,
			status: status.value,
			description: description.value,
			descriptionText: flattenRichText(description.value),
			tags: tags.value,
			collections: collections.value,
			delivery: delivery.value,
			pricing: pricing.value,
			price: resolveListingPricing({
				kind: initial.kind,
				serviceType: st,
				pricing: pricing.value,
				currency: initial.currency,
			}),
		};
	});

	const gate = useComputed(() => publishReadiness(preview.value));
	// #endregion

	// #region Publish to the bands (header = identity + save state, footer = the gate)
	useEffect(() => {
		editorTitle.value = initial.title;
		editorStatus.value = initial.status;
		editorSaveState.value = "saved";
		const g = publishReadiness(preview.peek());
		editorReady.value = g.ready;
		editorMissing.value = g.missing;
	}, []);

	useSignalEffect(() => {
		editorTitle.value = title.value;
	});
	useSignalEffect(() => {
		editorStatus.value = status.value;
	});
	useSignalEffect(() => {
		editorSaveState.value = saveState.value;
	});
	useSignalEffect(() => {
		const g = gate.value;
		editorReady.value = g.ready;
		editorMissing.value = g.missing;
	});

	/** The footer band's Publish/Pause/Archive intent — only the body may perform it (see the JSDoc). */
	useSignalEffect(() => {
		const next = editorStatusRequest.value;
		if (!next) return;
		editorStatusRequest.value = null;
		void setStatus(next);
	});
	// #endregion

	// #region Save + lifecycle
	function buildPatch(): UpdateListingInput {
		return {
			id: initial.id,
			expectedUpdatedAt: lastUpdatedAt.current,
			title: title.value,
			category: category.value,
			serviceType: isService ? serviceType.value : undefined,
			description: description.value,
			descriptionText: flattenRichText(description.value),
			tags: tags.value,
			collections: collections.value,
			delivery: delivery.value,
			pricing: pricing.value,
		};
	}

	async function save(): Promise<void> {
		saveState.value = "saving";
		const res = await CatalogueService.update(buildPatch());
		if (res.ok && res.data) lastUpdatedAt.current = res.data.listing.updatedAt;
		saveState.value = res.ok ? "saved" : "unsaved";
		if (!res.ok) notice.value = res.message ?? "Autosave failed — retrying on next edit.";
	}

	/** Mark unsaved + schedule a debounced autosave (called on every field change). */
	function touch(): void {
		saveState.value = "unsaved";
		notice.value = null;
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS) as unknown as number;
	}

	async function setStatus(next: ListingStatus): Promise<void> {
		// Flush any pending edits first so the publish gate sees the latest state.
		if (saveTimer.current) clearTimeout(saveTimer.current);
		await save();
		const res = await CatalogueService.setStatus(initial.id, next);
		if (res.ok && res.data) {
			status.value = res.data.listing.status;
			lastUpdatedAt.current = res.data.listing.updatedAt;
			notice.value = res.message ?? null;
		} else {
			notice.value = res.message ?? "Couldn't change the status.";
		}
	}

	// #endregion

	const previewItem = useComputed(() => listingCardItem(preview.value));
	const showPipeline = isService && serviceType.value === "Pipeline";
	const showSession = isService &&
		(serviceType.value === "Session" || serviceType.value === "Group Session");
	const showFixed = !isService ||
		(serviceType.value === "One-Off" || serviceType.value === "Direct Deliverable");

	return (
		<div class="cat-editor">
			{notice.value && <p class="cat-editor__notice" role="status">{notice.value}</p>}

			<div class="cat-editor__grid">
				{/* LEFT — the form. */}
				<div class="cat-editor__form">
					<section class="cat-form__section">
						<h2 class="cat-form__h">Basics</h2>
						<label class="cat-field">
							<span class="cat-field__label">Title</span>
							<InputText
								value={title}
								onValueChange={touch}
								block
								maxLength={200}
								status={title.value.trim() ? "default" : "required"}
								aria-label="Listing title"
							/>
						</label>

						{isService && (
							<label class="cat-field">
								<span class="cat-field__label">Delivery model</span>
								<Select
									options={[...MODEL_OPTIONS]}
									value={serviceType.value}
									onValueChange={(v) => {
										serviceType.value = v as ServiceType;
										touch();
									}}
									fluid
									aria-label="Delivery model"
								/>
							</label>
						)}

						<label class="cat-field">
							<span class="cat-field__label">Category</span>
							<InputText
								value={category}
								onValueChange={touch}
								block
								maxLength={80}
								placeholder="e.g. branding, web, motion"
								aria-label="Category"
							/>
						</label>
					</section>

					<section class="cat-form__section">
						<h2 class="cat-form__h">Description</h2>
						<RichTextEditor
							value={description}
							onValueChange={touch}
							placeholder="Describe what buyers get, your process, and what's included…"
							status={flattenRichText(description.value) ? "default" : "gate"}
							minRows={5}
							// The form flows in the window scroll beside a STICKY live preview, measured at 544px.
							// Past that height the description decouples the two — the seller ends up writing
							// against a preview that has scrolled off — so the editor scrolls instead of growing.
							// 22rem keeps this section the largest on the form (~430px) and still inside that band.
							maxAutoHeight="22rem"
							aria-label="Listing description"
						/>
					</section>

					<section class="cat-form__section">
						<h2 class="cat-form__h">
							Media <span class="cat-form__hint">— slot 1 is the cover</span>
						</h2>
						<div class="cat-media">
							{initial.media.map((slot) => (
								<div key={slot.position} class="cat-media__item">
									<img src={slot.thumb} alt={slot.alt} loading="lazy" />
								</div>
							))}
							{initial.media.length === 0 && (
								<div class="cat-media__empty">
									<ImageIcon size={22} /> No media yet
								</div>
							)}
						</div>
					</section>

					<section class="cat-form__section">
						<h2 class="cat-form__h">Pricing</h2>
						{showFixed && (
							<label class="cat-field">
								<span class="cat-field__label">Price ({initial.currency})</span>
								<InputText
									value={amount}
									onValueChange={touch}
									type="number"
									block
									placeholder="0"
									aria-label="Fixed price"
								/>
							</label>
						)}
						{showPipeline && (
							<label class="cat-field">
								<span class="cat-field__label">Ticket price ({initial.currency})</span>
								<InputText
									value={ticket}
									onValueChange={touch}
									type="number"
									block
									placeholder="0"
									aria-label="Ticket price"
								/>
								<p class="cat-field__hint">Buyers see a workload range (0.5×–2.0×) around this.</p>
							</label>
						)}
						{showSession && (
							<div class="cat-field-row">
								<label class="cat-field">
									<span class="cat-field__label">Session price ({initial.currency})</span>
									<InputText
										value={session}
										onValueChange={touch}
										type="number"
										block
										placeholder="0"
										aria-label="Session price"
									/>
								</label>
								{serviceType.value === "Group Session" && (
									<label class="cat-field">
										<span class="cat-field__label">Seats / session</span>
										<InputText
											value={seats}
											onValueChange={touch}
											type="number"
											block
											placeholder="8"
											aria-label="Seats per session"
										/>
									</label>
								)}
							</div>
						)}
						{revisable && (
							<div class="cat-field-row">
								<label class="cat-field">
									<span class="cat-field__label">Free revisions / stage</span>
									<InputText
										value={freeRevisions}
										onValueChange={touch}
										type="number"
										block
										placeholder="1"
										aria-label="Free revisions per stage"
									/>
									<p class="cat-field__hint">Rounds included in every stage at no extra cost.</p>
								</label>
								<label class="cat-field">
									<span class="cat-field__label">Extra revision ({initial.currency})</span>
									<InputText
										value={extraRevision}
										onValueChange={touch}
										type="number"
										block
										placeholder="0"
										aria-label="Cost of an additional revision"
									/>
									<p class="cat-field__hint">
										What one further round costs. Enter 0 for unlimited revisions.
									</p>
								</label>
							</div>
						)}
						{isService && (
							<label class="cat-field">
								<span class="cat-field__label">Turnaround / format</span>
								<InputText
									value={delivery}
									onValueChange={touch}
									block
									placeholder="e.g. 5-day delivery, 60-minute session"
									aria-label="Turnaround"
								/>
							</label>
						)}
					</section>

					<section class="cat-form__section">
						<h2 class="cat-form__h">Tags & collections</h2>
						<label class="cat-field">
							<span class="cat-field__label">Tags</span>
							<Chips
								value={tags}
								onValueChange={touch}
								placeholder="Add a tag, press Enter"
								max={LISTING_TAGS_MAX}
								aria-label="Tags"
							/>
						</label>
						<label class="cat-field">
							<span class="cat-field__label">Collections</span>
							<Chips
								value={collections}
								onValueChange={touch}
								placeholder="Group into a collection"
								max={8}
								aria-label="Collections"
							/>
						</label>
					</section>
				</div>

				{/* RIGHT — live preview + publish checklist. */}
				<aside class="cat-editor__preview">
					<div class="cat-preview">
						<h2 class="cat-preview__h">Live preview</h2>
						<div class="cat-preview__card">
							{previewItem.value.type === "services"
								? <ServiceCard item={previewItem.value} authed />
								: <ProductCard item={previewItem.value} authed />}
						</div>

						{
							/*
							 * The readiness checklist is NOT repeated here. It now travels with the Publish button
							 * in the footer band, where it can actually help: as a sticky aside it outlived the
							 * button it described, so the seller could read what was missing at exactly the moment
							 * they could no longer act on it.
							 */
						}
						<a
							class="cat-preview__public"
							href={publicListingHref(preview.value)}
							target="_blank"
							rel="noopener"
						>
							<EyeIcon size={15} /> View public page
						</a>
					</div>
				</aside>
			</div>
		</div>
	);
}
