import { Marked } from "marked";
import DOMPurify, { type Config, type DOMPurify as Purifier } from "dompurify";
import { INSPECT_TEXT_LIMITS } from "@projective/types/files";
import { highlightCode, resolveLanguage } from "./highlight-runtime.ts";
import { HEADING_ID_PREFIX, uniqueSlug } from "./code-lines.ts";

/**
 * markdown-runtime — GitHub-flavoured markdown to sanitised HTML for the inspector.
 *
 * **Never import this module statically**; reach it through `markdown-loader.ts`. marked renders,
 * DOMPurify strips everything executable or styled (no `<script>`, `<style>`, `<iframe>`, event
 * handlers or `style` attributes), external links open in a new tab with `noopener noreferrer`,
 * fenced code is highlighted with the shared grammars, and headings get page-unique anchors.
 */

// #region Types
/** One heading of the rendered document, for the table of contents. */
export interface MarkdownHeading {
	level: number;
	text: string;
	/** The element id; always {@link HEADING_ID_PREFIX}-prefixed so it cannot clash with the page. */
	id: string;
}

/** The sanitised document and its outline. */
export interface RenderedMarkdown {
	html: string;
	headings: MarkdownHeading[];
}
// #endregion

// #region Sanitiser
const parser = new Marked({ gfm: true, breaks: false });

const PURIFY_CONFIG: Config = {
	USE_PROFILES: { html: true },
	FORBID_TAGS: [
		"style",
		"form",
		"button",
		"textarea",
		"select",
		"option",
		"iframe",
		"frame",
		"object",
		"embed",
		"dialog",
		"template",
	],
	FORBID_ATTR: ["style", "id", "name", "srcset", "autofocus", "tabindex"],
	ALLOW_DATA_ATTR: false,
};

let purifier: Purifier | null = null;

function sanitizer(): Purifier {
	if (purifier) return purifier;
	const instance = DOMPurify(window);
	instance.addHook("afterSanitizeAttributes", (node) => {
		if (node instanceof HTMLAnchorElement) {
			const href = node.getAttribute("href") ?? "";
			if (href.startsWith("#")) {
				node.removeAttribute("target");
				node.setAttribute("data-anchor", href.slice(1));
			} else if (href.length > 0) {
				node.setAttribute("target", "_blank");
				node.setAttribute("rel", "noopener noreferrer");
			}
		} else if (node instanceof HTMLImageElement) {
			if (!/^(https?:|data:image\/)/i.test(node.getAttribute("src") ?? "")) {
				node.removeAttribute("src");
			}
			node.setAttribute("loading", "lazy");
			node.setAttribute("decoding", "async");
			node.setAttribute("referrerpolicy", "no-referrer");
		} else if (node instanceof HTMLInputElement) {
			node.setAttribute("disabled", "");
			node.setAttribute("tabindex", "-1");
		}
	});
	purifier = instance;
	return instance;
}
// #endregion

// #region Render
async function highlightBlocks(root: DocumentFragment): Promise<void> {
	for (const code of root.querySelectorAll<HTMLElement>("pre > code")) {
		const tag = [...code.classList].find((c) => c.startsWith("language-"));
		const language = tag ? resolveLanguage(tag.slice("language-".length)) : null;
		if (!language || language === "plaintext") continue;
		const html = await highlightCode(code.textContent ?? "", language).catch(() => null);
		if (html === null) continue;
		code.innerHTML = html;
		code.classList.add("hljs");
	}
}

function anchorHeadings(root: DocumentFragment): MarkdownHeading[] {
	const taken = new Map<string, number>();
	const headings: MarkdownHeading[] = [];
	for (const heading of root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")) {
		const text = (heading.textContent ?? "").trim();
		const id = `${HEADING_ID_PREFIX}${uniqueSlug(text, taken)}`;
		heading.id = id;
		if (text.length > 0) headings.push({ level: Number(heading.tagName.slice(1)), text, id });
	}
	return headings;
}

function wrapTables(root: DocumentFragment): void {
	for (const table of root.querySelectorAll("table")) {
		const frame = document.createElement("div");
		frame.className = "ins-md__table";
		table.replaceWith(frame);
		frame.append(table);
	}
}

/**
 * Render markdown to sanitised HTML plus its heading outline. Fenced code is highlighted unless the
 * source is over the highlighting ceiling; a grammar that fails to load leaves its block plain.
 */
export async function renderMarkdown(source: string): Promise<RenderedMarkdown> {
	const raw = parser.parse(source, { async: false });
	const fragment = sanitizer().sanitize(raw, { ...PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });
	if (source.length <= INSPECT_TEXT_LIMITS.highlightBytes) await highlightBlocks(fragment);
	const headings = anchorHeadings(fragment);
	wrapTables(fragment);
	const host = document.createElement("div");
	host.append(fragment);
	return { html: host.innerHTML, headings };
}
// #endregion
