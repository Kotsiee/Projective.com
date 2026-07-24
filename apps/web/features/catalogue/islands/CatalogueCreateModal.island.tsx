import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/catalogue.css";
import { Dialog } from "@projective/ui/feedback";
import { Button, InputText, Select, SelectButton } from "@projective/ui/fields";
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

export default function CatalogueCreateModal(): JSX.Element {
	const kind = useSignal<CatalogueKind>(createSeedKind.value);
	const model = useSignal<ServiceType>(createSeedModel.value);
	const title = useSignal("");
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);

	// Re-seed the form each time the modal opens (a false→true transition seeds kind/model/title).
	useSignalEffect(() => {
		if (createModalOpen.value) {
			title.value = "";
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
				<label class="cat-field">
					<span class="cat-field__label">Title</span>
					<InputText
						value={title}
						placeholder={isService ? "Name your service" : "Name your product"}
						block
						maxLength={200}
						status={title.value.trim() ? "default" : "required"}
						aria-label="Listing title"
					/>
				</label>

				<div class="cat-field">
					<span class="cat-field__label">Type</span>
					<SelectButton
						options={KIND_OPTIONS}
						value={kind.value}
						onValueChange={(v) => (kind.value = v as CatalogueKind)}
						aria-label="Listing type"
					/>
					<p class="cat-field__hint">
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
					<label class="cat-field">
						<span class="cat-field__label">Delivery model</span>
						<Select
							options={[...MODEL_OPTIONS]}
							value={model.value}
							onValueChange={(v) => (model.value = v as ServiceType)}
							fluid
							aria-label="Service delivery model"
						/>
					</label>
				)}

				{error.value && <p class="cat-create__error" role="alert">{error.value}</p>}
			</div>
		</Dialog>
	);
}
