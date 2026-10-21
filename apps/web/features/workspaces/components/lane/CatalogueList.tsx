import type { ComponentChildren, JSX } from "preact";
import "@web/features/projects/styles/project-sidebar.css";
import { Icon } from "@projective/ui/icons";
import { Skeleton } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { PlusIcon } from "@web/features/projects/components/glyphs.tsx";
import { openCreate, startConsoleSync } from "@features/catalogue/core/console-store.ts";
import { type LaneCatalogueZone, laneListingRows } from "../../core/lane-model.ts";
import type { LaneListingsState } from "../../hooks/useLaneListings.ts";

const SKELETON_WIDTHS = ["72%", "56%", "64%"] as const;

/**
 * CatalogueList — the team's listings under the lane's Catalogue section (Decision #316), drawn as
 * {@link ChannelList} draws channels — the project lane's `.proj-chan` rows: the cover (else the
 * kind's glyph), the title, the lifecycle word while the listing is not live, and a dot while it needs
 * attention; the listing being rendered is marked. A read in flight draws placeholder rows, an empty
 * catalogue offers New listing, and a failed read says so with Try again — never an empty catalogue.
 */
export function CatalogueList(
	props: { state: LaneListingsState; zone: LaneCatalogueZone; onRetry: () => void },
): JSX.Element | null {
	const { state, zone } = props;

	if (state.phase === "idle") return null;
	if (state.phase === "loading") {
		return (
			<div class="wsp-lane__catload" role="status">
				<span class="ui-visually-hidden">Loading listings…</span>
				{SKELETON_WIDTHS.map((width) => (
					<span key={width} class="proj-chan wsp-lane__catskel" aria-hidden="true">
						<Skeleton shape="circle" width="1em" />
						<Skeleton shape="text" width={width} height="1em" />
					</span>
				))}
			</div>
		);
	}

	if (!state.read.ok) {
		return (
			<div class="wsp-lane__catfail">
				<p class="proj-chan-empty" role="status">{state.read.message}</p>
				<Button variant="text" size="sm" label="Try again" onClick={props.onRetry} />
			</div>
		);
	}

	const { rows, more } = laneListingRows(state.read.listings, zone);
	if (rows.length === 0) {
		return (
			<>
				<p class="proj-chan-empty">No listings yet.</p>
				{zone.canCreate && (
					<CreateControl zone={zone} class="proj-chan wsp-lane__catcreate">
						<span class="proj-chan__glyph" aria-hidden="true">{PlusIcon}</span>
						<span class="proj-chan__name">{zone.createLabel}</span>
					</CreateControl>
				)}
			</>
		);
	}

	return (
		<>
			{rows.map((row) => (
				<a
					key={row.id}
					class="proj-chan"
					href={row.href}
					data-active={row.active ? "true" : undefined}
					aria-current={row.active ? "page" : undefined}
				>
					<span class="proj-chan__glyph" aria-hidden="true">
						{row.cover
							? (
								<img
									class="wsp-chanmark__photo"
									src={row.cover}
									alt=""
									loading="lazy"
									decoding="async"
								/>
							)
							: <Icon name={row.kind === "service" ? "service" : "box"} />}
					</span>
					<span class="proj-chan__name">
						{row.title}
						{row.state && <span class="ui-visually-hidden">, {row.state.toLowerCase()}</span>}
					</span>
					{row.state && <span class="proj-chan__sub" aria-hidden="true">{row.state}</span>}
					{row.needsAttention && (
						<span class="proj-chan__dot" role="status" aria-label="Needs attention" />
					)}
				</a>
			))}
			{more && (
				<a class="proj-chan wsp-lane__catmore" href={more.href}>
					<span class="proj-chan__name">{more.label}</span>
				</a>
			)}
		</>
	);
}

/**
 * The Catalogue section's add control — the Channels section's "＋" (`.proj-chan-group__plus`),
 * opening the create modal in place on the console and linking to it everywhere else.
 */
export function CatalogueAddButton(props: { zone: LaneCatalogueZone }): JSX.Element {
	return (
		<CreateControl zone={props.zone} class="proj-chan-group__plus" label={props.zone.createLabel}>
			{PlusIcon}
		</CreateControl>
	);
}

function CreateControl(
	props: {
		zone: LaneCatalogueZone;
		class: string;
		label?: string;
		children: ComponentChildren;
	},
): JSX.Element {
	if (!props.zone.createInPlace) {
		return (
			<a class={props.class} href={props.zone.createHref} aria-label={props.label}>
				{props.children}
			</a>
		);
	}
	return (
		<button
			type="button"
			class={props.class}
			aria-label={props.label}
			aria-haspopup="dialog"
			onClick={() => {
				startConsoleSync();
				openCreate();
			}}
		>
			{props.children}
		</button>
	);
}
