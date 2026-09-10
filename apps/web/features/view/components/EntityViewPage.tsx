import type { JSX } from "preact";
import { EmptyState } from "@projective/ui/utils";
import { Icon } from "@projective/ui/icons";
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
import ProjectLane from "../islands/ProjectLane.island.tsx";
import ProjectApplyBar from "../islands/ProjectApplyBar.island.tsx";
import SessionSchedulerStage from "../islands/SessionSchedulerStage.island.tsx";
import EntityHeroProbe from "../islands/EntityHeroProbe.island.tsx";
import ReviewsPanel from "../islands/ReviewsPanel.island.tsx";
import ViewStyleAnchor from "../islands/ViewStyleAnchor.island.tsx";
import { RelatedSection } from "./RelatedRail.tsx";
import { ArticleViewScreen } from "./ArticleViewScreen.tsx";
import { StageProgressLedger } from "./StageProgressLedger.tsx";
import { ProjectBody, ProjectHero } from "./project-view-parts.tsx";
import {
	MetaLine,
	PermissionLedger,
	ScopeChecklist,
	SeatMeter,
	Section,
	SellerLine,
	SpecLedger,
} from "./entity-view-parts.tsx";
import { backHrefFor, backLabelFor } from "../core/view-model.ts";
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
 * # One frame, six bodies
 *
 * Every commerce archetype AND a project render through this frame. A project used to have its
 * own template — a profile-page banner as a hero, boxed stage cards, a lane resolved into the
 * SHELL's navigation slot — so the two pages a reader most often opens back to back were two
 * design systems. Now a project is one more branch of this controller: it has no media column, so
 * its hero spans the two content tracks (the same shape a session's scheduler stage takes), its
 * lane is `ProjectLane` in the frame's END column, and its body is composed from the same unboxed
 * primitives as everything else. What differs between a brief and a service is the DATA each shows;
 * the containers, registers, rhythm and gates are shared.
 *
 * # The Gutenberg reading gravity
 *
 * The frame is read top-left to bottom-right: the hero's title and identifiers are the primary
 * optical area (leading the DOM, and top-left wherever no media column precedes it); the lane's
 * identity band and price are the strong follow area at the top-right; the archetype body is the
 * weak follow through the centre; and the lane's PINNED footer carries the CTA as the terminal
 * area at the bottom-right — on screen at the moment the reader decides, not at the moment they
 * happen to have scrolled back to the top.
 *
 * # The lane is IN the page
 *
 * It used to be resolved into the shell's navigation slot, which meant two different presentations
 * of one panel — a drag-resizable middle-nav lane on the page's start edge for a signed-in buyer, a
 * floating glass aside on the same edge for a guest. It is now the frame's END column for everyone,
 * so the transaction sits in one place regardless of who is looking at it, and `viewLaneFor`
 * declines the shell slot for every archetype but an article.
 *
 * # The canvas still carries no price and no purchase control on desktop (§D.7.3)
 *
 * The offer has exactly one home. An offer stated twice on one screen is an offer that can disagree
 * with itself, and a buyer who sees two prices has been given a reason to distrust both. Below the
 * frame breakpoint the lane is not rendered at all and the transaction is re-homed into the
 * archetype's body-side block — moved, never duplicated (§D.7.4).
 *
 * # Where the media sits, and the one gate this deviates from
 *
 * §D.7.8 asks for a content-first canvas: structured information leading, media trailing, reversed
 * in the DOM. The requested layout puts the media column BEFORE the hero, which the letter of that
 * rule forbids. It is honoured where it does the work: the DOM order here is still nav → hero → media,
 * and the frame's `grid-template-areas` place the media in the earlier visual column. So a keyboard
 * or screen-reader user still reaches the title of the thing they are being asked to buy before a
 * strip of thumbnails, which is the consequence §D.7.8 exists to prevent; only the left-right
 * assignment differs, and grid placement — not `order`, and not `direction` — is what does it.
 *
 * Articles keep their own editorial template (Decision #43): an editorial read is not a purchase,
 * and its lane is a table of contents rather than a transaction.
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

	// The one non-frame format: an editorial read owns its own reading measure and TOC lane.
	if (archetype === "article" && view.article) {
		return <ArticleViewScreen view={view} article={view.article} ctx={ctx} authed={authed} />;
	}

	const { item, gallery, deliverables, moreByOwner, similar, reviews } = view;
	const project = archetype === "project" ? view.project : undefined;
	const isProject = !!project;
	const meta = inlineMetaFor(view, archetype);
	const capacity = seatCapacityFor(view, archetype);
	const rating = item.rating?.asHelper ?? item.rating?.asClient ?? null;
	const price = headlinePriceFor(view);
	/*
	 * Availability is resolved SERVER-side for the first byte. It is the anonymous/masked projection
	 * (`scheduling` §Part 1.4): a public listing page discloses that a time is free, never who else is
	 * in it — the roster, join URL and per-occurrence earnings are withheld from every non-party.
	 */
	const scheduled = showsScheduler(archetype);
	const schedule = scheduled ? resolveSchedulePage(item.id).page : null;
	// A project is applied to, never booked or bought, so it resolves no booking offer at all.
	const offer = isProject ? null : resolveBookingOffer(item.id, {
		context,
		handle: ctx.scope === "profile" ? ctx.handle : null,
		url,
	});
	/*
	 * A frame with no media column: the hero takes both content tracks. A session's artefact is the
	 * full-width scheduler stage, and a project has no gallery at all — its identity is the client's
	 * banner strip inside the hero.
	 */
	const noMedia = scheduled || isProject;

	return (
		<div class="evp" data-archetype={archetype}>
			<ViewStyleAnchor />

			<div class={noMedia ? "evp-frame evp-frame--nomedia" : "evp-frame"}>
				{
					/*
				  ---- The START strip: one control, and it is the way out ----

				  A thin rail carrying a single circular ghost affordance back to Explore (or to the
				  profile, in the profile-scoped namespace). It is a real anchor with a real href, so
				  middle-click and open-in-new-tab work, and its accessible name is the sentence the
				  visible glyph cannot say. Below the frame breakpoint the strip collapses and the same
				  link renders inline at the top of the body — moved, not duplicated.
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
					{project ? <ProjectHero view={view} project={project} /> : (
						<div class="evp-overview">
							<h1 class="evp-overview__title">{item.title}</h1>

							{
								/*
								  Metadata as ONE muted middot-separated line (§B.11.2). This replaced a row
								  of up to nine pills, none of which could be clicked — containment is a
								  promise of interactivity, and offering nine affordances that all refuse is
								  worse than offering none.
								*/
							}
							<MetaLine items={meta} />

							<p class="evp-overview__summary">{item.summary}</p>

							<SellerLine
								item={item}
								rating={rating}
								responseMinutes={view.responseMinutes}
							/>

							{capacity && archetype === "cohort" && <SeatMeter capacity={capacity} />}
						</div>
					)}

					{/* Zero-UI sentinel driving the migrated sticky header (§D.7.6). */}
					<EntityHeroProbe />
				</div>

				{
					/*
				  ---- The MEDIA column ----

				  A session or a cohort has no media column at all: its artefact is the scheduler stage,
				  which needs the whole content width or the calendar engine drops its own mini-month and
				  availability panel — the only place the provider's working hours are explained. A
				  project has none either. `--nomedia` collapses the track for them and the hero takes
				  the width.
				*/
				}
				{!noMedia && (
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
				  place. It is `display: none` below the frame breakpoint, where the archetype's
				  body-side block takes the duty.
				*/
				}
				{project && (
					<aside class="evp-laneslot" aria-label={`Apply to ${item.title}`}>
						<ProjectLane view={view} project={project} authed={authed} ctx={ctx} />
					</aside>
				)}
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
					  The below-breakpoint transactional block, and the booking overlay layer with it.

					  `offer` is the SAME object the lane receives, so the two regions describe one offer
					  rather than two independently-derived ones — §D.7.4's rule applied to the data and
					  not only to the layout. It is `null` only for an id that resolves to nothing, which
					  this branch has already returned for.
					*/
					}
					{project && <ProjectApplyBar view={view} project={project} authed={authed} ctx={ctx} />}
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
					{project
						? <ProjectBody view={view} project={project} />
						: <ArchetypeBody view={view} archetype={archetype} deliverables={deliverables} />}

					{/* ---- Commercial rails ---- */}
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
						</div>
					)}
				</div>
			</div>

			{
				/*
			  ---- Reviews: OUTSIDE the frame, and that placement is doing two jobs ----

			  It is a sibling of `.evp-frame`, not a row inside it, so the review list gets the page's
			  whole content width instead of the ~876px `main` is left with after the conversion lane.

			  It is also what bounds the lane. A sticky box is constrained by its containing block, and
			  MEASURED in Chrome that is the grid CONTAINER's content box for a grid item — not the item's
			  own grid area, which is what a `"reviews reviews reviews reviews"` row was tried first and
			  found not to do (the lane rode 386px past its own area's foot). Ending the frame where the
			  reviews begin makes the constraint and the intent the same edge, so the lane comes to rest on
			  the reviews' top with no scroll listener, no sentinel and nothing to keep in sync.

			  `.evp` is a flex column gapped at `--evp-gap-section`, which is the same 48px step this
			  boundary carried while the reviews were the last child of `.evp-body` — the rhythm is
			  preserved by the new context rather than reconstructed on top of it.

			  The `id` stays on this wrapper: it is what the lane's review count and the sticky header's
			  rating both jump to (`scrollToId`), and it has to exist in the first byte so the jump lands
			  whether or not the panel has hydrated.

			  A project renders no reviews and no cross-sell (Decision #44): a brief being staffed is
			  not being cross-sold.
			*/
			}
			{showsCommercialRails(archetype) && (
				<div class="evp-reviewsrow" id="evp-reviews">
					<ReviewsPanel summary={reviews.summary} list={reviews.list} />
				</div>
			)}
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
