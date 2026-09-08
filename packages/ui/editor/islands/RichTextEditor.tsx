import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Signal } from "@preact/signals";
import "../styles/editor.css";
import { cx } from "../../core/cx.ts";
import type { Bindable, FieldStatus, ValueChange } from "../../fields/types/mod.ts";
import { markdownToHtml, shouldParseMarkdown } from "../core/markdown.ts";
import { cssLength } from "../core/resize.ts";
import { useEditorResize } from "../hooks/useEditorResize.ts";
import {
	loadedQuill,
	loadQuill,
	type QuillConstructor,
	type QuillInstance,
	warmQuill,
} from "../core/quill-loader.ts";

/**
 * RichTextEditor — a lightweight, token-driven QuillJS wrapper.
 *
 * A deliberately **stripped** rich-text control: the toolbar is restricted to Bold · Italic ·
 * Strikeout · Underline · Bullet/Numbered lists · Headings (H1–H3) and Quill is configured to accept
 * ONLY those formats (paste is sanitised to the same set). It brings its own token-based CSS — Quill's
 * `snow`/`bubble` themes are NOT imported, so nothing here hardcodes a hue/radius/shadow and the
 * component stays copy-paste portable (root `packages/ui/CLAUDE.md` §1).
 *
 * Client-only: Quill is behind a dynamic `import()` because the module touches `document` while it
 * EVALUATES, so it must never be reachable from the SSR pass. It is a hand-assembled `quill/core`
 * build carrying only the seven things this toolbar offers — see
 * {@link ../core/quill-runtime.ts | `quill-runtime`} — and the fetch is started during RENDER by
 * {@link warmQuill} rather than in the mount effect, so it overlaps the rest of hydration instead of
 * queueing behind it. The initial paint is a plain container; Quill upgrades it on hydration. The
 * component is a packages/ui *island-folder* component — it hydrates as part of whichever app island
 * mounts it (e.g. the Project Creation Modal), not as a standalone Fresh island.
 *
 * Signal-first: pass a `Signal<string>` (controlled — read once at mount, written back on change) or a
 * raw HTML string (uncontrolled seed). Emits clean semantic HTML via {@link ValueChange}; an empty
 * document emits `""` so a required/publishing gate can test it plainly.
 *
 * ## Sizing: CSS grows the box, JavaScript only ever pins it
 *
 * Auto-expansion has NO JavaScript at all. The editing surface is its content's natural height,
 * floored by `defaultHeight` and ceilinged by `maxAutoHeight`, with the overflow scrolling — three
 * declarations, resolved by the engine on every reflow. A measure-and-set loop was the obvious
 * alternative and is worse in three ways that matter here: it needs the container's height set to
 * `auto` before every measurement or it can only ever grow, it runs on a frame this repo has measured
 * a preview pane never delivering, and it paints the wrong size for the whole first frame of every
 * page load. The only geometry JavaScript writes is a size the reader dragged, which is not derivable
 * from content by definition.
 *
 * The two bound pairs are deliberately different. Growing on its own the box floors at
 * `defaultHeight` — the resting size the surface was designed around — and ceilings at
 * `maxAutoHeight`. Dragged by hand it floors at `minHeight` and ceilings at `maxHeight`, which are
 * the reader's limits rather than the layout's, and are wider on purpose: someone who has taken the
 * box in hand is allowed a size the automatic behaviour would never have chosen.
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
	/**
	 * Minimum editor height, in rows (default 4). The row-derived height is what `defaultHeight`
	 * defaults to, so a call site that only sets `minRows` behaves exactly as it always has.
	 */
	minRows?: number;
	/**
	 * Resting height of the editing surface — a number is pixels, a string is any CSS length.
	 * Defaults to the height `minRows` implies. The toolbar is chrome above this and is not counted.
	 */
	defaultHeight?: number | string;
	/**
	 * Ceiling for automatic growth. Past it the surface scrolls instead of growing. Unbounded by
	 * default, so an existing call site keeps growing with its content exactly as before.
	 */
	maxAutoHeight?: number | string;
	/** Hard floor for a MANUAL drag (default `2.5rem` — one line of text and its padding). */
	minHeight?: number | string;
	/** Hard ceiling for a MANUAL drag. Unbounded by default. */
	maxHeight?: number | string;
	/**
	 * Render the width and corner handles too (default `false`). Width is always clamped to the
	 * parent's content box, so a drag cannot push the page into horizontal overflow.
	 */
	enableHorizontalResize?: boolean;
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
		defaultHeight,
		maxAutoHeight,
		minHeight,
		maxHeight,
		enableHorizontalResize = false,
		id,
		class: className,
		"aria-label": ariaLabel,
	} = props;

	const containerRef = useRef<HTMLDivElement>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<HTMLDivElement>(null);
	const quillRef = useRef<QuillInstance | null>(null);

	const resize = useEditorResize({
		containerRef,
		surfaceRef: editorRef,
		horizontal: enableHorizontalResize,
	});

	/*
	 * Start fetching Quill now rather than in the mount effect below. Render runs before effects
	 * flush, so on a page with many islands this overlaps the download with the rest of hydration
	 * instead of queueing behind it — and because it is here rather than at module scope, a page
	 * whose islands merely CAN render an editor never pays for one it does not draw. No-op on the
	 * server, and memoised, so N editors on one surface still perform exactly one import.
	 */
	warmQuill();

	useEffect(() => {
		let disposed = false;
		let editor: QuillInstance | null = null;
		const container = containerRef.current;

		/**
		 * Markdown paste interception.
		 *
		 * Registered in the CAPTURE phase on the CONTAINER, which is a strict ancestor of the element
		 * Quill binds its own `paste` listener to. That is what guarantees this runs first: two
		 * listeners on the same node fire in registration order regardless of phase, and Quill
		 * registers its own in its constructor — so a bubble-phase handler here, or a JSX `onPaste`,
		 * would run after Quill had already inserted the text.
		 *
		 * Quill's handler opens with `if (e.defaultPrevented) return`, so `preventDefault()` is the
		 * whole hand-off and `stopPropagation()` is deliberately NOT called — an app-level paste
		 * listener elsewhere on the page keeps seeing the event.
		 *
		 * It is called before the dispatch rather than after, because it has to happen inside the
		 * event's own dispatch to mean anything. The insertion is therefore wrapped: if it throws, the
		 * reader still gets their clipboard as plain text. Losing a paste is not an acceptable price
		 * for a convenience.
		 */
		const onPasteCapture = (event: ClipboardEvent) => {
			const quill = quillRef.current;
			if (!quill || event.defaultPrevented) return;
			const data = event.clipboardData;
			if (!data) return;

			const text = data.getData("text/plain");
			if (!shouldParseMarkdown(text, data.getData("text/html"))) return;
			const html = markdownToHtml(text);
			if (!html) return;

			const range = quill.getSelection(true);
			if (!range) return;

			event.preventDefault();
			try {
				if (range.length > 0) quill.deleteText(range.index, range.length, "silent");
				quill.clipboard.dangerouslyPasteHTML(range.index, html, "user");
				quill.scrollSelectionIntoView();
			} catch {
				quill.insertText(range.index, text, "user");
			}
		};
		container?.addEventListener("paste", onPasteCapture, true);

		/*
		 * Someone who clicks the box before Quill has arrived has told us where they want to be, and
		 * the click reaches nothing because the editable surface does not exist yet. Remember it and
		 * spend it on `focus()` at mount, so the intent survives the wait instead of being dropped.
		 * Removed as soon as Quill is up, since from then on the real editor handles its own focus.
		 */
		let focusWhenReady = false;
		const onEarlyPointer = () => {
			if (!quillRef.current) focusWhenReady = true;
		};
		// The editing SURFACE, not the container: a press on a resize handle or a toolbar button is
		// not a request to put the caret in the document, and should not be spent as one.
		editorRef.current?.addEventListener("pointerdown", onEarlyPointer);

		/*
		 * `loadedQuill()` first, and the branch is not a micro-optimisation: a second editor opened
		 * later in the session — the ticket modal over a board that already mounted one — would
		 * otherwise still yield to a microtask, painting its container once while empty. With the
		 * class already in hand there is no await at all, so it is never drawn unmounted.
		 */
		const mount = (Quill: QuillConstructor) => {
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

			/*
			 * Ready is announced by writing the DOM, not by flipping a signal, and that is the same
			 * call `useEditorResize` makes for the same reason: a re-render would have Preact diff a
			 * subtree Quill now owns, and this component deliberately renders once. The attribute is
			 * what the stylesheet reads to retire the pre-mount placeholder and wake the toolbar.
			 */
			container?.setAttribute("data-ready", "true");
			container?.removeAttribute("aria-busy");
			toolbarEl.removeAttribute("aria-disabled");
			// A click that landed while the box was still loading is honoured rather than swallowed.
			if (focusWhenReady) editor.focus();

			editor.on("text-change", () => {
				const current = quillRef.current;
				if (!current) return;
				const empty = current.getText().trim().length === 0;
				const html = empty ? "" : current.getSemanticHTML();
				if (value instanceof Signal) value.value = html;
				onValueChange?.(html);
			});
		};

		const ready = loadedQuill();
		if (ready) mount(ready);
		else loadQuill().then(mount).catch(() => {});

		return () => {
			disposed = true;
			container?.removeEventListener("paste", onPasteCapture, true);
			editorRef.current?.removeEventListener("pointerdown", onEarlyPointer);
			if (editor) editor.off("text-change");
			quillRef.current = null;
		};
		// Mount-once: Quill owns its DOM thereafter; controlled writes flow OUT only (no re-seed loop).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/**
	 * Dimension props reach CSS as custom properties, which is how this component parameterises its
	 * stylesheet without any call site hardcoding a length (root `CLAUDE.md` §3).
	 *
	 * An OBJECT rather than this repo's usual style STRING, and the reason is the drag: `useEditorResize`
	 * writes `--rte-h`/`--rte-w` straight onto this same element, and Preact assigns a string style by
	 * replacing `cssText` wholesale — so the day one of these values became dynamic, a re-render
	 * mid-drag would silently wipe the pinned size. With an object Preact touches only the keys it
	 * owns, and the two writers cannot collide.
	 */
	const sizing: Record<string, string> = { "--rte-min-rows": String(minRows) };
	if (defaultHeight !== undefined) sizing["--rte-h-default"] = cssLength(defaultHeight);
	if (maxAutoHeight !== undefined) sizing["--rte-h-max-auto"] = cssLength(maxAutoHeight);
	if (minHeight !== undefined) sizing["--rte-h-min"] = cssLength(minHeight);
	if (maxHeight !== undefined) sizing["--rte-h-max"] = cssLength(maxHeight);

	return (
		<div
			ref={containerRef}
			class={cx(
				"ui-rte",
				status !== "default" && `ui-rte--${status}`,
				enableHorizontalResize && "ui-rte--hresize",
				className,
			)}
			style={sizing}
			data-ready="false"
			aria-busy="true"
		>
			<div
				class="ui-rte__toolbar"
				ref={toolbarRef}
				role="toolbar"
				aria-label="Formatting"
				aria-disabled="true"
			>
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
			{
				/*
				 * `data-placeholder` is set here as well as by Quill, so the ghost text is on screen
				 * from the first server-rendered byte instead of appearing when the editor mounts.
				 * It is a component prop, never stored content — nothing user-authored is put into
				 * this container as markup, which is what keeps a description carrying
				 * `<img onerror=…>` from becoming a script the moment it is rendered.
				 */
			}
			<div
				class="ui-rte__editor"
				ref={editorRef}
				id={id}
				aria-label={ariaLabel}
				data-placeholder={placeholder}
			/>
			{
				/*
				 * Resize handles. Focusable and arrow-key operable, not mouse-only: a native `resize` grip
				 * excludes keyboard users from a capability the design is offering, and the ARIA
				 * window-splitter pattern is exactly a focusable `separator`.
				 */
			}
			<div
				class="ui-rte__handle ui-rte__handle--block"
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize editor height"
				tabIndex={0}
				onPointerDown={(e) => resize.start("block", e)}
				onKeyDown={(e) => resize.onKeyDown("block", e)}
			/>
			{enableHorizontalResize && (
				<>
					<div
						class="ui-rte__handle ui-rte__handle--inline"
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize editor width"
						tabIndex={0}
						onPointerDown={(e) => resize.start("inline", e)}
						onKeyDown={(e) => resize.onKeyDown("inline", e)}
					/>
					<div
						class="ui-rte__handle ui-rte__handle--corner"
						role="separator"
						aria-label="Resize editor width and height"
						tabIndex={0}
						onPointerDown={(e) => resize.start("both", e)}
						onKeyDown={(e) => resize.onKeyDown("both", e)}
					/>
				</>
			)}
		</div>
	);
}
