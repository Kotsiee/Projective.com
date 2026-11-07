import { INERT_NAMESPACES, SVG_ATTRIBUTES, SVG_ELEMENTS } from "./svg-allowlist.ts";

/**
 * svg-sanitize — an uploaded SVG made safe to keep and to show, on the server, where a client cannot
 * skip it (Decision #396). An SVG is a program in a picture's clothes: script, event handlers, embedded
 * HTML and remote references all run or load if it is ever opened as a document.
 *
 * The media proxy already serves it inert (a sandbox CSP, `nosniff`, an attachment) and the app only
 * ever draws it through `<img>`, where script cannot run. This is the layer beneath those, and the one
 * that travels: the file somebody downloads and opens, or drops into their own site, is clean too.
 *
 * ## How it works, and why not with patterns
 *
 * Pattern-matching markup is how sanitisers get bypassed, so this is a strict XML tokenizer that
 * resolves namespaces the way a browser does: `<x:script xmlns:x="…/svg">` is a script here, under any
 * prefix, and `&#106;avascript:` is checked after decoding. Then, an **allowlist**:
 *
 * - A file with nothing active keeps its **exact bytes**, so an editor's metadata and comments survive
 *   and a designer's file is not touched for being a designer's file. Every element is judged, under
 *   a dropped parent as much as anywhere: an SVG script nested in an editor's element still runs.
 * - A file with anything active is **rebuilt** from what the allowlist admits. The output is generated
 *   rather than edited, so whatever the tokenizer did not name simply is not in it.
 * - A file that is not well-formed, not UTF-8, or that declares its own entities is **refused**: a
 *   browser's parser and this one must agree on what the bytes mean, and there is no agreeing on
 *   bytes that do not parse. Declared entities are also how an XML bomb is built.
 */

// #region Contract
/** The outcome for one file. `removed` says what went, in words, for the person who uploaded it. */
export type SvgVerdict =
	| { ok: true; changed: false; bytes: Uint8Array }
	| { ok: true; changed: true; bytes: Uint8Array; removed: string[] }
	| { ok: false; reason: string };

/** Above this a file is refused: the check has to hold the whole document. */
export const MAX_SVG_BYTES = 16 * 1024 * 1024;

const UNREADABLE =
	"This SVG couldn't be checked, so it wasn't uploaded. Export it again and retry.";
const TOO_LARGE = "This SVG is too large to check, so it wasn't uploaded.";
const NOT_SVG = "This file isn't an SVG, though its name says it is.";
// #endregion

// #region Names
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

const NAME = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;
const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]*$/i;
const DTD_SYSTEM = /^https?:\/\/www\.w3\.org\//;
const ACTIVE_CSS =
	/@import|expression\s*\(|javascript:|vbscript:|behaviou?r\s*:|-moz-binding|image-set|cross-fade/i;

/** Elements whose `href` may point at more than a fragment of this file. */
const IMAGE_ELEMENTS = new Set(["image", "feImage"]);
/** SMIL may animate anything it can name, so it must not name a link or a handler. */
const ANIMATIONS = new Set(["animate", "animateMotion", "animateTransform"]);
// #endregion

// #region Refusal
class Refused extends Error {
	constructor(readonly reason: string) {
		super(reason);
	}
}

const malformed = (): never => {
	throw new Refused(UNREADABLE);
};
// #endregion

// #region Text
const ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

/** Decode XML references. A named entity beyond XML's five could only come from a declaration. */
function decodeXml(raw: string): string {
	return raw.replace(/&([^;&\s]*)(;?)/g, (_, name: string, end: string) => {
		if (!end) return malformed();
		if (name[0] !== "#") return ENTITIES[name] ?? malformed();
		const hex = name[1] === "x";
		const digits = name.slice(hex ? 2 : 1);
		if (!(hex ? /^[0-9a-f]+$/i : /^\d+$/).test(digits)) return malformed();
		const code = parseInt(digits, hex ? 16 : 10);
		const legal = code === 9 || code === 10 || code === 13 ||
			(code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0x10ffff && code !== 0xfffe &&
				code !== 0xffff);
		return legal ? String.fromCodePoint(code) : malformed();
	});
}

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** A URL as a browser reads it: controls and whitespace inside a scheme do not stop it working. */
function bare(value: string): string {
	let out = "";
	for (const char of value) if (char.charCodeAt(0) > 0x20 && char !== "\x7f") out += char;
	return out;
}

/** Every `url(…)` in a value points inside this file. */
function urlsAreLocal(value: string): boolean {
	for (const match of value.matchAll(/url\(\s*(['"]?)([^)]*)/gi)) {
		if (!bare(match[2]).startsWith("#")) return false;
	}
	return true;
}

function cssIsSafe(css: string): boolean {
	// CSS escapes can spell `url(` and `@import` in ways no pattern here should have to enumerate, and
	// nothing an editor exports needs one. `<` is markup waiting for a parser that reads this as tags.
	if (css.includes("\\") || css.includes("<")) return false;
	const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
	return !ACTIVE_CSS.test(plain) && urlsAreLocal(plain);
}
// #endregion

// #region Tokenizer
interface RawAttribute {
	name: string;
	value: string;
}

interface OpenTag {
	name: string;
	attributes: RawAttribute[];
	selfClosing: boolean;
	end: number;
}

function skipSpace(text: string, from: number): number {
	let at = from;
	while (at < text.length && /\s/.test(text[at])) at++;
	return at;
}

function readOpenTag(text: string, from: number): OpenTag {
	let at = from + 1;
	while (at < text.length && !/[\s/>]/.test(text[at])) at++;
	const name = text.slice(from + 1, at);
	if (!NAME.test(name)) malformed();

	const attributes: RawAttribute[] = [];
	const seen = new Set<string>();
	while (true) {
		const before = at;
		at = skipSpace(text, at);
		if (at >= text.length) malformed();
		if (text[at] === ">") return { name, attributes, selfClosing: false, end: at + 1 };
		if (text.startsWith("/>", at)) return { name, attributes, selfClosing: true, end: at + 2 };
		if (at === before) malformed();

		const equals = text.indexOf("=", at);
		if (equals < 0) malformed();
		const attribute = text.slice(at, equals).trim();
		if (!NAME.test(attribute) || seen.has(attribute)) malformed();
		seen.add(attribute);
		at = skipSpace(text, equals + 1);
		const quote = text[at];
		if (quote !== '"' && quote !== "'") malformed();
		const close = text.indexOf(quote, at + 1);
		if (close < 0) malformed();
		const raw = text.slice(at + 1, close);
		if (raw.includes("<")) malformed();
		attributes.push({ name: attribute, value: decodeXml(raw) });
		at = close + 1;
	}
}

/**
 * The end of a `<!DOCTYPE …>`, reading its quoted identifiers as quoted so a `>` in one does not end
 * it early. An internal subset is refused here: it is where entities and their bombs are declared.
 */
function doctypeEnd(text: string, from: number): number {
	let quote = "";
	for (let at = from; at < text.length; at++) {
		const char = text[at];
		if (quote) quote = char === quote ? "" : quote;
		else if (char === '"' || char === "'") quote = char;
		else if (char === "[") malformed();
		else if (char === ">") return at;
	}
	return malformed();
}

/** A prologue's `<?xml … ?>`: its encoding has to be the one the bytes were just decoded as. */
function checkDeclaration(body: string): void {
	const encoding = /encoding\s*=\s*["']([^"']*)["']/i.exec(body)?.[1]?.toLowerCase();
	if (encoding && encoding !== "utf-8" && encoding !== "utf8" && encoding !== "us-ascii") {
		malformed();
	}
}
// #endregion

// #region Sanitiser
type Scope = ReadonlyMap<string, string>;

interface Frame {
	/** The name as written, for matching its close tag. */
	raw: string;
	scope: Scope;
	/** Written to a rebuilt file. Everything is judged either way; this only decides the output. */
	written: boolean;
	/** A `<style>`, in or out of the rebuild: its text is CSS, held so it can be judged whole. */
	css: boolean;
	cssText: string;
}

function resolve(name: string, scope: Scope): { ns: string; local: string; prefix: string | null } {
	const colon = name.indexOf(":");
	if (colon < 0) return { ns: scope.get("") ?? "", local: name, prefix: null };
	const prefix = name.slice(0, colon);
	const ns = prefix === "xml" ? XML_NS : scope.get(prefix);
	if (ns === undefined) return malformed();
	return { ns, local: name.slice(colon + 1), prefix };
}

class Walker {
	readonly removed = new Set<string>();
	readonly out: string[] = [];
	readonly stack: Frame[] = [];
	rootSeen = false;

	private note(what: string): void {
		this.removed.add(what);
	}

	/** A reference is safe for this element, or it is noted and dropped. */
	private hrefAllowed(element: string, value: string): boolean {
		const target = bare(value);
		if (target.startsWith("#")) return true;
		if (IMAGE_ELEMENTS.has(element) && SAFE_DATA_IMAGE.test(value.trim())) return true;
		if (element === "a" && SAFE_LINK.test(target)) return true;
		this.note(
			/^(javascript|vbscript|data):/i.test(target) ? "script links" : "external references",
		);
		return false;
	}

	/** Bind this tag's `xmlns` declarations over the scope around it. */
	private scopeOf(tag: OpenTag, parent: Scope): Scope {
		let scope = parent;
		for (const { name, value } of tag.attributes) {
			if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
			const prefix = name === "xmlns" ? "" : name.slice(6);
			if (prefix === "xml" || prefix === "xmlns" || value === XMLNS_NS) malformed();
			if (scope === parent) scope = new Map(parent);
			(scope as Map<string, string>).set(prefix, value);
		}
		return scope;
	}

	/** Judge an SVG element's attributes: what a rebuild writes, or null to drop the element. */
	private keepAttributes(element: string, tag: OpenTag, scope: Scope): string | null {
		let written = "";
		for (const { name, value } of tag.attributes) {
			if (name === "xmlns" || name.startsWith("xmlns:")) continue;
			const attribute = resolve(name, new Map([...scope, ["", ""]]));
			const local = attribute.local;
			if (attribute.ns === XML_NS) {
				// `xml:base` above all goes: it re-points every `#fragment` link at another document.
				if (local === "space" || local === "lang") written += ` xml:${local}="${escapeXml(value)}"`;
				else this.note("external references");
				continue;
			}
			if (attribute.ns === XLINK_NS) {
				if (local === "href" && this.hrefAllowed(element, value)) {
					written += ` xlink:href="${escapeXml(value)}"`;
				} else if (local !== "href" && !["title", "type", "role"].includes(local)) {
					this.note("link behaviour");
				}
				continue;
			}
			if (attribute.ns !== "") {
				if (!INERT_NAMESPACES.has(attribute.ns)) this.note("foreign attributes");
				continue;
			}
			if (/^on/i.test(local)) {
				this.note("event handlers");
				continue;
			}
			if (!SVG_ATTRIBUTES.has(local)) {
				this.note("unknown attributes");
				continue;
			}
			if (local === "href" && !this.hrefAllowed(element, value)) continue;
			if (local === "style" && !cssIsSafe(value)) {
				this.note("active styles");
				continue;
			}
			if (local !== "style" && !urlsAreLocal(value)) {
				this.note("external references");
				continue;
			}
			if (ANIMATIONS.has(element) && local === "attributeName" && !this.animatable(value)) {
				return null;
			}
			written += ` ${local}="${escapeXml(value)}"`;
		}
		return written;
	}

	private animatable(target: string): boolean {
		const name = bare(target).toLowerCase();
		const safe = !name.endsWith("href") && !name.startsWith("on") && name !== "style";
		if (!safe) this.note("animated links");
		return safe;
	}

	open(tag: OpenTag): void {
		const parent = this.stack.at(-1);
		const outer: Scope = parent?.scope ?? new Map();
		const scope = this.scopeOf(tag, outer);
		const { ns, local } = resolve(tag.name, scope);

		if (!parent) {
			if (this.rootSeen || ns !== SVG_NS || local !== "svg") throw new Refused(NOT_SVG);
			this.rootSeen = true;
		}

		const inSvg = ns === SVG_NS;
		const known = inSvg && SVG_ELEMENTS.has(local);
		if (inSvg && !known) {
			this.note(
				local === "script"
					? "scripts"
					: local === "foreignObject"
					? "embedded HTML"
					: `<${local}> elements`,
			);
		} else if (!inSvg && !INERT_NAMESPACES.has(ns)) {
			// An editor's namespace is inert; anything else, XHTML above all, is treated as active.
			this.note("embedded HTML");
		}
		if (!inSvg && tag.attributes.some((attribute) => /^on/i.test(attribute.name))) {
			this.note("event handlers");
		}

		const attributes = inSvg ? this.keepAttributes(local, tag, scope) : null;
		const written = (parent?.written ?? true) && known && attributes !== null;
		if (written) {
			const root = parent ? "" : ` xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"`;
			this.out.push(`<${local}${root}${attributes}${tag.selfClosing ? "/" : ""}>`);
		}
		if (tag.selfClosing) return;
		const css = inSvg && local === "style";
		this.stack.push({ raw: tag.name, scope, written, css, cssText: "" });
	}

	close(name: string): void {
		const frame = this.stack.pop();
		if (!frame || frame.raw !== name) malformed();
		const closing = frame as Frame;
		const safeCss = !closing.css || cssIsSafe(closing.cssText);
		if (!safeCss) this.note("active styles");
		if (!closing.written) return;
		if (closing.css && safeCss) this.out.push(escapeXml(closing.cssText));
		this.out.push(`</${resolve(name, closing.scope).local}>`);
	}

	text(raw: string, cdata: boolean): void {
		const frame = this.stack.at(-1);
		const value = cdata ? raw : decodeXml(raw);
		if (!frame) {
			if (value.trim().length > 0) malformed();
			return;
		}
		if (frame.css) frame.cssText += value;
		else if (frame.written) this.out.push(escapeXml(value));
	}
}

/**
 * A comment or CDATA section that holds markup. XML reads it as inert, but HTML's parser disagrees
 * about where some of them end (`<!-->` is a whole comment there), so a file kept verbatim could turn
 * live the day somebody pastes it into a page. A rebuild drops the comment and escapes the text.
 */
function hidesMarkup(body: string): boolean {
	return body.includes("<") || body.startsWith(">") || body.startsWith("->");
}

function walk(text: string): Walker {
	const walker = new Walker();
	let at = 0;
	while (at < text.length) {
		const lt = text.indexOf("<", at);
		if (lt < 0) {
			walker.text(text.slice(at), false);
			break;
		}
		if (lt > at) walker.text(text.slice(at, lt), false);

		if (text.startsWith("<!--", lt)) {
			const end = text.indexOf("-->", lt + 4);
			const body = text.slice(lt + 4, end);
			if (end < 0 || body.includes("--")) malformed();
			if (hidesMarkup(body)) walker.removed.add("hidden markup");
			at = end + 3;
		} else if (text.startsWith("<![CDATA[", lt)) {
			const end = text.indexOf("]]>", lt + 9);
			if (end < 0) malformed();
			const body = text.slice(lt + 9, end);
			if (hidesMarkup(body)) walker.removed.add("hidden markup");
			walker.text(body, true);
			at = end + 3;
		} else if (text.startsWith("<?", lt)) {
			const end = text.indexOf("?>", lt + 2);
			if (end < 0) malformed();
			const body = text.slice(lt + 2, end);
			if (/^xml\s/i.test(body)) checkDeclaration(body);
			else walker.removed.add("processing instructions");
			at = end + 2;
		} else if (text.startsWith("<!", lt)) {
			const end = doctypeEnd(text, lt + 2);
			const body = text.slice(lt + 2, end);
			if (!/^DOCTYPE\b/.test(body)) malformed();
			const system = /["'](https?:[^"']*)["']\s*$/.exec(body)?.[1];
			if (system && !DTD_SYSTEM.test(system)) walker.removed.add("external references");
			at = end + 1;
		} else if (text.startsWith("</", lt)) {
			const end = text.indexOf(">", lt);
			if (end < 0) malformed();
			walker.close(text.slice(lt + 2, end).trim());
			at = end + 1;
		} else {
			const tag = readOpenTag(text, lt);
			walker.open(tag);
			at = tag.end;
		}
	}
	if (walker.stack.length > 0) malformed();
	if (!walker.rootSeen) throw new Refused(NOT_SVG);
	return walker;
}

/** Check one SVG. Never throws: a refusal is a value, with the sentence to show. */
export function sanitizeSvg(bytes: Uint8Array): SvgVerdict {
	if (bytes.byteLength > MAX_SVG_BYTES) return { ok: false, reason: TOO_LARGE };
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		const walker = walk(text);
		if (walker.removed.size === 0) return { ok: true, changed: false, bytes };
		return {
			ok: true,
			changed: true,
			bytes: new TextEncoder().encode(walker.out.join("")),
			removed: [...walker.removed],
		};
	} catch (error) {
		if (error instanceof Refused) return { ok: false, reason: error.reason };
		if (error instanceof TypeError) return { ok: false, reason: UNREADABLE };
		throw error;
	}
}
// #endregion
