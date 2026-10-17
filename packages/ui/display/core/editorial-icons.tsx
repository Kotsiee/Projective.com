import { Icon } from "../../icons/mod.ts";
import type { EditorialGlyphs } from "./editorial-glyphs.ts";

/**
 * The editorial family's glyphs from the shared registry (§B.7.1) — what a page provides to
 * `EditorialGlyphContext` and what the `TableOfContents` island draws. Each is decorative: the
 * anchor link's name is its heading, a callout's tone is also a word, the disclosure and the sheet
 * trigger are labelled "On this page". Sizes: the anchor mark is standalone beside a heading and takes
 * the `sm` ramp step; the rest inherit their label's `1em` (§B.7.3).
 *
 * This module imports `Icon` (and so its stylesheet), which is why it is separate from the
 * stylesheet-free components: reach it through `@projective/ui/display/editorial-islands`.
 */
export const EDITORIAL_ICONS: EditorialGlyphs = {
	anchor: () => <Icon name="link" size="sm" />,
	callout: {
		note: () => <Icon name="info" />,
		tip: () => <Icon name="light-bulb" />,
		warning: () => <Icon name="warning" />,
		important: () => <Icon name="error" />,
	},
	disclosure: () => <Icon name="chevron-down" />,
	sheet: () => <Icon name="list" />,
};
