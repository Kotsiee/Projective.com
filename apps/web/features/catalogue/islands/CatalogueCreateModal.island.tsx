import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/console.css";
import { Dialog, HintPopover } from "@projective/ui/feedback";
import {
	Button,
	CurrencySelect,
	FieldLegend,
	InputText,
	Select,
	SelectButton,
} from "@projective/ui/fields";
import { DISPLAY_CURRENCIES } from "@projective/types/finance";
import { CreateCategory } from "@projective/types/org";
import { CatalogueService } from "../core/CatalogueService.ts";
import { CREATE_CATEGORY_OPTIONS, MODEL_OPTIONS } from "../core/catalogue-model.ts";
import { closeCreate, consoleReady, consoleUrl } from "../core/console-store.ts";
import { CatalogueKind, ServiceType, workspaceHref } from "@projective/types/catalogue";

/**
 * CatalogueCreateModal — Quick-Init for listings: the only create surface (there is no
 * `/catalogue/new`). It is open exactly while the console URL carries `?create=` — the lane's and
 * footer's New listing, the empty state, and any `?create=product` / `?create=service:<model>` deep
 * link all arrive the same way — and closing it strips the parameter in place.
 *
 * It asks only what the seller knows before the draft exists: the title, product or service (and a
 * service's delivery model), the CREATE category if they know it, and the currency to price in,
 * seeded from their display currency. A created draft opens on its workspace's media section,
 * because a cover is the first thing the publish gate asks for.
 */

// #region Vocabulary
const KIND_OPTIONS = [
	{ label: "Product", value: "product" },
	{ label: "Service", value: "service" },
];

const NOT_YET = "none";

const CATEGORY_OPTIONS = [
	...CREATE_CATEGORY_OPTIONS.map((c) => ({ label: c.label, value: c.value })),
	{ label: "Not yet", value: NOT_YET },
];

const TITLE_ID = "cat-create-title";
const KIND_LABEL_ID = "cat-create-kind-label";
const KIND_HINT_ID = "cat-create-kind-hint";
const MODEL_ID = "cat-create-model";
const CATEGORY_LABEL_ID = "cat-create-category-label";
const CATEGORY_HINT_ID = "cat-create-category-hint";
const CURRENCY_ID = "cat-create-currency";
const TITLE_MAX = 200;
// #endregion

export interface CatalogueCreateModalProps {
	/** The seller's display currency, narrowed to the selectable set — the currency's seed. */
	defaultCurrency: string;
}

export default function CatalogueCreateModal(props: CatalogueCreateModalProps): JSX.Element {
	const visible = useSignal(false);
	const title = useSignal("");
	const kind = useSignal<CatalogueKind>("service");
	const model = useSignal<ServiceType>("One-Off");
	const category = useSignal<string>(NOT_YET);
	const currency = useSignal(props.defaultCurrency);
	const touched = useSignal(false);
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);

	useSignalEffect(() => {
		const url = consoleUrl.value;
		const open = consoleReady.value && url.createOpen;
		if (open && !visible.peek()) {
			title.value = "";
			kind.value = url.createKind ?? "service";
			model.value = url.createModel ?? "One-Off";
			category.value = NOT_YET;
			currency.value = props.defaultCurrency;
			touched.value = false;
			submitting.value = false;
			error.value = null;
		}
		visible.value = open;
	});

	async function submit(): Promise<void> {
		const name = title.value.trim();
		if (!name) {
			touched.value = true;
			error.value = "Name your listing.";
			return;
		}
		submitting.value = true;
		error.value = null;
		const createCategory = CreateCategory.safeParse(category.value);
		const res = await CatalogueService.create({
			title: name,
			kind: kind.value,
			serviceType: kind.value === "service" ? model.value : undefined,
			createCategory: createCategory.success ? createCategory.data : undefined,
			currency: currency.value,
		});
		submitting.value = false;
		if (res.ok && res.data) {
			const team = consoleUrl.peek().team;
			closeCreate();
			globalThis.location.assign(
				workspaceHref(res.data.listing.id, { team, tab: "edit", section: "media" }),
			);
			return;
		}
		error.value = res.message ?? "Couldn't create the listing. Try again.";
	}

	const isService = kind.value === "service";
	const kindHint = isService
		? "A service is delivered as a pipeline, a one-off, a direct deliverable or a session."
		: "A product is a ready-to-buy digital deliverable.";
	const categoryHint = CREATE_CATEGORY_OPTIONS.find((c) => c.value === category.value)?.hint ??
		"You can choose it later, before you publish.";

	return (
		<Dialog
			visible={visible}
			onVisibleChange={(v) => {
				if (!v) closeCreate();
			}}
			header="Create a listing"
			modal
			width="36rem"
			class="cat-create"
			footer={
				<div class="cat-create__actions">
					<Button variant="text" label="Cancel" onClick={closeCreate} />
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
				<div class="cat-create__field">
					<label class="cat-create__label" for={TITLE_ID}>Title</label>
					<InputText
						id={TITLE_ID}
						value={title}
						placeholder={isService ? "Name your service" : "Name your product"}
						block
						maxLength={TITLE_MAX}
						required
						status={touched.value && !title.value.trim() ? "required" : "default"}
						onBlur={() => (touched.value = true)}
					/>
				</div>

				<div
					class="cat-create__field"
					role="group"
					aria-labelledby={KIND_LABEL_ID}
					aria-describedby={KIND_HINT_ID}
				>
					<div class="cat-create__labelrow">
						<span class="cat-create__label" id={KIND_LABEL_ID}>Type</span>
						<HintPopover label="About type">{kindHint}</HintPopover>
					</div>
					<SelectButton
						options={KIND_OPTIONS}
						value={kind.value}
						onValueChange={(v) => {
							const parsed = CatalogueKind.safeParse(v);
							if (parsed.success) kind.value = parsed.data;
						}}
					/>
					<span class="ui-visually-hidden" id={KIND_HINT_ID}>{kindHint}</span>
				</div>

				{isService && (
					<div class="cat-create__field">
						<label class="cat-create__label" for={MODEL_ID}>Delivery model</label>
						<Select
							id={MODEL_ID}
							options={[...MODEL_OPTIONS]}
							value={model.value}
							onValueChange={(v) => {
								const parsed = ServiceType.safeParse(v);
								if (parsed.success) model.value = parsed.data;
							}}
							fluid
						/>
					</div>
				)}

				<div
					class="cat-create__field"
					role="group"
					aria-labelledby={CATEGORY_LABEL_ID}
					aria-describedby={CATEGORY_HINT_ID}
				>
					<div class="cat-create__labelrow">
						<span class="cat-create__label" id={CATEGORY_LABEL_ID}>CREATE category</span>
						<HintPopover label="About CREATE category">{categoryHint}</HintPopover>
					</div>
					<SelectButton
						class="cat-create__categories"
						options={CATEGORY_OPTIONS}
						value={category.value}
						onValueChange={(v) => {
							if (typeof v === "string") category.value = v;
						}}
					/>
					<span class="ui-visually-hidden" id={CATEGORY_HINT_ID}>{categoryHint}</span>
				</div>

				<div class="cat-create__field">
					<label class="cat-create__label" for={CURRENCY_ID}>Currency</label>
					<CurrencySelect
						id={CURRENCY_ID}
						currencies={DISPLAY_CURRENCIES}
						value={currency}
						fluid
					/>
				</div>

				<FieldLegend text="Required to create the draft" />

				{error.value && <p class="cat-create__error" role="alert">{error.value}</p>}
			</div>
		</Dialog>
	);
}
