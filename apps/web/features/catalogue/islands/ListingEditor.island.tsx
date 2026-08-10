import type { JSX } from "preact";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/catalogue.css";
// The explore card CSS is app-local + island-bundled (Decision #39): importing it here styles the REAL
// `ServiceCard`/`ProductCard` rendered in the live preview. Their `@projective/ui` component CSS
// (Avatar · RatingStars) rides the island graph automatically (the cards import those modules).
import "@features/explore/styles/explore.css";
import { RichTextEditor } from "@projective/ui/editor";
import { Button, Chips, InputText, Select, Textarea } from "@projective/ui/fields";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { ServiceCard } from "@features/explore/components/cards/ServiceCard.tsx";
import { ProductCard } from "@features/explore/components/cards/ProductCard.tsx";
import type { ProductItem, ServiceItem } from "@projective/types/explore";
import { CatalogueService } from "../core/CatalogueService.ts";
import {
	buildPreviewItem,
	MODEL_OPTIONS,
	publicListingHref,
} from "../core/catalogue-model.ts";
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
	type ListingAvailability,
	type ListingDetail,
	type ListingPricing,
	type ListingStatus,
	publishReadiness,
	resolveListingPricing,
	type ServiceType,
	type UpdateListingInput,
} from "../types/catalogue-types.ts";
import { Icon } from "@projective/ui/icons";

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
/** The Asset Picker routing key for listing media — one editor is open at a time. */
const MEDIA_PICKER_ID = "catalogue-media";
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const SAMPLE_MEDIA = [
	"https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&h=600&q=72",
	"https://images.unsplash.com/photo-1545235617-9465d2a55698?auto=format&fit=crop&w=800&h=600&q=72",
	"https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?auto=format&fit=crop&w=800&h=600&q=72",
];

const num = (s: string): number => Number(s.replace(/[^0-9.]/g, "")) || 0;
const numOrNull = (s: string): number | null => {
	const n = num(s);
	return n > 0 ? n : null;
};
const stripHtml = (html: string): string =>
	html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
// #endregion

export default function ListingEditor({ initial }: ListingEditorProps): JSX.Element {
	const isService = initial.kind === "service";

	// #region Signals (editable state)
	const title = useSignal(initial.title);
	const category = useSignal(initial.category);
	const serviceType = useSignal<ServiceType>(initial.serviceType ?? "One-Off");
	const description = useSignal(initial.description);
	const media = useSignal<string[]>(initial.media);
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
	const mediaUrl = useSignal("");
	// Availability
	const avWeekdays = useSignal<number[]>(initial.availability?.weekdays ?? [1, 2, 3, 4, 5]);
	const avStart = useSignal(String(initial.availability?.startHour ?? 9));
	const avEnd = useSignal(String(initial.availability?.endHour ?? 17));
	const avNote = useSignal(initial.availability?.note ?? "");
	// Lifecycle + save
	const status = useSignal<ListingStatus>(initial.status);
	const saveState = useSignal<"saved" | "saving" | "unsaved">("saved");
	const notice = useSignal<string | null>(null);
	const saveTimer = useRef<number | null>(null);
	// #endregion

	// #region Derived (preview detail + publish gate)
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
	}));

	const availability = useComputed<ListingAvailability | null>(() => {
		if (!isService || (serviceType.value !== "Session" && serviceType.value !== "Group Session")) {
			return null;
		}
		return {
			timezone: initial.availability?.timezone ?? "UTC",
			weekdays: [...avWeekdays.value].sort(),
			startHour: num(avStart.value),
			endHour: num(avEnd.value),
			note: avNote.value,
		};
	});

	const preview = useComputed<ListingDetail>(() => {
		const st = isService ? serviceType.value : null;
		return {
			...initial,
			title: title.value,
			category: category.value,
			serviceType: st,
			status: status.value,
			description: description.value,
			descriptionText: stripHtml(description.value),
			media: media.value,
			cover: media.value[0] ?? null,
			tags: tags.value,
			collections: collections.value,
			delivery: delivery.value,
			pricing: pricing.value,
			availability: availability.value,
			price: resolveListingPricing({ kind: initial.kind, serviceType: st, pricing: pricing.value }),
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
			title: title.value,
			category: category.value,
			serviceType: isService ? serviceType.value : undefined,
			description: description.value,
			descriptionText: stripHtml(description.value),
			media: media.value,
			tags: tags.value,
			collections: collections.value,
			delivery: delivery.value,
			pricing: pricing.value,
			availability: availability.value,
		};
	}

	async function save(): Promise<void> {
		saveState.value = "saving";
		const res = await CatalogueService.update(buildPatch());
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
			notice.value = res.message ?? null;
		} else {
			notice.value = res.message ?? "Couldn't change the status.";
		}
	}

	function addMedia(url: string): void {
		const u = url.trim();
		if (!u || media.value.includes(u)) return;
		media.value = [...media.value, u];
		touch();
	}
	function removeMedia(url: string): void {
		media.value = media.value.filter((m) => m !== url);
		touch();
	}

	/**
	 * Add listing media from the seller's own files.
	 *
	 * The picker is restricted to `image` because listing media is what a buyer SEES on the card and in
	 * the gallery — the `kinds` restriction is the accept list, applied by the server rather than by the
	 * grid hiding rows it already paid to fetch.
	 *
	 * A picked asset contributes its URL, so the media list stays one flat array of image sources and
	 * the live preview keeps rendering the REAL `ServiceCard`/`ProductCard` with no second code path.
	 * `addMedia` already refuses a duplicate, so picking the same image twice is a no-op rather than a
	 * second cover candidate.
	 */
	function addLibraryMedia(assets: AssetItem[]): void {
		for (const asset of assets) {
			const url = asset.thumbnailUrl ?? asset.url;
			if (url && url !== "#") addMedia(url);
		}
	}
	function toggleWeekday(d: number): void {
		const set = new Set(avWeekdays.value);
		set.has(d) ? set.delete(d) : set.add(d);
		avWeekdays.value = [...set];
		touch();
	}
	// #endregion

	const previewItem = useComputed(() => buildPreviewItem(preview.value));
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
							status={stripHtml(description.value) ? "default" : "gate"}
							minRows={5}
							aria-label="Listing description"
						/>
					</section>

					<section class="cat-form__section">
						<h2 class="cat-form__h">
							Media <span class="cat-form__hint">— the first image is the cover</span>
						</h2>
						<div class="cat-media">
							{media.value.map((m) => (
								<div key={m} class="cat-media__item">
									<img src={m} alt="" loading="lazy" />
									<button
										type="button"
										class="cat-media__remove"
										aria-label="Remove image"
										onClick={() => removeMedia(m)}
									>
										<Icon name="close" />
									</button>
								</div>
							))}
							{media.value.length === 0 && (
								<div class="cat-media__empty">
									<ImageIcon size={22} /> No media yet
								</div>
							)}
						</div>
						<div class="cat-media__add">
							<InputText
								value={mediaUrl}
								placeholder="Paste an image URL"
								block
								aria-label="Image URL"
							/>
							<Button
								variant="outlined"
								size="sm"
								label="Add"
								onClick={() => {
									addMedia(mediaUrl.value);
									mediaUrl.value = "";
								}}
							/>
							{/* The paste-a-URL path stays: a seller often has the image somewhere else first. */}
							<Button
								variant="outlined"
								size="sm"
								label="From your files"
								onClick={() =>
									openPicker({
										requesterId: MEDIA_PICKER_ID,
										title: "Choose listing media",
										kinds: ["image"],
										multiple: true,
									})}
							/>
							<Button
								variant="text"
								size="sm"
								label="Add sample"
								onClick={() => addMedia(SAMPLE_MEDIA[media.value.length % SAMPLE_MEDIA.length])}
							/>
						</div>
					</section>

					<section class="cat-form__section">
						<h2 class="cat-form__h">Pricing</h2>
						{showFixed && (
							<label class="cat-field">
								<span class="cat-field__label">Price ($)</span>
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
								<span class="cat-field__label">Ticket price ($)</span>
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
									<span class="cat-field__label">Session price ($)</span>
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

					{showSession && (
						<section class="cat-form__section">
							<h2 class="cat-form__h">Availability</h2>
							<div class="cat-avail">
								<div class="cat-avail__days" role="group" aria-label="Available weekdays">
									{WEEKDAY_LABELS.map((lbl, d) => (
										<button
											key={d}
											type="button"
											class="cat-avail__day"
											data-on={avWeekdays.value.includes(d) ? "true" : undefined}
											aria-pressed={avWeekdays.value.includes(d)}
											aria-label={`Toggle day ${d}`}
											onClick={() => toggleWeekday(d)}
										>
											{lbl}
										</button>
									))}
								</div>
								<div class="cat-field-row">
									<label class="cat-field">
										<span class="cat-field__label">From (h)</span>
										<InputText
											value={avStart}
											onValueChange={touch}
											type="number"
											block
											aria-label="Start hour"
										/>
									</label>
									<label class="cat-field">
										<span class="cat-field__label">To (h)</span>
										<InputText
											value={avEnd}
											onValueChange={touch}
											type="number"
											block
											aria-label="End hour"
										/>
									</label>
								</div>
								{
									/*
									 * The package `Textarea`, not a bare element. The hand-rolled `.cat-textarea` it
									 * replaces removed its own focus outline and substituted a border tint — no
									 * visible focus indicator at all for a keyboard user — and stood outside the
									 * whole `--fld-*` state model that its nine sibling fields on this page use.
									 */
								}
								<label class="cat-field">
									<span class="cat-field__label">Booking note</span>
									<Textarea
										value={avNote}
										onValueChange={touch}
										rows={2}
										autoResize
										maxRows={6}
										fluid
										placeholder="e.g. Booked in 60-minute blocks · 48h notice"
										aria-label="Booking note"
									/>
								</label>
							</div>
						</section>
					)}

					<section class="cat-form__section">
						<h2 class="cat-form__h">Tags & collections</h2>
						<label class="cat-field">
							<span class="cat-field__label">Tags</span>
							<Chips
								value={tags}
								onValueChange={touch}
								placeholder="Add a tag, press Enter"
								max={12}
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
							{isService
								? <ServiceCard item={previewItem.value as ServiceItem} authed />
								: <ProductCard item={previewItem.value as ProductItem} authed />}
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

			{
				/* Mounted unconditionally — an island is only in the page's island graph once it renders,
			    and that graph is what carries its stylesheet. It draws nothing until it is opened. */
			}
			<AssetPicker requesterId={MEDIA_PICKER_ID} onPick={addLibraryMedia} />
		</div>
	);
}
