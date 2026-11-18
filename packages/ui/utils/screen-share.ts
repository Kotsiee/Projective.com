/**
 * `@projective/ui/utils/screen-share` — the screen sharing store and context alone, importable where
 * no stylesheet may follow (a server module, a unit test, an always-mounted bridge). Same module as
 * `./utils` exports; a narrower door.
 */

export {
	hydrateScreenShareFromDom,
	maskFigures,
	SCREEN_SHARE_ACTIVE,
	SCREEN_SHARE_AMOUNT_LABEL,
	SCREEN_SHARE_ATTRIBUTE,
	SCREEN_SHARE_HIDDEN_LABEL,
	SCREEN_SHARE_MASK,
	screenShareActive,
	ScreenShareContext,
	setAmbientScreenShareResolver,
	setScreenShareActive,
	useHoldToReveal,
	useMaskFigures,
	useScreenShareActive,
} from "./core/screen-share.ts";
export type { HoldToReveal, ScreenShareView } from "./core/screen-share.ts";
