import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	type DevSeamState,
	personaCapabilities,
	readDevSeam,
	subscribeDevSeam,
} from "@web/utils/dev-seam.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import { parseDismissed, promoVisible, withDismissed } from "../core/promo-model.ts";
import type { CtaPromo } from "../types/explore-types.ts";
import "../styles/explore.css";

export interface PromoGateProps {
	id: string;
	/** The slot's title, for the dismiss control's accessible name. */
	title: string;
	audience: CtaPromo["audience"];
	dismissible: boolean;
	/** Whether the signed-in viewer can already sell, as the server resolved it. */
	viewerFreelancer: boolean;
	/** Whether the viewer is a restricted (13–17) account, as the server resolved it. */
	viewerRestricted: boolean;
	children: ComponentChildren;
}

/**
 * PromoGate — the Home section that hosts a gated promo slot: it withholds the slot from an audience
 * it does not address, honours this device's dismissals, and renders the dismiss control.
 *
 * Dismissals live in `localStorage`, so they are applied after hydration. The gated slots sit below
 * the fold, so the reveal-then-hide happens out of view.
 */
export default function PromoGate(
	{ id, title, audience, dismissible, viewerFreelancer, viewerRestricted, children }: PromoGateProps,
): JSX.Element {
	const dismissed = useSignal<string[]>([]);
	const seam = useSignal<DevSeamState | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		dismissed.value = parseDismissed(readStored("local", LocalKeys.EXPLORE_DISMISSED_PROMOS));
		seam.value = readDevSeam();
		return subscribeDevSeam((next) => {
			seam.value = next;
		});
	}, []);

	const visible = promoVisible({
		id,
		audience,
		dismissible,
		dismissed: dismissed.value,
		viewerFreelancer: seam.value
			? personaCapabilities(seam.value.persona).isFreelancer
			: viewerFreelancer,
		viewerRestricted: seam.value?.ageRestriction && seam.value.ageRestriction !== "auto"
			? seam.value.ageRestriction === "minor"
			: viewerRestricted,
		mode: seam.value?.promoDismissal ?? "auto",
	});

	function dismiss() {
		const next = withDismissed(dismissed.value, id);
		dismissed.value = next;
		writeStored("local", LocalKeys.EXPLORE_DISMISSED_PROMOS, JSON.stringify(next));
		const following = rootRef.current?.nextElementSibling?.querySelector<HTMLElement>(
			"a[href], button:not([disabled])",
		);
		setTimeout(() => {
			const active = document.activeElement;
			if (following && (!active || active === document.body || rootRef.current?.contains(active))) {
				following.focus();
			}
		}, 0);
	}

	return (
		<div
			class="ex-home__section ex-home__section--promo"
			data-promo-id={id}
			hidden={!visible}
			ref={rootRef}
		>
			<div class={`ex-promo-gate${dismissible ? " ex-promo-gate--dismissible" : ""}`}>
				{children}
				{dismissible && (
					<Button
						iconOnly
						rounded
						size="sm"
						variant="text"
						severity="secondary"
						class="ex-promo-gate__dismiss"
						icon={<Icon name="close" size="sm" />}
						aria-label={`Dismiss ${title}`}
						onClick={dismiss}
					/>
				)}
			</div>
		</div>
	);
}
