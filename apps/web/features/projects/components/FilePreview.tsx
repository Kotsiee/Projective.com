import type { JSX } from "preact";
import { AudioVisualizer } from "@projective/ui/display";
import type { AssetItem } from "../types/projects-types.ts";
import { DownloadIcon, FileKindIcon, PlayIcon } from "./file-glyphs.tsx";

/**
 * FilePreview — the rich inline renderer for a single attachment in the preview modal's media panel,
 * chosen by kind: an image, a video (poster + play affordance), an audio waveform player, a
 * syntax-highlighted code block, or a document/archive placeholder with a download affordance. It is
 * the `itemTemplate` the modal's swipe carousel renders per slide. Presentation only — the actual
 * playback / streaming of stub assets lands with the live files backend.
 */
export interface FilePreviewProps {
	file: AssetItem;
	active: boolean;
}

/** Parse a pre-formatted `m:ss` (or `h:mm:ss`) duration label to milliseconds; `0` when absent. */
function durationLabelToMs(label: string | null | undefined): number {
	if (!label) return 0;
	const parts = label.split(":").map((p) => parseInt(p, 10));
	if (parts.some((n) => Number.isNaN(n))) return 0;
	const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
	return seconds * 1000;
}

/** A deterministic waveform (0–1) from a stable seed — no RNG, so SSR == client. */
function peaks(seed: string, n: number): number[] {
	let h = 0;
	for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = Math.abs(Math.sin((i + 1) * 0.6 + h));
		const b = ((h + i * 41) % 100) / 100;
		out.push(Math.min(1, Math.max(0.12, a * 0.6 + b * 0.4)));
	}
	return out;
}

// #region Sample code (fixture content for the code preview)
const SAMPLE: Record<string, string> = {
	ts:
		`import { signal } from "@preact/signals";\n\n// Derived view density for the file grid.\nexport const zoom = signal(0.62);\n\nexport function columnsFor(width: number, min: number): number {\n\treturn Math.max(1, Math.floor(width / min));\n}\n`,
	tsx:
		`export function Card({ title }: { title: string }) {\n\treturn (\n\t\t<div class="card">\n\t\t\t<h3>{title}</h3>\n\t\t</div>\n\t);\n}\n`,
	css:
		`.card {\n\t/* interactive → a full border is allowed */\n\tborder: 1px solid var(--outline);\n\tborder-radius: var(--radius-base);\n\tbackground: var(--surface);\n}\n`,
	json: `{\n\t"name": "tokens",\n\t"radius": { "base": 8, "lg": 12 },\n\t"enabled": true\n}\n`,
};
function sampleFor(ext: string): string {
	return SAMPLE[ext] ?? SAMPLE.ts;
}

const KEYWORDS = new Set([
	"import",
	"from",
	"export",
	"function",
	"return",
	"const",
	"let",
	"var",
	"if",
	"else",
	"true",
	"false",
	"new",
	"class",
]);

/** A tiny per-line tokenizer → highlighted spans (comments · strings · keywords · numbers). */
function highlight(line: string): JSX.Element[] {
	const out: JSX.Element[] = [];
	const commentAt = line.indexOf("//");
	const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
	const comment = commentAt >= 0 ? line.slice(commentAt) : "";
	const re = /("[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|\s+|[^\s\w])/g;
	let m: RegExpExecArray | null;
	let key = 0;
	while ((m = re.exec(code)) !== null) {
		const t = m[0];
		let cls: string | undefined;
		if (/^["'`]/.test(t)) cls = "fx-code--str";
		else if (/^\d/.test(t)) cls = "fx-code--num";
		else if (KEYWORDS.has(t)) cls = "fx-code--kw";
		out.push(cls ? <span key={key++} class={cls}>{t}</span> : <span key={key++}>{t}</span>);
	}
	if (comment) out.push(<span key={key++} class="fx-code--cmt">{comment}</span>);
	return out;
}
// #endregion

export function FilePreview({ file, active }: FilePreviewProps): JSX.Element {
	if (file.kind === "image" && file.thumbnailUrl) {
		return (
			<figure class="fx-preview fx-preview--image">
				<img
					class="fx-preview__img"
					src={file.url !== "#" ? file.url : file.thumbnailUrl}
					alt={file.name}
					draggable={false}
					loading={active ? "eager" : "lazy"}
				/>
			</figure>
		);
	}

	if (file.kind === "video") {
		return (
			<div class="fx-preview fx-preview--video">
				<div
					class="fx-preview__stage"
					style={file.thumbnailUrl ? `background-image:url(${file.thumbnailUrl})` : undefined}
				>
					<button type="button" class="fx-preview__play" aria-label="Play video">
						<PlayIcon size={30} />
					</button>
				</div>
				<p class="fx-preview__note">
					Video preview{file.durationLabel ? ` · ${file.durationLabel}` : ""}
				</p>
			</div>
		);
	}

	if (file.kind === "audio") {
		return (
			<div class="fx-preview fx-preview--audio">
				<div class="fx-audio">
					<AudioVisualizer
						src={file.messageAudioUrl ?? file.url}
						peaks={peaks(file.id, 96)}
						durationMs={durationLabelToMs(file.durationLabel) || 42_000}
						durationLabel={file.durationLabel ?? "0:00"}
						showSpeed
						aria-label={`Audio · ${file.name}`}
					/>
				</div>
			</div>
		);
	}

	if (file.kind === "code") {
		const lines = sampleFor(file.ext).replace(/\n$/, "").split("\n");
		return (
			<div class="fx-preview fx-preview--code">
				<pre class="fx-code"><code>
					{lines.map((line, i) => (
						<span key={i} class="fx-code__line">
							<span class="fx-code__ln" aria-hidden="true">{i + 1}</span>
							<span class="fx-code__src">{line ? highlight(line) : " "}</span>
						</span>
					))}
				</code></pre>
			</div>
		);
	}

	// PDF / doc / archive / other — a clean document placeholder with a download affordance.
	return (
		<div class="fx-preview fx-preview--doc">
			<div class="fx-doc">
				<span class="fx-doc__glyph" aria-hidden="true">
					<FileKindIcon kind={file.kind} size={56} />
				</span>
				<span class="fx-doc__name">{file.name}</span>
				<span class="fx-doc__meta">{file.ext.toUpperCase()} · {file.sizeLabel}</span>
				<a class="fx-doc__download" href={file.url} download aria-label={`Download ${file.name}`}>
					<DownloadIcon size={16} />
					<span>Download to view</span>
				</a>
			</div>
		</div>
	);
}
