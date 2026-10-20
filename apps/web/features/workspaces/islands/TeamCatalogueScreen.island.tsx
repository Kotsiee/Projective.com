import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/workspace.css";
import "@features/catalogue/styles/listing-card.css";
import { InputText, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { CataloguePage } from "@projective/types/catalogue";
import { ListingCard } from "@features/catalogue/components/ListingCard.tsx";
import { ContextSwitchControl } from "../components/ContextSwitchControl.tsx";
import { useModuleCommit } from "../hooks/useModuleCommit.ts";
import {
	CATALOGUE_HREF,
	catalogueCommit,
	type CatalogueStatusFilter,
	filterTeamListings,
	matchLabel,
	NEW_LISTING_HREF,
	statusFilterOptions,
	teamCatalogueView,
	teamListingHref,
} from "../core/catalogue-module-model.ts";

/**
 * TeamCatalogueScreen — a team console's Catalogue module, `/teams/:teamHandle/catalogue` (Decision
 * #308): the team's listings as the catalogue's own `ListingCard`s, narrowed in place by status and by
 * a title search.
 *
 * The listings are read server-side by the `[module]` route (`resolveTeamCatalogue`), scoped to THIS
 * team rather than to the viewer's acting context, so a member sees the team's catalogue wherever they
 * are acting from. The console's lane, header band and footer rig keep their slots, so this is the
 * catalogue console's body only — no catalogue lane, no batch bar, no selection. The cards are drawn
 * read-only; a listing is edited on its own `/catalogue/[slug]` workspace and created through the
 * catalogue's Quick-Init (`/catalogue?create=1`) — the header band's one filled commit, New listing,
 * published through `useModuleCommit`.
 *
 * Both of those resolve the seller from the session's ACTING context, so they are offered only to a
 * member acting as the team. Anyone else reads the listings (published ones link to their public page)
 * and is offered the switch — the console's own `ContextSwitchControl` — with a sentence saying why
 * (`catalogue-module-model.ts`).
 */

// #region Props
export interface TeamCatalogueScreenProps {
	/** The team's row id — what the acting switch binds to. */
	teamId: string;
	handle: string;
	name: string;
	/** Whether the session is acting as this team (`WorkspaceDetail.isActing`). */
	acting: boolean;
	/** The team's listings, or `null` when they could not be read. */
	initial: CataloguePage | null;
	/** Why they could not be read. */
	initialError: string | null;
}
// #endregion

export default function TeamCatalogueScreen(props: TeamCatalogueScreenProps): JSX.Element {
	const view = teamCatalogueView(props);
	const status = useSignal<CatalogueStatusFilter>("all");
	const search = useSignal("");
	const page = props.initial;
	const items = page
		? filterTeamListings(page.items, { status: status.value, search: search.value })
		: [];

	// The header band's one filled action: "New listing" (tier 2 structural), only while acting as the
	// team — the create modal files a listing under the acting seller.
	useModuleCommit(() => {
		const commit = catalogueCommit(props.acting);
		return commit ? { ...commit, run: () => globalThis.location.assign(NEW_LISTING_HREF) } : null;
	});

	return (
		<div class="wsp" data-kind="team">
			<div class="wsp__stack">
				<section class="wsp-band wsp-band--head" aria-label={`${props.name}'s catalogue`}>
					<div class="wsp-band__inner">
						<div class="wsp-pagehead">
							{props.acting
								? (
									<a
										class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
										href={CATALOGUE_HREF}
									>
										<span class="ui-button__label">Open the catalogue</span>
									</a>
								)
								: (
									<ContextSwitchControl
										kind="team"
										id={props.teamId}
										name={props.name}
										handle={props.handle}
										acting={false}
										destination={`/teams/${props.handle}/catalogue`}
									/>
								)}
						</div>
						{view.actingNote ? <p class="wsp-pagehead__note">{view.actingNote}</p> : null}
					</div>
				</section>
				<section
					class="wsp-band wsp-band--plain wsp-band--tail"
					aria-label={`${props.name}'s listings`}
				>
					<div class="wsp-band__inner">
						{!page
							? (
								<p class="wsp-catalogue__empty" role="alert">
									{props.initialError ?? `${props.name}'s listings couldn't be read just now.`}
								</p>
							)
							: page.items.length === 0
							? <p class="wsp-catalogue__empty" role="status">{view.emptyNote}</p>
							: (
								<>
									<div
										class="wsp-catalogue__controls"
										role="group"
										aria-label="Narrow the listings"
									>
										<Select
											class="wsp-catalogue__status"
											size="sm"
											aria-label="Listing status"
											options={statusFilterOptions(page.statusCounts, status.value)}
											value={status.value}
											onValueChange={(value) => {
												status.value = value as CatalogueStatusFilter;
											}}
										/>
										<div class="wsp-catalogue__search">
											<InputText
												value={search}
												onValueChange={(value) => {
													search.value = value;
												}}
												placeholder="Search listings"
												type="search"
												size="sm"
												block
												aria-label="Search listings"
												start={<Icon name="search" />}
											/>
										</div>
										<span class="wsp-catalogue__count" aria-live="polite">
											{matchLabel(items.length, page.items.length)}
										</span>
									</div>
									{items.length === 0
										? <p class="wsp-catalogue__empty" role="status">{view.noMatchNote}</p>
										: (
											<ul class="cat-grid wsp-catalogue__grid">
												{items.map((listing) => (
													<li key={listing.id} class="wsp-catalogue__item">
														<ListingCard
															listing={listing}
															href={teamListingHref(listing, props.acting)}
															selected={false}
															selecting={false}
															onSelect={() => {}}
															onAction={() => {}}
															readOnly
														/>
													</li>
												))}
											</ul>
										)}
								</>
							)}
					</div>
				</section>
			</div>
		</div>
	);
}
