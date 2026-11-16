import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import { CheckoutStepper } from "../components/CheckoutStepper.tsx";
import {
	carriedParams,
	checkoutStepOf,
	isCheckoutPath,
	isFocusStep,
	preselectFrom,
} from "./basket-model.ts";
import { resolveOwnerParam } from "./checkout-ssr.ts";

/**
 * The checkout's step trail for the shell top bar's centre on the two focus steps
 * (`/checkout/details`, `/checkout/payment`), or `null` for every other URL (DESIGN_SYSTEM §D.6).
 *
 * Server-rendered anchors with no island: the step, the basket and the owner all come from the URL,
 * so the trail costs the request no read. Server-only — composed by the `(dashboard)` layout.
 */
export function checkoutTrailFor(url: URL, context: UserContext): ComponentChildren {
	if (!isCheckoutPath(url.pathname)) return null;
	const step = checkoutStepOf(url.pathname);
	if (!isFocusStep(step)) return null;
	const sp = url.searchParams;

	return (
		<div class="cko-trail">
			<CheckoutStepper
				active={step}
				basketId={sp.get("basketId") ?? sp.get("basket")}
				owner={resolveOwnerParam(context, url)}
				preselect={preselectFrom(sp)}
				carry={carriedParams(sp)}
			/>
		</div>
	);
}
