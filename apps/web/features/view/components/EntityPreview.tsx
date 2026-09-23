import type { ComponentChildren, JSX } from "preact";
import { ProgressiveImage } from "@projective/ui/display/image";
import { MoneyView } from "@projective/ui/display/money";
import type { EntityView } from "@projective/types/explore";
import { toMinorUnits } from "@projective/types/finance";
import {
	type EntityArchetype,
	inlineMetaFor,
	resolveArchetype,
	scopeHeadingFor,
	seatCapacityFor,
	showsStageLedger,
} from "../core/entity-archetype.ts";
import {
	MetaLine,
	ScopeChecklist,
	SeatMeter,
	SellerLine,
	SpecLedger,
} from "./entity-view-parts.tsx";

/**
 * EntityPreview — the read-only preview of a listing in the `/view` page's OWN vocabulary: the
 * cover, the title, the inline meta line, the summary, the seller line, and the archetype's scope
 * (the stage run, the deliverables checklist, the session facts) — composed from the same parts
 * `EntityViewPage` renders with (`entity-view-parts.tsx`), fed the same projection
 * (`ExploreBackendService.viewPage`).
 *
 * That reuse is the whole point. The profile's service modal shows this beside its inputs so what
 * a buyer decides about is beside the decision; if it were a second rendering of the listing it
 * would be a second thing to keep in agreement with the page, and a modal that says "3 stages"
 * over a page that says four is worse than one that says nothing.
 *
 * Deliberately WITHOUT a price and without a purchase control: the offer has exactly one home on
 * the modal — its footer — as it has exactly one on the page (§D.7.3), and the preview is the
 * evaluation material, not the transaction.
 *
 * A server-safe component (no state), so the modal can render it the moment the projection arrives.
 * Its sheet is `entity-view.css`, which the host island must import (§C.1 — a sheet reached only
 * through a server component never ships).
 */
export interface EntityPreviewProps {
	view: EntityView;
	/** How many deliverables to list before "and N more" — a preview, not the page. */
	maxDeliverables?: number;
	class?: string;
}

export function EntityPreview(
	{ view, maxDeliverables = 6, class: cls }: EntityPreviewProps,
): JSX.Element {
	const archetype = resolveArchetype(view);
	const { item, gallery, deliverables } = view;
	const cover = gallery[0] ?? null;
	const meta = inlineMetaFor(view, archetype);
	const rating = item.rating?.asHelper ?? item.rating?.asClient ?? null;
	const capacity = seatCapacityFor(view, archetype);
	const shown = deliverables.slice(0, maxDeliverables);
	const more = deliverables.length - shown.length;

	return (
		<div class={`evp-preview${cls ? ` ${cls}` : ""}`}>
			{cover && (
				<div class="evp-preview__cover">
					<ProgressiveImage
						src={cover.src}
						alt={cover.alt}
						placeholder={cover.placeholder}
						loading="lazy"
						class="evp-preview__img"
					/>
				</div>
			)}

			<h3 class="evp-preview__title">{item.title}</h3>
			<MetaLine items={meta} />
			<p class="evp-preview__summary">{item.summary}</p>

			<SellerLine
				item={item}
				seller={view.seller}
				rating={rating}
				responseMinutes={view.responseMinutes}
			/>

			<ArchetypeScope
				view={view}
				archetype={archetype}
				shown={shown}
				more={more}
			/>

			{capacity && archetype === "cohort" && <SeatMeter capacity={capacity} />}
		</div>
	);
}

// #region Scope
/**
 * The archetype's scope, at preview scale.
 *
 * A staged format lists its stages as a ledger (name → price) rather than the page's full
 * `<details>` track — a modal column has no room for six open accordions and a buyer reading the
 * preview wants the SHAPE of the engagement, not every stage's brief. A session lists its format
 * facts. Every format lists the deliverables it includes, capped.
 */
function ArchetypeScope(
	{ view, archetype, shown, more }: {
		view: EntityView;
		archetype: EntityArchetype;
		shown: readonly string[];
		more: number;
	},
): JSX.Element | null {
	const heading = scopeHeadingFor(archetype);
	const currency = view.item.type === "services" ? view.item.currency ?? "USD" : "USD";

	if (showsStageLedger(archetype, view)) {
		const stages = view.service!.stages;
		return (
			<>
				<PreviewSection title={heading}>
					<SpecLedger
						rows={stages.map((stage) => ({
							label: stage.name,
							value: (
								<MoneyView
									minor={toMinorUnits(stage.price.min, currency) ?? 0}
									currency={currency}
									size="micro"
									hideOrigin
								/>
							),
						}))}
					/>
				</PreviewSection>
				<Deliverables shown={shown} more={more} title="Included in every engagement" />
			</>
		);
	}

	if (archetype === "session" || archetype === "cohort") {
		const rows: Array<{ label: string; value: string }> = [];
		// A row that restates an earlier row's value is dropped: the corpus's session fixtures set
		// the booking summary and the delivery line to the same sentence, and a ledger reading
		// "Format: 60-minute session / Delivery: 60-minute session" says one thing twice.
		const push = (label: string, value: string | undefined | null) => {
			if (!value) return;
			const seen = rows.some((r) => r.value.trim().toLowerCase() === value.trim().toLowerCase());
			if (!seen) rows.push({ label, value });
		};
		push("Format", view.service?.bookingSummary);
		if (view.item.type === "services") push("Delivery", view.item.delivery);
		if (view.service?.sessionMinutes) push("Length", `${view.service.sessionMinutes} minutes`);
		return (
			<>
				<PreviewSection title={heading}>
					<SpecLedger rows={rows} />
				</PreviewSection>
				<Deliverables shown={shown} more={more} title="What the session covers" />
			</>
		);
	}

	return <Deliverables shown={shown} more={more} title={heading} />;
}

function Deliverables(
	{ shown, more, title }: { shown: readonly string[]; more: number; title: string },
): JSX.Element | null {
	if (shown.length === 0) return null;
	return (
		<PreviewSection title={title}>
			<ScopeChecklist items={shown} dense />
			{more > 0 && <p class="evp-preview__more">and {more} more</p>}
		</PreviewSection>
	);
}

/** A section at preview scale — the page's `Section` register, one step down. */
function PreviewSection(
	{ title, children }: { title: string; children: ComponentChildren },
): JSX.Element {
	return (
		<section class="evp-preview__section">
			<h4 class="evp-preview__heading">{title}</h4>
			{children}
		</section>
	);
}
// #endregion
