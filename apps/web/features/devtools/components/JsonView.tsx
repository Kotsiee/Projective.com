import type { JSX } from "preact";
import { useState } from "preact/hooks";
import "../styles/json-view.css";
import { IconChevron } from "./dev-glyphs.tsx";

/**
 * JsonView — a collapsible, syntax-highlighted JSON tree for the Log & API Inspector. Every branch
 * (object/array) is an expand/collapse `button`; leaves are colour-typed by token. Children render only
 * while their branch is open, so a deep payload stays cheap. Large collections are capped with a
 * "… N more" note. Dev-only (imported by the build-excluded Dev Tools island).
 */

// #region Props
/** Props for {@link JsonView}. */
export interface JsonViewProps {
	/** The value to render (any JSON-ish value). */
	data: unknown;
	/** Optional label for the root node. */
	rootName?: string;
	/** How many levels start expanded (default 1). */
	defaultDepth?: number;
}
// #endregion

/** Max children rendered per branch before truncating. */
const MAX_CHILDREN = 200;

type JsonType = "string" | "number" | "boolean" | "null" | "undefined" | "object" | "array";

/** Classify a value for rendering + colour. */
function typeOf(v: unknown): JsonType {
	if (v === null) return "null";
	if (v === undefined) return "undefined";
	if (Array.isArray(v)) return "array";
	const t = typeof v;
	if (t === "number" || t === "bigint") return "number";
	if (t === "boolean") return "boolean";
	if (t === "string") return "string";
	return "object";
}

/** Render a primitive value's text. */
function primitiveText(value: unknown, type: JsonType): string {
	switch (type) {
		case "string":
			return `"${value}"`;
		case "null":
			return "null";
		case "undefined":
			return "undefined";
		default:
			return String(value);
	}
}

/** One node in the tree — a primitive leaf or a collapsible branch. */
function JsonNode(
	props: { name?: string; value: unknown; depth: number; expandDepth: number },
): JSX.Element {
	const { name, value, depth, expandDepth } = props;
	const type = typeOf(value);
	const isBranch = type === "object" || type === "array";
	const [open, setOpen] = useState(depth < expandDepth);
	const indent = `--depth:${depth}`;

	if (!isBranch) {
		return (
			<div class="dev-json__row" style={indent}>
				{name !== undefined && <span class="dev-json__key">{name}:</span>}
				<span class={`dev-json__val dev-json__val--${type}`}>{primitiveText(value, type)}</span>
			</div>
		);
	}

	const entries: Array<[string, unknown]> = type === "array"
		? (value as unknown[]).map((v, i) => [String(i), v])
		: Object.entries(value as Record<string, unknown>);
	const [openBracket, closeBracket] = type === "array" ? ["[", "]"] : ["{", "}"];
	const shown = entries.slice(0, MAX_CHILDREN);
	const noun = type === "array" ? "items" : "keys";

	return (
		<div class="dev-json__node">
			<button
				type="button"
				class="dev-json__toggle"
				style={indent}
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				<span class="dev-json__chevron" data-open={open}>
					<IconChevron />
				</span>
				{name !== undefined && <span class="dev-json__key">{name}:</span>}
				<span class="dev-json__punct">{openBracket}</span>
				{!open && (
					<>
						<span class="dev-json__count">{entries.length} {noun}</span>
						<span class="dev-json__punct">{closeBracket}</span>
					</>
				)}
			</button>
			{open && (
				<div class="dev-json__children">
					{shown.map(([k, v]) => (
						<JsonNode
							key={k}
							name={type === "array" ? undefined : k}
							value={v}
							depth={depth + 1}
							expandDepth={expandDepth}
						/>
					))}
					{entries.length > MAX_CHILDREN && (
						<div class="dev-json__more" style={`--depth:${depth + 1}`}>
							… {entries.length - MAX_CHILDREN} more
						</div>
					)}
					<div class="dev-json__punct dev-json__close" style={indent}>{closeBracket}</div>
				</div>
			)}
		</div>
	);
}

/** The tree root. */
export function JsonView(props: JsonViewProps): JSX.Element {
	return (
		<div class="dev-json">
			<JsonNode
				name={props.rootName}
				value={props.data}
				depth={0}
				expandDepth={props.defaultDepth ?? 1}
			/>
		</div>
	);
}
