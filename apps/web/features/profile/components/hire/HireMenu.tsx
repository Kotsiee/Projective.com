import type { JSX } from "preact";
import { RatingStars } from "@projective/ui/display";
import { ProgressiveImage } from "@projective/ui/display/image";
import { MoneyView } from "@projective/ui/display/money";
import { Icon } from "@projective/ui/icons";
import type { PublicCallOffer } from "@projective/types/scheduling";
import { serviceStartingPrice } from "@features/explore/core/pricing.ts";
import { consultationPriceLabel } from "../../core/profile-model.ts";
import type { ServiceItem } from "../../types/profile-types.ts";

/**
 * HireMenu — the contents of the hero's **Hire** popover: the seller's listings as compact rows
 * (thumbnail · title · starting price · rating), and — when the seller takes discovery calls — a
 * "Book consultation" row in the footer carrying its price or the word Free.
 *
 * Every row is a BUTTON, not a link: picking a listing opens the service modal in place (the
 * `/view` page is a click away inside it), and picking the consultation opens the booking modal.
 * A popover that navigated would be a menu of links wearing a menu's chrome.
 *
 * The starting price is `serviceStartingPrice` — the SAME rule the Services row's cards and the
 * `/view` page's lane print — rendered through `MoneyView` so it follows the header's currency
 * switch. A pipeline shows its floor as "From"; the range belongs on the page (Decision #76).
 *
 * Kept dumb: the hero owns the popover, the modals and the state. This is a list of choices.
 */
export interface HireMenuProps {
	services: readonly ServiceItem[];
	/** The seller's call offer, or `null` when they take none (the row is then absent). */
	consultation: PublicCallOffer | null;
	sellerName: string;
	onPickService: (service: ServiceItem) => void;
	onPickConsultation: () => void;
}

export function HireMenu(
	{ services, consultation, sellerName, onPickService, onPickConsultation }: HireMenuProps,
): JSX.Element {
	const consultLabel = consultationPriceLabel(consultation);
	return (
		<div class="pf-hiremenu">
			<p class="pf-hiremenu__lead">Hire {sellerName} for</p>
			{services.length === 0
				? <p class="pf-hiremenu__empty">No listings yet.</p>
				: (
					<ul class="pf-hiremenu__list" role="list">
						{services.map((service) => {
							const price = serviceStartingPrice(service);
							const rating = service.rating?.asHelper ?? service.rating?.asClient ?? null;
							return (
								<li key={service.id}>
									<button
										type="button"
										class="pf-hiremenu__item"
										aria-haspopup="dialog"
										onClick={() => onPickService(service)}
									>
										<span class="pf-hiremenu__thumb" aria-hidden="true">
											<ProgressiveImage
												src={service.media}
												placeholder={service.mediaPlaceholder}
												loading="lazy"
											/>
										</span>
										<span class="pf-hiremenu__text">
											<span class="pf-hiremenu__title">{service.title}</span>
											<span class="pf-hiremenu__meta">
												{price.amount
													? (
														<span class="pf-hiremenu__price">
															{price.isFloor && <span class="pf-hiremenu__from">From</span>}{" "}
															<MoneyView
																minor={price.amount.minor}
																currency={price.amount.currency}
																size="micro"
																hideOrigin
															/>
															{price.unit && <span class="pf-hiremenu__unit">/ {price.unit}</span>}
														</span>
													)
													: <span class="pf-hiremenu__price">{price.fallback}</span>}
												{rating && (
													<span class="pf-hiremenu__rating">
														<RatingStars
															value={rating.value}
															count={rating.count}
															compact
															size="sm"
														/>
													</span>
												)}
											</span>
										</span>
										<Icon name="chevron-right" size="xs" class="pf-hiremenu__chev" aria-hidden />
									</button>
								</li>
							);
						})}
					</ul>
				)}
			{consultation && consultLabel && (
				<button
					type="button"
					class="pf-hiremenu__consult"
					aria-haspopup="dialog"
					onClick={onPickConsultation}
				>
					<Icon name="video-camera" size="sm" aria-hidden />
					<span class="pf-hiremenu__consult-text">
						<span class="pf-hiremenu__consult-title">Book consultation</span>
						<span class="pf-hiremenu__consult-meta">
							{consultation.courtesyEnabled
								? `${consultation.courtesyDurationMinutes} min intro call`
								: `${consultation.paidDurationMinutes} min consultation`}
						</span>
					</span>
					<span class="pf-hiremenu__consult-price">{consultLabel}</span>
				</button>
			)}
		</div>
	);
}
