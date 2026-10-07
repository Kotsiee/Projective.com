import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
	type DevSeamState,
	type DevTrustAdornments,
	type DevVerificationStamp,
	readDevSeam,
	subscribeDevSeam,
} from "@web/utils/dev-seam.ts";

/** The Dev Context Switcher's trust-signal positions; both `auto` outside a dev override. */
export interface TrustSignalOverride {
	stamp: DevVerificationStamp;
	adornments: DevTrustAdornments;
}

const AUTO: TrustSignalOverride = { stamp: "auto", adornments: "auto" };

/**
 * The live `verificationStamp` and `trustAdornments` simulation positions for a profile island.
 * Seeded `auto` so hydration matches the server; inert in production, where the seam is absent.
 */
export function useTrustSignalOverride(): TrustSignalOverride {
	const state = useSignal<TrustSignalOverride>(AUTO);
	useEffect(() => {
		const apply = (seam: DevSeamState | null): void => {
			state.value = seam
				? { stamp: seam.verificationStamp ?? "auto", adornments: seam.trustAdornments ?? "auto" }
				: AUTO;
		};
		apply(readDevSeam());
		return subscribeDevSeam(apply);
	}, []);
	return state.value;
}
