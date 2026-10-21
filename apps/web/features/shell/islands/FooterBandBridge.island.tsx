import { useEffect } from "preact/hooks";
import { publishFooterBandHeight } from "@projective/ui/navigation";

/**
 * FooterBandBridge — publishes the middle-nav footer band's live height so the canvas surface ends at
 * the band's top edge and its bottom corners round in view rather than under the band.
 *
 * It renders **nothing**. Mounted by `UserShell` only when a footer band is registered.
 */
export default function FooterBandBridge(): null {
	useEffect(() => publishFooterBandHeight(), []);
	return null;
}
