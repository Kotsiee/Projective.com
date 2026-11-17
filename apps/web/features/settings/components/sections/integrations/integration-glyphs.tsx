import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import {
	AppleCalendarMark,
	CalendlyMark,
	GoogleMark,
	MicrosoftMark,
	NotionMark,
	OutlookMark,
	SamsungMark,
} from "@features/shell/components/brand-marks.tsx";
import { SourceMark } from "@features/files/components/file-hub-glyphs.tsx";
import { providerSource } from "@features/files/core/asset-model.ts";

const MARK = "stg-provider__glyph";

/**
 * A connector's mark in Settings → Integrations: the brand's own where the product carries one, else
 * a registry glyph for its family. Decorative — the provider's name is always beside it.
 */
export function IntegrationGlyph(props: { slug: string }): JSX.Element {
	switch (props.slug) {
		case "google":
			return <GoogleMark class={MARK} />;
		case "outlook":
			return <OutlookMark size={20} class={MARK} />;
		case "microsoft_teams":
			return <MicrosoftMark class={MARK} />;
		case "apple":
			return <AppleCalendarMark size={20} class={MARK} />;
		case "samsung":
			return <SamsungMark size={20} class={MARK} />;
		case "calendly":
			return <CalendlyMark size={20} class={MARK} />;
		case "notion":
			return <NotionMark size={20} class={MARK} />;
		case "zoom":
		case "discord":
			return <Icon name="video-camera" size="md" class={MARK} aria-hidden="true" />;
	}
	const source = providerSource(props.slug);
	return source === "supabase"
		? <Icon name="link" size="md" class={MARK} aria-hidden="true" />
		: <SourceMark source={source} size={20} class={MARK} />;
}
