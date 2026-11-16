import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { CheckoutBlocker } from "../types/checkout-types.ts";

/** Props for {@link PayGateNotice}. */
export interface PayGateNoticeProps {
	/** What stops payment, already worded, de-duplicated and in the order the buyer can act on. */
	blockers: readonly CheckoutBlocker[];
	/** The element id the disabled commit's `aria-describedby` names. */
	id: string;
	/** Where a line-scoped blocker is fixed — the basket step's row for it. Omitted, no link renders. */
	lineHref?: (itemId: string) => string;
}

/**
 * PayGateNotice — the ONE statement of why payment is off, set directly beside the disabled commit.
 *
 * Unboxed and in the meta register (`InlineNotice`): every refusal the step knows of — the session's
 * blockers and the chosen route's gate — is said here once, one line each, in the server's own words.
 * A line-scoped blocker links to the step that can fix it. Renders nothing when nothing blocks.
 */
export function PayGateNotice(props: PayGateNoticeProps): JSX.Element | null {
	const { blockers, lineHref } = props;
	if (blockers.length === 0) return null;

	return (
		<InlineNotice
			id={props.id}
			class="cko-paygate"
			align="start"
			icon={<Icon name="lock" />}
		>
			{blockers.map((blocker, index) => (
				<span
					key={`${blocker.code}-${blocker.itemId ?? "account"}-${index}`}
					class="cko-paygate__line"
					data-code={blocker.code}
				>
					{blocker.message}
					{blocker.itemId && lineHref && (
						<>
							{" "}
							<a class="cko-paygate__fix" href={lineHref(blocker.itemId)}>Fix in basket</a>
						</>
					)}
				</span>
			))}
		</InlineNotice>
	);
}
