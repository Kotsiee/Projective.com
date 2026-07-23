import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Signal } from "@preact/signals";
import "../styles/editor.css";
import { cx } from "../../core/cx.ts";
import type { Bindable, FieldStatus, ValueChange } from "../../fields/types/mod.ts";

/**
 * RichTextEditor — a lightweight, token-driven QuillJS wrapper.
 *
 * A deliberately **stripped** rich-text control: the toolbar is restricted to Bold · Italic ·
 * Strikeout · Underline · Bullet/Numbered lists · Headings (H1–H3) and Quill is configured to accept
 * ONLY those formats (paste is sanitised to the same set). It brings its own token-based CSS — Quill's
 * `snow`/`bubble` themes are NOT imported, so nothing here hardcodes a hue/radius/shadow and the
 * component stays copy-paste portable (root `packages/ui/CLAUDE.md` §1).
 *
 * Client-only: Quill is `import()`-ed inside an effect so the module (which touches `document`) never
 * evaluates during SSR. The initial paint is a plain container; Quill upgrades it on hydration. The
 * component is a packages/ui *island-folder* component — it hydrates as part of whichever app island
 * mounts it (e.g. the Project Creation Modal), not as a standalone Fresh island.
 *
 * Signal-first: pass a `Signal<string>` (controlled — read once at mount, written back on change) or a
 * raw HTML string (uncontrolled seed). Emits clean semantic HTML via {@link ValueChange}; an empty
 * document emits `""` so a required/publishing gate can test it plainly.
 */
export interface RichTextEditorProps {
	/** Bound HTML value — a raw string (seed) or a `Signal<string>` (controlled). Read once at mount. */
	value?: Bindable<string>;
	/** Fired with clean semantic HTML on every edit (empty document → `""`). */
	onValueChange?: ValueChange<string>;
	/** Ghost text shown while the document is empty. */
	placeholder?: string;
	/** Validation status → coloured ring (RED `required` / AMBER `gate` creation gates, §fields). */
	status?: FieldStatus;
	/** Minimum editor height, in rows (default 4). */
	minRows?: number;
	/** Accessible label for the editing region. */
	"aria-label"?: string;
	/** Stable id for the editing region (label association). */
	id?: string;
	class?: string;
}

/** A single toolbar control; `value` wires Quill's parameterised formats (headings, list kinds). */
interface ToolButton {
	format: string;
	value?: string;
	label: string;
	icon: VNode;
}

// #region Toolbar icons (inline, token-inheriting — currentColor only)
const strokeProps = {
	width: 18,
	height: 18,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	"stroke-width": 2,
	"stroke-linecap": "round",
	"stroke-linejoin": "round",
	"aria-hidden": "true",
} as const;

const BulletListIcon = (
	<svg {...strokeProps}>
		<line x1="9" y1="6" x2="20" y2="6" />
		<line x1="9" y1="12" x2="20" y2="12" />
		<line x1="9" y1="18" x2="20" y2="18" />
		<circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
		<circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
		<circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
	</svg>
);

const OrderedListIcon = (
	<svg {...strokeProps}>
		<line x1="10" y1="6" x2="20" y2="6" />
		<line x1="10" y1="12" x2="20" y2="12" />
		<line x1="10" y1="18" x2="20" y2="18" />
		<text x="2.5" y="8" font-size="7" fill="currentColor" stroke="none">1</text>
		<text x="2.5" y="14.5" font-size="7" fill="currentColor" stroke="none">2</text>
		<text x="2.5" y="21" font-size="7" fill="currentColor" stroke="none">3</text>
	</svg>
);

/** The four inline marks share one group; the two list kinds and three headings share the others. */
const INLINE_BUTTONS: readonly ToolButton[] = [
	{ format: "bold", label: "Bold", icon: <span class="ui-rte__glyph ui-rte__glyph--bold">B</span> },
	{
		format: "italic",
		label: "Italic",
		icon: <span class="ui-rte__glyph ui-rte__glyph--italic">I</span>,
	},
	{
		format: "underline",
		label: "Underline",
		icon: <span class="ui-rte__glyph ui-rte__glyph--underline">U</span>,
	},
	{
		format: "strike",
		label: "Strikethrough",
		icon: <span class="ui-rte__glyph ui-rte__glyph--strike">S</span>,
	},
];

const HEADING_BUTTONS: readonly ToolButton[] = [
	{ format: "header", value: "1", label: "Heading 1", icon: <span class="ui-rte__glyph">H1</span> },
	{ format: "header", value: "2", label: "Heading 2", icon: <span class="ui-rte__glyph">H2</span> },
	{ format: "header", value: "3", label: "Heading 3", icon: <span class="ui-rte__glyph">H3</span> },
];

const LIST_BUTTONS: readonly ToolButton[] = [
	{ format: "list", value: "bullet", label: "Bulleted list", icon: BulletListIcon },
	{ format: "list", value: "ordered", label: "Numbered list", icon: OrderedListIcon },
];
// #endregion

/** The strict allow-list handed to Quill so paste + typing can never introduce another format. */
const ALLOWED_FORMATS = ["bold", "italic", "underline", "strike", "header", "list"];

function resolveInitial(value: Bindable<string> | undefined): string {
	if (value instanceof Signal) return value.value;
	return typeof value === "string" ? value : "";
}

/** One toolbar button. Quill's toolbar module binds it by its `ql-*` class + optional `value`. */
function ToolbarButton({ btn }: { btn: ToolButton }): JSX.Element {
	return (
		<button
			type="button"
			class={cx("ui-rte__btn", `ql-${btn.format}`)}
			// `value` is how Quill's toolbar selects a parameterised format (header level, list kind).
			value={btn.value}
			aria-label={btn.label}
			title={btn.label}
		>
			{btn.icon}
		</button>
	);
}

export function RichTextEditor(props: RichTextEditorProps): JSX.Element {
	const {
		value,
		onValueChange,
		placeholder = "Write a description…",
		status = "default",
		minRows = 4,
		id,
		class: className,
		"aria-label": ariaLabel,
	} = props;

	const toolbarRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<HTMLDivElement>(null);
	// deno-lint-ignore no-explicit-any -- Quill instance is loaded dynamically on the client.
	const quillRef = useRef<any>(null);

	useEffect(() => {
		let disposed = false;
		// deno-lint-ignore no-explicit-any
		let editor: any = null;

		(async () => {
			const mod = await import("quill");
			const Quill = mod.default;
			const editorEl = editorRef.current;
			const toolbarEl = toolbarRef.current;
			if (disposed || !editorEl || !toolbarEl) return;

			editor = new Quill(editorEl, {
				placeholder,
				formats: ALLOWED_FORMATS,
				modules: { toolbar: toolbarEl },
			});
			quillRef.current = editor;

			const initial = resolveInitial(value);
			if (initial) editor.clipboard.dangerouslyPasteHTML(initial);

			editor.on("text-change", () => {
				const empty = editor.getText().trim().length === 0;
				const html = empty ? "" : editor.getSemanticHTML();
				if (value instanceof Signal) value.value = html;
				onValueChange?.(html);
			});
		})();

		return () => {
			disposed = true;
			if (editor) editor.off("text-change");
			quillRef.current = null;
		};
		// Mount-once: Quill owns its DOM thereafter; controlled writes flow OUT only (no re-seed loop).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div
			class={cx("ui-rte", status !== "default" && `ui-rte--${status}`, className)}
			style={`--rte-min-rows:${minRows}`}
		>
			<div class="ui-rte__toolbar" ref={toolbarRef} role="toolbar" aria-label="Formatting">
				<span class="ui-rte__group">
					{INLINE_BUTTONS.map((b) => <ToolbarButton key={b.format} btn={b} />)}
				</span>
				<span class="ui-rte__sep" aria-hidden="true" />
				<span class="ui-rte__group">
					{HEADING_BUTTONS.map((b) => <ToolbarButton key={b.value} btn={b} />)}
				</span>
				<span class="ui-rte__sep" aria-hidden="true" />
				<span class="ui-rte__group">
					{LIST_BUTTONS.map((b) => <ToolbarButton key={b.value} btn={b} />)}
				</span>
			</div>
			<div
				class="ui-rte__editor"
				ref={editorRef}
				id={id}
				aria-label={ariaLabel}
			/>
		</div>
	);
}
