import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { MetaLine } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import type { SellerPromoCode } from "@projective/types/finance";
import "../../styles/promotions.css";
import {
	archivedLabel,
	expiryLabel,
	perAccountLabel,
	percentLabel,
	redeemedLabel,
	scopeLabel,
	splitCodes,
} from "../../core/promotions-model.ts";
import {
	loadPromotions,
	promotions,
	promotionsError,
	promotionsLoading,
} from "../../core/promotions-store.ts";
import { setConsoleUrl } from "../../core/console-store.ts";
import { PromoCodeDialog } from "./PromoCodeDialog.tsx";
import { ArchivePromoDialog } from "./ArchivePromoDialog.tsx";

/** Props for {@link PromotionsCanvas}. */
export interface PromotionsCanvasProps {
	/** The currency a fixed-amount code starts in: the seller's display currency. */
	defaultCurrency: string;
}

/**
 * PromotionsCanvas — the console's Promotions view (`/catalogue?view=promotions`, MARKETPLACE CK2,
 * Decision #485): the acting seller's promo codes, live then archived, each row its code and name over
 * one MetaLine of facts (discount · n of m redeemed · expiry · scope · per account), with Archive on a
 * live one; New code issues one. A seller's code discounts only their own products and they fund it,
 * which the lede says before the first press. The dialogs are the address's (`?promo=`), so one opens at
 * a time and a reload lands on it.
 */
export function PromotionsCanvas(props: PromotionsCanvasProps): JSX.Element {
	useEffect(() => {
		void loadPromotions();
	}, []);

	const data = promotions.value;
	const { live, archived } = splitCodes(data?.codes ?? []);
	const now = Date.now();

	return (
		<div class="cat-promo" aria-busy={promotionsLoading.value}>
			<div class="cat-promo__head">
				<div class="cat-promo__intro">
					<h2 class="cat-promo__title">Promo codes</h2>
					<p class="cat-promo__lede">
						A code takes money off your own products only, never anyone else's in the same basket.
						You fund the discount: your commission is taken on the price after it.
					</p>
				</div>
				<Button label="New code" size="sm" onClick={() => setConsoleUrl({ promo: "new" })} />
			</div>

			{promotionsError.value && (
				<div class="cat-promo__state" role="alert">
					<p class="cat-promo__state-title">{promotionsError.value}</p>
					<p class="cat-promo__note">
						{data
							? "The codes below are from the last load that worked."
							: "Nothing was lost; this view just couldn't reach your codes."}
					</p>
					<Button
						label="Try again"
						size="sm"
						severity="neutral"
						variant="outlined"
						onClick={() => void loadPromotions()}
					/>
				</div>
			)}
			{!data && promotionsLoading.value && !promotionsError.value && (
				<p class="cat-promo__note" role="status">Loading your codes…</p>
			)}
			{data && data.codes.length === 0 && (
				<p class="cat-promo__note" role="status">
					No codes yet. Issue one to share with your buyers: they type it at checkout.
				</p>
			)}

			{live.length > 0 && (
				<ul class="cat-promo__list" aria-label="Live codes">
					{live.map((code) => <PromoRow key={code.id} code={code} now={now} archivable />)}
				</ul>
			)}
			{archived.length > 0 && (
				<section class="cat-promo__section" aria-labelledby="cat-promo-archived">
					<h3 id="cat-promo-archived" class="cat-promo__subhead">Archived</h3>
					<ul class="cat-promo__list">
						{archived.map((code) => <PromoRow key={code.id} code={code} now={now} />)}
					</ul>
				</section>
			)}

			<PromoCodeDialog listings={data?.listings ?? []} defaultCurrency={props.defaultCurrency} />
			<ArchivePromoDialog />
		</div>
	);
}

function PromoRow(
	props: { code: SellerPromoCode; now: number; archivable?: boolean },
): JSX.Element {
	const { code } = props;
	const percent = percentLabel(code);
	return (
		<li class="cat-promo__row">
			<div class="cat-promo__main">
				<p class="cat-promo__name">
					<span class="cat-promo__code">{code.code}</span>
					<span class="cat-promo__label">{code.label}</span>
				</p>
				<MetaLine
					items={[
						percent ? { text: percent, tabular: true } : code.value && {
							text: `${code.value.display} off`,
							tabular: true,
							node: (
								<>
									<MoneyView value={code.value} exact /> off
								</>
							),
						},
						{ text: redeemedLabel(code), tabular: true },
						code.archivedAt ? archivedLabel(code) : expiryLabel(code, props.now),
						scopeLabel(code),
						perAccountLabel(code),
					]}
				/>
			</div>
			{props.archivable && (
				<Button
					label="Archive"
					size="sm"
					severity="secondary"
					variant="text"
					aria-label={`Archive ${code.code}`}
					onClick={() => setConsoleUrl({ promo: `archive:${code.code}` })}
				/>
			)}
		</li>
	);
}
