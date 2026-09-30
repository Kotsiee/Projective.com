import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { PaymentMethodView } from "../types/wallet-types.ts";
import { methodName, type ResolvedAction } from "../core/wallet-home.ts";
import { WalletGlyph } from "./wallet-glyphs.tsx";

/** Props for {@link MethodsList}. */
export interface MethodsListProps {
	methods: PaymentMethodView[];
	error: string | null;
	retrying: boolean;
	/** The Add action, when the viewer was offered it. */
	add: ResolvedAction | null;
	onAdd: (action: ResolvedAction) => void;
	onRetry: () => void;
}

const ROLE: Readonly<Record<PaymentMethodView["methodRole"], string>> = {
	funding: "Paying in",
	payout: "Getting paid",
	both: "Paying in and getting paid",
};

function defaultsOf(m: PaymentMethodView): string | null {
	if (m.isDefaultFunding && m.isDefaultPayout) return "Default for both";
	if (m.isDefaultFunding) return "Default for paying in";
	if (m.isDefaultPayout) return "Default payout";
	return null;
}

/** The wallet's saved payment methods. Card details stay with the processor; only fragments show here. */
export function MethodsList(props: MethodsListProps): JSX.Element {
	return (
		<section class="wlt-section wlt-methods" id="methods" aria-labelledby="wlt-methods-title">
			<header class="wlt-section__head">
				<h2 id="wlt-methods-title" class="wlt-section__title">Payment methods</h2>
				{props.add && (
					<Button
						variant="text"
						size="sm"
						label="Add"
						icon={<Icon name="plus" />}
						aria-label={props.add.locked ? "Add payment method, unavailable" : "Add payment method"}
						onClick={() => props.add && props.onAdd(props.add)}
					/>
				)}
			</header>
			{props.methods.length > 0
				? (
					<ul class="wlt-rows">
						{props.methods.map((m) => {
							const defaults = defaultsOf(m);
							return (
								<li
									class="wlt-row"
									key={m.id}
									data-muted={m.status === "active" ? undefined : "true"}
								>
									<span class="wlt-row__mark" aria-hidden="true">
										<WalletGlyph name="card" size="sm" />
									</span>
									<span class="wlt-row__body">
										<span class="wlt-row__title">{methodName(m)}</span>
										<span class="wlt-row__meta">
											{[ROLE[m.methodRole], defaults].filter(Boolean).join(" · ")}
										</span>
									</span>
									{m.status !== "active" && (
										<span class="wlt-row__trail">
											<span class="wlt-row__when">
												{m.status === "expired" ? "Expired" : "Inactive"}
											</span>
										</span>
									)}
								</li>
							);
						})}
					</ul>
				)
				: !props.error && <p class="wlt-empty">No payment methods saved yet.</p>}
			{props.error && (
				<InlineNotice
					text={props.error}
					actionLabel="Try again"
					onAction={props.onRetry}
					busy={props.retrying}
					align="start"
					class="wlt-notice"
				/>
			)}
		</section>
	);
}
