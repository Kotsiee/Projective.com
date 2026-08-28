import type { JSX } from "preact";
import { EmptyState } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
import { Avatar, RatingStars } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import "@features/explore/styles/explore.css";
import "@features/explore/styles/explore-results.css";
import "../styles/entity-view.css";
import type { EntityView } from "@projective/types/explore";
import { resolveSchedulePage } from "@web/features/calendar/core/calendar-ssr.ts";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { UserContext } from "@projective/types/auth";
import EntityCanvas from "../islands/EntityCanvas.island.tsx";
import EntityBuyBar from "../islands/EntityBuyBar.island.tsx";
import EntityLane from "../islands/EntityLane.island.tsx";
import SessionSchedulerStage from "../islands/SessionSchedulerStage.island.tsx";
import EntityHeroProbe from "../islands/EntityHeroProbe.island.tsx";
import ReviewsPanel from "../islands/ReviewsPanel.island.tsx";
import ViewStyleAnchor from "../islands/ViewStyleAnchor.island.tsx";
import { RelatedSection } from "./RelatedRail.tsx";
import { ProjectViewScreen } from "./ProjectViewScreen.tsx";
import { ArticleViewScreen } from "./ArticleViewScreen.tsx";
import { StageProgressLedger } from "./StageProgressLedger.tsx";
import {
	MetaLine,
	PermissionLedger,
	ScopeChecklist,
	SeatMeter,
	Section,
	SpecLedger,
	type TrustSignal,
	TrustSignals,
} from "./entity-view-parts.tsx";
import { backHrefFor, backLabelFor, sellerBadges } from "../core/view-model.ts";
import { headlinePriceFor } from "../core/view-pricing.ts";
import { resolveBookingOffer } from "../core/booking-ssr.ts";
import {
	type EntityArchetype,
	firstNameOf,
	inlineMetaFor,
	resolveArchetype,
	scopeHeadingFor,
	seatCapacityFor,
	showsCommercialRails,
	showsProductLedger,
	showsScheduler,
	showsStageLedger,
} from "../core/entity-archetype.ts";

/**
 * EntityViewPage — the polymorphic controller for `/view/[entity]` and `/[handle]/view/[item]`.
 *
 * It resolves the archetype ONCE (`resolveArchetype`) and renders one four-track frame for it:
 *
 *   nav strip · media column · hero · conversion lane
 *
 * # The lane is IN the page now
 *
 * It used to be resolved into the shell's navigation slot, which meant two different presentations of
 * one panel — a drag-resizable middle-nav lane on the page's start edge for a signed-in buyer, a
 * floating glass aside on the same edge for a guest. It is now the frame's END column for everyone,
 * so the transaction sits in one place regardless of who is looking at it, and `viewLaneFor` declines
 * the shell slot for every commerce archetype.
 *
 * # The canvas still carries no price and no purchase control on desktop (§D.7.3)
 *
 * The offer has exactly one home. An offer stated twice on one screen is an offer that can disagree
 * with itself, and a buyer who sees two prices has been given a reason to distrust both. Below the
 * frame breakpoint the lane is not rendered at all and the transaction is re-homed into
 * `EntityBuyBar` — moved, never duplicated (§D.7.4).
 *
 * # Where the media sits, and the one gate this deviates from
 *
 * §D.7.8 asks for a content-first canvas: structured information leading, media trailing, reversed in
 * the DOM. The requested layout puts the media column BEFORE the hero, which the letter of that rule
 * forbids. It is honoured where it does the work: the DOM order here is still nav → hero → media, and
 * the frame's `grid-template-areas` place the media in the earlier visual column. So a keyboard or
 * screen-reader user still reaches the title of the thing they are being asked to buy before a strip
 * of thumbnails, which is the consequence §D.7.8 exists to prevent; only the left-right assignment
 * differs, and grid placement — not `order`, and not `direction` — is what does it.
 *
 * Projects and articles keep their own bespoke templates (Decisions #43/#44): a brief being staffed
 * and an editorial read are not purchases, and folding them into a commerce controller would mean
 * rendering a body that has to suppress most of itself.
 */
export interface EntityViewPageProps {
	view: EntityView | undefined;
	ctx?: HrefContext;
	authed?: boolean;
	/** The acting viewer's chrome context, for resolving the booking offer server-side. */
	context?: UserContext;
	/** The request URL, carrying any developer simulation overlay. */
	url?: URL;
}

export function EntityViewPage(
	{ view, ctx = { scope: "explore" }, authed = false, context, url }: EntityViewPageProps,
): JSX.Element {
	if (!view) return <NotFound ctx={ctx} />;

	const archetype = resolveArchetype(view);

	// Non-commerce formats keep their bespoke templates.
	if (archetype === "project" && view.project) {
		return <ProjectViewScreen view={view} project={view.project} ctx={ctx} authed={authed} />;
	}
	if (archetype === "article" && view.article) {
		return <ArticleViewScreen view={view} article={view.article} ctx={ctx} authed={authed} />;
	}

	const { item, gallery, deliverables, moreByOwner, similar, reviews } = view;
	const meta = inlineMetaFor(view, archetype);
	const capacity = seatCapacityFor(view, archetype);
	const rating = item.rating?.asHelper ?? item.rating?.asClient ?? null;
	const price = headlinePriceFor(view);
	/*
	 * Availability is resolved SERVER-side for the first byte. It is the anonymous/masked projection
	 * (`scheduling` §Part 1.4): a public listing page discloses that a time is free, never who else is
	 * in it — the roster, join URL and per-occurrence earnings are withheld from every non-party.
	 */
	const schedule = showsScheduler(archetype) ? resolveSchedulePage(item.id).page : null;
	const offer = resolveBookingOffer(item.id, {
		context,
		handle: ctx.scope === "profile" ? ctx.handle : null,
		url,
	});
	const scheduled = showsScheduler(archetype);

	return (
		<div class="evp" data-archetype={archetype}>
			<ViewStyleAnchor />

			<div class="evp-frame" data-scheduled={scheduled ? "true" : undefined}>
				{
					/*
				  ---- The START strip: one control, and it is the way out ----

				  A thin rail carrying a single circular ghost affordance back to Explore (or to the
				  profile, in the profile-scoped namespace). It is a real anchor with a real href, so
				  middle-click and open-in-new-tab work, and its accessible name is the sentence the
				  visible glyph cannot say. Below `--bp-md` the strip collapses and the same link
				  renders inline at the top of the body — moved, not duplicated.
				*/
				}
				<div class="evp-navstrip">
					{
						/*
					  A portal `Tooltip`, never a native `title` (§B.8.5). The glyph says "back" but not
					  back to WHAT, and that differs by render context — Explore or the seller's profile.
					  `Tooltip` is a registered island, so it hydrates on its own here even though this
					  component is server-rendered.
					*/
					}
					<Tooltip content={backLabelFor(ctx)} placement="right">
						<a
							class="evp-navstrip__back"
							href={backHrefFor(ctx)}
							aria-label={backLabelFor(ctx)}
						>
							<Icon name="arrow-left" size="md" aria-hidden />
						</a>
					</Tooltip>
				</div>

				<a class="evp__back evp__back--laned" href={backHrefFor(ctx)}>
					<Icon name="arrow-left" size="sm" aria-hidden />
					<span>{backLabelFor(ctx)}</span>
				</a>

				{
					/*
				  ---- The HERO: the structured overview ----

				  It leads in the DOM and sits in the frame's third visual column; see the component
				  docblock for why those two are allowed to differ here and what keeps that safe.
				*/
				}
				<div class="evp-hero">
					<div class="evp-overview">
						<h1 class="evp-overview__title">{item.title}</h1>

						{
							/*
						  Metadata as ONE muted middot-separated line (§B.11.2). This replaced a row of up
						  to nine pills, none of which could be clicked — containment is a promise of
						  interactivity, and offering nine affordances that all refuse is worse than
						  offering none.
						*/
						}
						<MetaLine items={meta} />

						<p class="evp-overview__summary">{item.summary}</p>

						<SellerLine item={item} rating={rating} responseMinutes={view.responseMinutes} />

						{capacity && archetype === "cohort" && <SeatMeter capacity={capacity} />}
					</div>

					{/* Zero-UI sentinel driving the migrated sticky header (§D.7.6). */}
					<EntityHeroProbe />
				</div>

				{
					/*
				  ---- The MEDIA column ----

				  A session or a cohort has no media column at all: its artefact is the scheduler stage,
				  which needs the whole content width or the calendar engine drops its own mini-month and
				  availability panel — the only place the provider's working hours are explained.
				  `data-scheduled` collapses the media track for them and the hero takes the width.
				*/
				}
				{!scheduled && (
					<div class="evp-media">
						<EntityCanvas
							gallery={gallery}
							title={item.title}
							preview={view.product?.preview}
						/>
					</div>
				)}

				{
					/*
				  ---- The END column: the conversion lane ----

				  Rendered here rather than resolved into the shell, so both shells show one panel in one
				  place. It is `display: none` below `--bp-md`, where `EntityBuyBar` takes the duty.
				*/
				}
				{offer && (
					<aside class="evp-laneslot" aria-label={`Purchase ${item.title}`}>
						<EntityLane
							view={view}
							archetype={archetype}
							amount={price.amount}
							fallback={price.fallback}
							unit={price.unit}
							isFloor={price.isFloor}
							authed={authed}
							ctx={ctx}
							offer={offer}
							stages={view.service?.showcaseStages ? view.service.stages : undefined}
						/>
					</aside>
				)}

				<div class="evp-main">
					{
						/*
					  Session / cohort: the FULL-WIDTH booking stage (§D.8.3 / §D.8.4).
					*/
					}
					{scheduled && (
						<SessionSchedulerStage
							gallery={gallery}
							title={item.title}
							schedule={schedule}
							entityId={item.id}
							group={archetype === "cohort"}
							providerTimezone={schedule?.timezone ?? null}
						/>
					)}

					{
						/*
					  The ≤767px transactional block, and the booking overlay layer with it.

					  `offer` is the SAME object the lane receives, so the two regions describe one offer
					  rather than two independently-derived ones — §D.7.4's rule applied to the data and
					  not only to the layout. It is `null` only for an id that resolves to nothing, which
					  this branch has already returned for.
					*/
					}
					{offer && (
						<EntityBuyBar
							view={view}
							archetype={archetype}
							price={price}
							authed={authed}
							ctx={ctx}
							offer={offer}
						/>
					)}

					{/* ---- Archetype body ---- */}
					<ArchetypeBody view={view} archetype={archetype} deliverables={deliverables} />

					{/* ---- Commercial rails + reviews ---- */}
					{showsCommercialRails(archetype) && (
						<div class="evp-body">
							<RelatedSection
								title={`More by ${item.owner.name}`}
								subtitle={`More work from ${firstNameOf(item)}, grouped by type`}
								items={moreByOwner}
								ctx={ctx}
								authed={authed}
								seeAllHref={`/${item.owner.handle}`}
							/>
							<RelatedSection
								title="Similar & recommended"
								subtitle="Comparable options other clients considered"
								items={similar}
								ctx={ctx}
								authed={authed}
							/>
							{
								/*
							  The anchor the lane's review count links to. On the section rather than inside
							  the island, so the target exists in the first byte and a jump lands even if the
							  panel has not hydrated.
							*/
							}
							<div id="evp-reviews">
								<ReviewsPanel summary={reviews.summary} list={reviews.list} />
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// #region Archetype bodies
/**
 * The per-archetype evaluation body. Each branch is short on purpose: the shared primitives already
 * enforce the anti-card and anti-tag rules, so an archetype only has to say WHICH facts it shows and
 * in what order.
 */
function ArchetypeBody(
	{ view, archetype, deliverables }: {
		view: EntityView;
		archetype: EntityArchetype;
		deliverables: readonly string[];
	},
): JSX.Element | null {
	const heading = scopeHeadingFor(archetype);
	const currency = view.item.type === "services" || view.item.type === "products"
		? view.item.currency
		: undefined;

	// ---- Pipeline / One-Off: the continuous timeline track (§D.8.1 / §D.8.2) ----
	if (showsStageLedger(archetype, view)) {
		const stages = view.service!.stages;
		return (
			<>
				<Section title={heading}>
					<StageProgressLedger
						stages={stages}
						hideOrdinals={archetype === "one_off" && stages.length === 1}
						showSeats={false}
						currency={currency}
					/>
				</Section>
				{deliverables.length > 0 && (
					<Section title="Included in every engagement">
						<ScopeChecklist items={deliverables} />
					</Section>
				)}
				<TeamRoles view={view} />
			</>
		);
	}

	// ---- One-Off with no stage showcase: the unboxed scope checklist (§D.8.2) ----
	if (archetype === "one_off") {
		return (
			<>
				<Section title={heading}>
					<ScopeChecklist items={deliverables} />
				</Section>
				<TeamRoles view={view} />
			</>
		);
	}

	// ---- Session / Cohort (§D.8.3 / §D.8.4) ----
	if (showsScheduler(archetype)) {
		const capacity = seatCapacityFor(view, archetype);
		const rows = [];
		if (view.service?.bookingSummary) {
			rows.push({ label: "Format", value: view.service.bookingSummary });
		}
		if (view.item.type === "services") {
			rows.push({ label: "Delivery", value: view.item.delivery });
		}
		if (capacity) rows.push({ label: "Capacity", value: capacity.sentence });
		return (
			<>
				<Section title={heading}>
					{
						/*
					  The picker itself is the full-bleed `SessionSchedulerStage` above; this section
					  carries what a booker needs to KNOW rather than a second copy of the control.

					  The sentence here used to read "Times are shown in your local timezone", which was
					  FALSE as shipped — the engine renders one wall clock from one zone string and
					  `ScheduleView` feeds it the schedule's own `timezone`, the PROVIDER's. The honest
					  disclosure now sits on the stage, beside the grid it describes.
					*/
					}
					<p class="evp-prose">
						The provider's working hours, buffers and blackout dates are already applied, so every
						slot offered is a slot that can be booked. The calendar states which timezone it is
						drawn in, and your own when the two differ.
					</p>
					<SpecLedger rows={rows} />
				</Section>
				{deliverables.length > 0 && (
					<Section title="What the session covers">
						<ScopeChecklist items={deliverables} />
					</Section>
				)}
			</>
		);
	}

	// ---- Digital product: the specification ledger (§D.8.5) ----
	if (showsProductLedger(archetype, view)) {
		const p = view.product!;
		return (
			<>
				<Section title={heading}>
					<SpecLedger
						rows={[
							{
								label: "Files",
								value: `${p.files.length} files · ${p.payloadLabel} uncompressed`,
								emphasis: true,
							},
							...p.files.map((f) => ({
								label: f.extension,
								value: `${f.label} · ${f.sizeLabel}`,
							})),
						]}
					/>
				</Section>

				<Section title="Specifications">
					<SpecLedger
						rows={p.specs.map((s) => ({ label: s.label, value: s.value }))}
						columns
					/>
				</Section>

				{p.compatibility.length > 0 && (
					<Section title="Compatibility">
						<SpecLedger
							rows={p.compatibility.map((c) => ({ label: c.app, value: c.versions }))}
							columns
						/>
					</Section>
				)}

				<Section
					title="Licence"
					aside={<span>{p.licence.name}</span>}
				>
					<p class="evp-overview__summary">{p.licence.summary}</p>
					<PermissionLedger permissions={p.licence.permissions} />
				</Section>
			</>
		);
	}

	// ---- Fallback: whatever deliverables resolved ----
	if (deliverables.length > 0) {
		return (
			<Section title={heading}>
				<ScopeChecklist items={deliverables} />
			</Section>
		);
	}
	return null;
}

/** A Direct Deliverable's project-team roles. Skills are a middot line, never a tag cluster. */
function TeamRoles({ view }: { view: EntityView }): JSX.Element | null {
	const roles = view.service?.roles;
	if (!roles?.length) return null;
	return (
		<Section title="Project team">
			<SpecLedger
				rows={roles.map((role) => ({
					label: role.count > 1 ? `${role.name} ×${role.count}` : role.name,
					value: (
						<span class="evp-ledger__stack">
							<span>{role.summary}</span>
							<MetaLine items={role.skills.map((s) => s.label)} />
						</span>
					),
				}))}
			/>
		</Section>
	);
}
// #endregion

// #region Seller
/**
 * The seller line — avatar, name, one compact rating, then earned signals as TEXT LINKS (§B.11.4).
 *
 * The signals carry an explanation rather than a fill: six earned badges beside one lifecycle status
 * makes the status compete with them for the colour channel, and the status is the only one of the
 * seven whose colour means anything.
 *
 * They are derived by the SHARED `sellerBadges` rule, which the lane's identity band also calls.
 * Two thresholds for one badge is how a seller comes to read "Top rated" in the lane and unmarked
 * eighteen inches to its left, on the same screen.
 */
function SellerLine(
	{ item, rating, responseMinutes }: {
		item: EntityView["item"];
		rating: { value: number; count: number } | null;
		responseMinutes?: number;
	},
): JSX.Element {
	const signals: TrustSignal[] = sellerBadges(item, responseMinutes).map((badge) => ({
		label: badge.label,
		explanation: explainBadge(badge.id, item, rating, responseMinutes),
	}));

	return (
		<div class="evp-seller">
			<a class="evp-seller__link" href={`/${item.owner.handle}`}>
				<Avatar image={item.owner.avatar} label={item.owner.name} size="sm" />
				<span class="evp-seller__name">{item.owner.name}</span>
				{item.owner.verified && (
					<Icon name="verified" size="sm" filled class="evp-seller__crest" aria-label="Verified" />
				)}
			</a>
			{rating && <RatingStars value={rating.value} count={rating.count} compact size="sm" />}
			<TrustSignals signals={signals} />
		</div>
	);
}

/**
 * Why a badge was earned, in one sentence, from the datum that earned it.
 *
 * Never a generic gloss: "Top rated" with no numbers is marketing, and the numbers are the only part
 * a reader can check.
 */
function explainBadge(
	id: string,
	item: EntityView["item"],
	rating: { value: number; count: number } | null,
	responseMinutes?: number,
): string {
	if (id === "fast-replies") {
		const minutes = responseMinutes ??
			("responseMinutes" in item ? item.responseMinutes : undefined);
		return typeof minutes === "number"
			? `Typically replies within ${minutes} minutes — a measured median, not an estimate.`
			: "Replies faster than most sellers on the platform.";
	}
	return rating
		? `${rating.value.toFixed(1)} average across ${rating.count} completed engagements.`
		: "Rated well across completed engagements.";
}
// #endregion

// #region Not found
/**
 * The unresolved-id branch. `ViewStyleAnchor` is REQUIRED here, not decorative: every app-local sheet
 * on this surface is delivered by an island, and this branch mounts none of the others — so without
 * it the one state that most needs a working next action would ship with zero rules in the CSSOM for
 * its own call to action.
 */
function NotFound({ ctx }: { ctx: HrefContext }): JSX.Element {
	return (
		<div class="evp evp--empty">
			<ViewStyleAnchor />
			<a class="evp__back" href={backHrefFor(ctx)}>
				<Icon name="arrow-left" size="sm" aria-hidden />
				<span>{backLabelFor(ctx)}</span>
			</a>
			<EmptyState
				title="Item not found"
				description="This item may have been removed, or the link is out of date. Explore live work to find something similar."
				actions={
					<a
						class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded"
						href="/explore"
					>
						<span class="ui-button__label">Explore Projective</span>
					</a>
				}
			/>
		</div>
	);
}
// #endregion
