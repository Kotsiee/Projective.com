import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/catalogue.css";
import { Dialog } from "@projective/ui/feedback";
import { Button, FieldLegend, InputText, Select, SelectButton } from "@projective/ui/fields";
import { CatalogueService } from "../core/CatalogueService.ts";
import { createModalOpen, createSeedKind, createSeedModel } from "../core/catalogue-state.ts";
import { listingHref, MODEL_OPTIONS } from "../core/catalogue-model.ts";
import { BoxIcon, ServiceIcon } from "../components/catalogue-glyphs.tsx";
import type { CatalogueKind, ServiceType } from "../types/catalogue-types.ts";

/**
 * CatalogueCreateModal — the lightweight "Create a listing" modal, mounted once in the {@link
 * CatalogueLane} and opened from BOTH the lane's `＋ New` split-button and the console empty-state via
 * the shared `catalogue-state` signals. It collects only the minimal fields (title · kind · — for a
 * service — the delivery model), creates a Draft, and routes to `/catalogue/[id]` for the deep edit
 * (mirrors the project Create-modal precedent). Reuses the `@projective/ui/feedback` {@link Dialog}
 * (which portals to `document.body`, escaping the glass-blur trap). Dumb island: it only calls the thin
 * {@link CatalogueService}.
 */

const KIND_OPTIONS = [
	{ label: "Product", value: "product" },
	{ label: "Service", value: "service" },
];

/* Stable ids so each visible label owns its control. The modal is a singleton, so literals are safe
   and keep the label↔control binding readable at the call site. */
const TITLE_ID = "cat-create-title";
const KIND_LABEL_ID = "cat-create-kind-label";
const KIND_HINT_ID = "cat-create-kind-hint";
const MODEL_ID = "cat-create-model";

export default function CatalogueCreateModal(): JSX.Element {
	const kind = useSignal<CatalogueKind>(createSeedKind.value);
	const model = useSignal<ServiceType>(createSeedModel.value);
	const title = useSignal("");
	/** Flips on the title's first blur, so the required gate never fires before the user has typed. */
	const touched = useSignal(false);
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);

	// Re-seed the form each time the modal opens (a false→true transition seeds kind/model/title).
	useSignalEffect(() => {
		if (createModalOpen.value) {
			title.value = "";
			touched.value = false;
			kind.value = createSeedKind.value;
			model.value = createSeedModel.value;
			error.value = null;
			submitting.value = false;
		}
	});

	async function submit(): Promise<void> {
		const t = title.value.trim();
		if (!t) {
			error.value = "Name your listing.";
			return;
		}
		submitting.value = true;
		error.value = null;
		const res = await CatalogueService.create({
			title: t,
			kind: kind.value,
			serviceType: kind.value === "service" ? model.value : undefined,
		});
		submitting.value = false;
		if (res.ok && res.data) {
			createModalOpen.value = false;
			try {
				globalThis.location.assign(listingHref(res.data.listing.id));
			} catch { /* no window — non-fatal */ }
			return;
		}
		error.value = res.message ?? "Couldn't create the listing. Try again.";
	}

	const isService = kind.value === "service";

	return (
		<Dialog
			visible={createModalOpen}
			header="Create a listing"
			modal
			width="30rem"
			class="cat-create"
			footer={
				<div class="cat-create__actions">
					<Button
						variant="text"
						label="Cancel"
						onClick={() => (createModalOpen.value = false)}
					/>
					<Button
						variant="filled"
						severity="primary"
						label={submitting.value ? "Creating…" : "Create draft"}
						loading={submitting.value}
						disabled={!title.value.trim()}
						onClick={submit}
					/>
				</div>
			}
		>
			<div class="cat-create__body">
				{
					/*
					 * Every field here binds its VISIBLE label to its control by id. The previous markup
					 * carried an `aria-label` on each one — "Listing title" over a visible "Title" — which
					 * overrides the label a sighted user reads and a voice-control user says (WCAG 2.5.3).
					 * Two of the three were not associated at all: a `<span>` inside a `<div>` labels
					 * nothing, and a `<label>` wrapping a Select cannot associate implicitly because the
					 * Select's trigger is a `<button>`, which is not a labelable element.
					 */
				}
				<div class="cat-field">
					<label class="cat-field__label" for={TITLE_ID}>Title</label>
					<InputText
						id={TITLE_ID}
						value={title}
						placeholder={isService ? "Name your service" : "Name your product"}
						block
						maxLength={200}
						required
						/*
						 * Neutral until the user has had a turn. Deriving the status straight from
						 * emptiness painted the field red and set `aria-invalid` the instant the modal
						 * opened — an error about something nobody had done yet. `touched` flips on the
						 * first blur, so the gate still shows before submit, just not before typing.
						 */
						status={touched.value && !title.value.trim() ? "required" : "default"}
						onBlur={() => (touched.value = true)}
					/>
				</div>

				<div
					class="cat-field"
					role="group"
					aria-labelledby={KIND_LABEL_ID}
					aria-describedby={KIND_HINT_ID}
				>
					<span class="cat-field__label" id={KIND_LABEL_ID}>Type</span>
					<SelectButton
						options={KIND_OPTIONS}
						value={kind.value}
						onValueChange={(v) => (kind.value = v as CatalogueKind)}
					/>
					<p class="cat-field__hint" id={KIND_HINT_ID}>
						{isService
							? (
								<>
									<ServiceIcon size={14} class="cat-field__hint-icon" />{" "}
									A service is delivered as a pipeline, one-off, session, or workshop.
								</>
							)
							: (
								<>
									<BoxIcon size={14} class="cat-field__hint-icon" />{" "}
									A product is a ready-to-buy digital deliverable.
								</>
							)}
					</p>
				</div>

				{isService && (
					<div class="cat-field">
						<label class="cat-field__label" for={MODEL_ID}>Delivery model</label>
						<Select
							id={MODEL_ID}
							options={[...MODEL_OPTIONS]}
							value={model.value}
							onValueChange={(v) => (model.value = v as ServiceType)}
							fluid
						/>
					</div>
				)}

				<FieldLegend text="Required to create the draft" />

				{error.value && <p class="cat-create__error" role="alert">{error.value}</p>}
			</div>
		</Dialog>
	);
}
