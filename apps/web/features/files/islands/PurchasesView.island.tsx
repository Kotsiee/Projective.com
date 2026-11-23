import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/files-hub.css";
import "../styles/files-purchases.css";
import { MetaLine, Tag } from "@projective/ui/display";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { Purchase } from "@projective/types/catalogue";
import {
	type DevDelivery,
	type DevEntitlement,
	readDevSeam,
	subscribeDevSeam,
} from "@web/utils/dev-seam.ts";
import { folderHref } from "../core/asset-model.ts";
import { filesNavigate } from "../core/files-state.ts";

/**
 * PurchasesView — what the acting account has bought, on `/files?source=purchases` (Decision #488;
 * ASSET_DELIVERY_ARCHITECTURE.md §14 Phase 0).
 *
 * Every entitlement the account holds, newest first, each file with its own Download: a same-origin
 * link to `/api/downloads/ent-…/{fileId}`, which streams the file after its own gate. A refunded or
 * withdrawn purchase stays listed, marked as such, with its files no longer offered; a purchase whose
 * files are still being copied in after publishing says so instead of offering a link that 503s.
 * `&entitlement=ent-…` stands the page on one purchase (the confirmation's "Open in Purchases"). A
 * person's purchase delivered at least once links its review (`reviewHref`, `&review=ent-…`), which
 * the route answers with the review dialog over this view (Decision #487 RV1).
 *
 * It renders in the library body's own box (`.fh-hub`), under the same lane, so the page reads as a
 * location of `/files`. The lane's rows navigate through {@link filesNavigate}, which the library
 * body owns; here no body is mounted, so this view registers a navigator that leaves for the library
 * by a full page load.
 *
 * The Dev Context Switcher's `delivery` and `entitlement` axes redraw the purchases (ready · preparing
 * · failed; active · refunded · none bought). Display only: a Download still asks the real route.
 *
 * Dumb island: the purchases arrive as props, resolved server-side by the route.
 */

// #region Props
export interface PurchasesViewProps {
	purchases: Purchase[];
	/** A read that failed, in the reader's words; the list is then empty. */
	error: string | null;
	/** The purchase `&entitlement=` names, if any. */
	focus: string | null;
}
// #endregion

// #region Formatting
const LICENCE_LABEL: Record<Purchase["licence"], string> = {
	personal: "Personal licence",
	commercial: "Commercial licence",
	extended: "Extended licence",
};

function sizeLabel(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function dateLabel(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ""
		: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
// #endregion

// #region Simulation
/** A purchase as the Dev Context Switcher redraws it; the real one when both axes are `auto`. */
function simulated(
	purchase: Purchase,
	delivery: DevDelivery | undefined,
	entitlement: DevEntitlement | undefined,
): Purchase & { failed: boolean } {
	const status = entitlement === "refunded"
		? "refunded"
		: entitlement === "active"
		? "active"
		: purchase.status;
	const state = delivery === "ready"
		? "ready"
		: delivery === "rendering" || delivery === "failed"
		? "preparing"
		: purchase.delivery;
	const live = status === "active" && state === "ready";
	return {
		...purchase,
		status,
		delivery: purchase.files.length === 0 ? "none" : state,
		files: purchase.files.map((f) => ({
			...f,
			href: live ? (f.href ?? `/api/downloads/${purchase.slug}/${f.fileId}`) : null,
		})),
		failed: delivery === "failed",
	};
}
// #endregion

/** The purchases view. */
export default function PurchasesView(props: PurchasesViewProps): JSX.Element {
	const seam = readDevSeam();
	const delivery = useSignal<DevDelivery | undefined>(seam?.delivery);
	const entitlement = useSignal<DevEntitlement | undefined>(seam?.entitlement);

	useEffect(() => {
		const stop = subscribeDevSeam((s) => {
			delivery.value = s?.delivery;
			entitlement.value = s?.entitlement;
		});
		// The lane moves through the library body's navigator; with no body here, it leaves by a load.
		filesNavigate.value = {
			toPath: (path: string[]) => globalThis.location.assign(folderHref("/files", path)),
			toHref: (href: string) => globalThis.location.assign(href),
		};
		if (props.focus) document.getElementById(props.focus)?.scrollIntoView({ block: "start" });
		return () => {
			stop();
			filesNavigate.value = null;
		};
	}, []);

	const shown = useComputed(() =>
		entitlement.value === "none"
			? []
			: props.purchases.map((p) => simulated(p, delivery.value, entitlement.value))
	);
	const count = shown.value.length;

	return (
		<div class="fh-hub fh-purchases">
			<header class="fh-purchases__head">
				<h1 class="fh-purchases__title">Purchases</h1>
				<MetaLine
					items={[
						{ text: count === 1 ? "1 purchase" : `${count} purchases`, tabular: true },
						count > 0 && "Newest first",
					]}
				/>
			</header>

			{props.error && <InlineNotice text={props.error} />}

			{!props.error && count === 0
				? (
					<div class="fh-purchases__empty">
						<p class="fh-purchases__note">
							Nothing bought yet. Templates, kits and assets you buy appear here, ready to download.
						</p>
						<a
							class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
							href="/explore"
						>
							Browse the marketplace
						</a>
					</div>
				)
				: (
					<ol class="fh-purchases__list" aria-label="Your purchases">
						{shown.value.map((p) => (
							<li key={p.slug} id={p.slug} class="fh-purchases__item">
								<div class="fh-purchases__itemhead">
									<h2 class="fh-purchases__name">{p.title}</h2>
									{p.status !== "active" && (
										<Tag
											severity="secondary"
											value={p.status === "refunded" ? "Refunded" : "Withdrawn"}
										/>
									)}
								</div>
								<MetaLine
									items={[
										p.orderReference && { text: p.orderReference, tabular: true },
										dateLabel(p.purchasedAt),
										LICENCE_LABEL[p.licence],
										p.seats > 1 && { text: `${p.seats} seats`, tabular: true },
										p.version !== null && { text: `Version ${p.version}`, tabular: true },
									]}
								/>

								{p.status !== "active"
									? (
										<p class="fh-purchases__note">
											{p.status === "refunded"
												? "This purchase was refunded, so its files are no longer available."
												: "Access to this purchase was withdrawn, so its files are no longer available."}
										</p>
									)
									: p.delivery === "none"
									? (
										<p class="fh-purchases__note">
											This product came with no files to download. Message the seller if you
											expected some.
										</p>
									)
									: p.delivery === "preparing"
									? (
										<InlineNotice
											text={p.failed
												? "We couldn't prepare these files just now. We'll try again when you next download them."
												: "Your files are being prepared. They'll be ready to download in a moment."}
										/>
									)
									: null}

								{p.files.length > 0 && (
									<ul class="fh-purchases__files" aria-label={`Files in ${p.title}`}>
										{p.files.map((f) => (
											<li key={f.fileId} class="fh-purchases__file">
												<span class="fh-purchases__filetext">
													<span class="fh-purchases__filename">{f.name}</span>
													<MetaLine
														as="span"
														size="xs"
														items={[f.label, { text: sizeLabel(f.bytes), tabular: true }]}
													/>
												</span>
												{f.href && (
													<a
														class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
														href={f.href}
														download={f.name}
														aria-label={`Download ${f.name}`}
													>
														<Icon name="download" />
														<span>Download</span>
													</a>
												)}
											</li>
										))}
									</ul>
								)}

								{p.status === "active" && p.reviewHref && (
									<a
										class="fh-purchases__review"
										href={p.reviewHref}
										aria-label={`Review ${p.title}`}
									>
										Review this product
									</a>
								)}
							</li>
						))}
					</ol>
				)}
		</div>
	);
}
