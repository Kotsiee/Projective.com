import type { JSX } from "preact";
import { batch, effect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useId } from "@projective/ui/hooks";
import {
	codepointLabel,
	fontContainerLabel,
	type FontSpecimen,
	GLYPH_BLOCKS,
	readFontSpecimen,
	specimenFacts,
	specimenTitle,
} from "../../../core/font-specimen.ts";
import type { ViewerProps } from "../viewer.ts";
import { type FontTools, SAMPLE_TEXT } from "./font-tools.ts";
import { plainKey, scrollForKey, useStageKeys } from "./stage-keys.ts";

/** Largest font file the canvas reads into the page. */
const FONT_PREVIEW_MAX_BYTES = 30_000_000;
const WATERFALL_PX = [12, 16, 24, 32, 48, 72] as const;

// #region Load
class FontLoadError extends Error {
	constructor(readonly reason: string, options?: ErrorOptions) {
		super(reason, options);
		this.name = "FontLoadError";
	}
}

interface LoadedFont {
	face: FontFace;
	specimen: FontSpecimen;
}

async function loadFont(src: string, family: string, signal: AbortSignal): Promise<LoadedFont> {
	const response = await fetch(src, { signal, credentials: "same-origin" });
	if (!response.ok) {
		await response.body?.cancel();
		throw new FontLoadError(
			response.status === 404
				? "This font isn't available any more."
				: "This font couldn't be loaded.",
		);
	}
	const bytes = await response.arrayBuffer();
	const specimen = readFontSpecimen(bytes);
	const face = new FontFace(family, bytes, { display: "block" });
	try {
		await face.load();
	} catch (error) {
		throw new FontLoadError(
			"This font couldn't be read. It may be damaged or in a format the browser doesn't support.",
			{ cause: error },
		);
	}
	return { face, specimen };
}
// #endregion

function metaLine(specimen: FontSpecimen | null): string {
	if (!specimen) return "";
	const parts: string[] = [];
	if (specimen.names.subfamily) parts.push(specimen.names.subfamily);
	if (specimen.glyphCount !== null) {
		parts.push(`${specimen.glyphCount.toLocaleString("en-GB")} glyphs`);
	}
	if (specimen.container) parts.push(fontContainerLabel(specimen.container));
	return parts.join(" · ");
}

function firstLine(text: string): string {
	const line = text.split("\n").find((l) => l.trim().length > 0);
	return line ?? SAMPLE_TEXT.pangram;
}

/** The font canvas: an editable sample, a size waterfall and the Latin glyph grid, set in the file. */
export function FontStage({ shell, tools }: ViewerProps<FontTools>): JSX.Element {
	const rootRef = useRef<HTMLDivElement>(null);
	const sampleId = useId(undefined, "ins-font-sample");
	const sizesId = useId(undefined, "ins-font-sizes");
	const glyphsId = useId(undefined, "ins-font-glyphs");

	// #region Fetch and register
	useEffect(() => {
		const { asset } = shell;
		if (asset.sizeBytes > FONT_PREVIEW_MAX_BYTES) {
			shell.fail("This font is too large to preview here. Download it to open it.");
			return;
		}
		const abort = new AbortController();
		const family = `ins-preview-${asset.id.slice(0, 8)}`;
		let registered: FontFace | null = null;
		loadFont(asset.src, family, abort.signal)
			.then(({ face, specimen }) => {
				if (abort.signal.aborted) return;
				document.fonts.add(face);
				registered = face;
				batch(() => {
					tools.specimen.value = specimen;
					tools.family.value = family;
					shell.facts.value = specimenFacts(specimen);
					shell.status.value = "ready";
				});
			})
			.catch((error: unknown) => {
				if (abort.signal.aborted) return;
				shell.fail(error instanceof FontLoadError ? error.reason : "This font couldn't be loaded.");
			});
		return () => {
			abort.abort();
			if (registered) document.fonts.delete(registered);
			tools.family.value = null;
		};
	}, [shell, tools]);
	// #endregion

	useEffect(() => {
		let first = true;
		return effect(() => {
			const preset = tools.preset.value;
			if (first) {
				first = false;
				return;
			}
			tools.sample.value = SAMPLE_TEXT[preset];
		});
	}, [tools]);

	useStageKeys(rootRef, (event, stage) => {
		if (plainKey(event) && (event.key === "+" || event.key === "=")) {
			tools.resize(1);
			return true;
		}
		if (plainKey(event) && (event.key === "-" || event.key === "_")) {
			tools.resize(-1);
			return true;
		}
		const root = rootRef.current;
		return root ? scrollForKey(event, stage, root) : false;
	});

	const family = tools.family.value;
	const specimen = tools.specimen.value;
	const sample = tools.sample.value;
	const coverage = specimen?.coverage ?? null;
	const lines = Math.min(8, Math.max(1, sample.split("\n").length));
	const waterfall = firstLine(sample);

	return (
		<div
			class="ins-font"
			ref={rootRef}
			style={family
				? { "--ins-font-family": `"${family}"`, "--ins-font-size": `${tools.size.value}px` }
				: { "--ins-font-size": `${tools.size.value}px` }}
		>
			<div class="ins-font__inner">
				<header class="ins-font__head">
					<p class="ins-font__title">{specimenTitle(specimen, shell.asset.name)}</p>
					{specimen ? <p class="ins-font__meta">{metaLine(specimen)}</p> : null}
				</header>

				<label class="ui-visually-hidden" for={sampleId}>Sample text</label>
				<textarea
					id={sampleId}
					class="ins-font__sample"
					rows={lines}
					spellcheck={false}
					autocomplete="off"
					value={sample}
					onInput={(e) => (tools.sample.value = e.currentTarget.value)}
				/>

				<section class="ins-font__section" aria-labelledby={sizesId}>
					<h3 id={sizesId} class="ins-font__heading">Sizes</h3>
					<ul class="ins-font__sizes">
						{WATERFALL_PX.map((px) => (
							<li class="ins-font__size" key={px}>
								<span class="ins-font__size-label">{`${px} px`}</span>
								<span class="ins-font__size-line" style={{ "--ins-font-line": `${px}px` }}>
									{waterfall}
								</span>
							</li>
						))}
					</ul>
				</section>

				<section class="ins-font__section" aria-labelledby={glyphsId}>
					<h3 id={glyphsId} class="ins-font__heading">Glyphs</h3>
					{GLYPH_BLOCKS.map((block) => (
						<div class="ins-font__block" key={block.name}>
							<h4 class="ins-font__block-title">{block.name}</h4>
							<ul class="ins-font__grid" aria-label={`${block.name} glyphs`}>
								{block.codepoints.map((cp) => {
									const missing = coverage !== null && !coverage.has(cp);
									return (
										<li
											class="ins-font__cell"
											key={cp}
											data-missing={missing ? "true" : undefined}
										>
											<span class="ins-font__glyph">{missing ? "" : String.fromCodePoint(cp)}</span>
											<span class="ins-font__code">{codepointLabel(cp)}</span>
											{missing ? <span class="ui-visually-hidden">Not in this font</span> : null}
										</li>
									);
								})}
							</ul>
						</div>
					))}
				</section>
			</div>
		</div>
	);
}
