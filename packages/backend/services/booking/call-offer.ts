import { hash } from "../scheduling/derive.ts";

/**
 * booking call-offer — which discovery-call flavours a seller offers, derived ONCE from their handle.
 *
 * Two surfaces state this fact: the listing's Contact menu (`BookingBackendService.contactOfferFor`,
 * which builds the public `PublicCallOffer`) and the `/[handle]` profile's "Free consultation" mark
 * (`profile-fixtures.ts`, via `ProfileView.freeConsultation`). A profile that advertises a free call
 * beside a listing whose menu offers only a paid one is a data question the reader cannot answer, so
 * the derivation lives here and both read it. The live path replaces this with one read of
 * `scheduling.call_settings`; the two consumers keep the same shape.
 */
export type CallOfferKind = "none" | "paid" | "both" | "courtesy";

/** The seed both consumers hash from — the BARE handle, no leading `@`. */
export function callOfferSeed(handle: string): number {
	return hash(`calls:${handle.replace(/^@+/, "")}`);
}

/**
 * The derived flavour for a seller. `none` is deliberately reachable (one seller in four): it is the
 * shape most likely to be wrong on a surface and least likely to be looked at.
 */
export function callOfferKindFor(handle: string): CallOfferKind {
	const seed = callOfferSeed(handle);
	return seed % 4 === 0 ? "none" : seed % 3 === 0 ? "paid" : seed % 2 === 0 ? "both" : "courtesy";
}

/** Whether a flavour includes the FREE introductory call. */
export function offersCourtesyCall(kind: CallOfferKind): boolean {
	return kind === "courtesy" || kind === "both";
}
