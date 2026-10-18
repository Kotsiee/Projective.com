/**
 * island-graph — the islands a server-rendered module puts on a page, read from source.
 *
 * Fresh ships an island only when the server render meets it (`FreshRuntimeScript` imports exactly
 * the islands a render encountered), so a page's islands are the island modules reachable from its
 * server components through static imports, without entering an island: an island's own imports
 * are bundled into its chunk, and the client manifest already describes those. The initial-JS
 * budget (`js-budget.ts`) declares a page's islands by hand; this walk is the test that keeps that
 * declaration honest.
 *
 * Source-level and deliberately small. `import` and `export … from` statements are matched after
 * comments are blanked; `import type` and inline `type` specifiers are ignored; a named import from
 * a barrel is traced through its `export { … } from` and `export * from` lines to the module that
 * defines it; and a module is walked whole once anything it defines is used. Specifiers that are not
 * workspace paths (npm, jsr) are outside the app and never render an island. The developer tools are
 * skipped: a production build strips their islands (`vite.config.ts` `isDevToolsIsland`).
 */

// #region Types
/** Reads a repository-relative path (forward slashes); `null` when there is no such file. */
export type SourceReader = (path: string) => string | null;

/**
 * Resolves `specifier`, imported by the repository-relative module `from`, to a repository-relative
 * path, or `null` for a module outside the workspace (npm, jsr, a URL).
 */
export type SpecifierResolver = (specifier: string, from: string) => string | null;

/** The workspace's local import map: root aliases and member packages. */
export interface WorkspaceMap {
	/** Root import-map entries with a local target, without the leading `./` (`"@features/"` → `"apps/web/features/"`). */
	aliases: Readonly<Record<string, string>>;
	/** Workspace packages: name, directory and `exports` map (sub-path → file, both without `./` on the file). */
	packages: ReadonlyArray<WorkspacePackage>;
}

/** One workspace member that other members import by name. */
export interface WorkspacePackage {
	/** The package name (`@projective/ui`). */
	name: string;
	/** Its directory, repository-relative (`packages/ui`). */
	dir: string;
	/** Its `exports`, keyed by sub-path (`"."`, `"./navigation"`). */
	exports: Readonly<Record<string, string>>;
}

/** The minimum of a `deno.json` this module reads. */
export interface DenoJson {
	name?: string;
	exports?: string | Record<string, string>;
	imports?: Record<string, string>;
	workspace?: string[];
}

/** A static `import` statement: the module, and whether all of it or only some names are used. */
interface ImportStatement {
	specifier: string;
	/** Source-side names of the named specifiers (`a` of `a as b`). */
	names: string[];
	/** A default, namespace or bare side-effect import: the module is used whole. */
	whole: boolean;
}

/** An `export … from` statement. */
interface ReExport {
	specifier: string;
	/** `export * from` (re-exports every name). */
	star: boolean;
	/** `export * as ns from`: the namespace's name. */
	namespace: string | null;
	/** `[source name, exported name]` pairs of `export { a as b } from`. */
	pairs: Array<[string, string]>;
}
// #endregion

// #region Path helpers
/** Joins a directory and a relative path, folding `.` and `..`, with forward slashes. */
export function joinPath(dir: string, relative: string): string {
	const out: string[] = [];
	for (const part of `${dir}/${relative}`.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return out.join("/");
}

/** The directory part of a repository-relative path. */
function dirname(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut === -1 ? "" : path.slice(0, cut);
}

/** True for a module Vite registers as an island: any non-test script under an `islands/` directory. */
export function isIslandPath(path: string): boolean {
	return path.includes("/islands/") && isScriptPath(path) && !/\.test\.[jt]sx?$/.test(path);
}

/** True for a JavaScript or TypeScript module (not a stylesheet, JSON or asset). */
function isScriptPath(path: string): boolean {
	return /\.[jt]sx?$/.test(path);
}

/** True for the developer tools, which production builds strip. */
function isDevToolsPath(path: string): boolean {
	return path.includes("/features/devtools/");
}
// #endregion

// #region Resolution
/**
 * The {@link WorkspaceMap} of a Deno workspace: the root `deno.json`'s local aliases, and each
 * member's name and `exports`.
 *
 * @param root The root `deno.json`.
 * @param members Each workspace member's directory (as listed in `workspace`) and its `deno.json`.
 */
export function workspaceMapFrom(
	root: DenoJson,
	members: ReadonlyArray<{ dir: string; json: DenoJson }>,
): WorkspaceMap {
	const aliases: Record<string, string> = {};
	for (const [key, target] of Object.entries(root.imports ?? {})) {
		if (target.startsWith("./")) aliases[key] = target.slice(2);
	}
	const packages: WorkspacePackage[] = [];
	for (const { dir, json } of members) {
		if (!json.name || json.exports === undefined) continue;
		const raw = typeof json.exports === "string" ? { ".": json.exports } : json.exports;
		const exports: Record<string, string> = {};
		for (const [sub, file] of Object.entries(raw)) exports[sub] = file.replace(/^\.\//, "");
		packages.push({ name: json.name, dir: dir.replace(/^\.\//, "").replace(/\/$/, ""), exports });
	}
	return { aliases, packages };
}

/**
 * A {@link SpecifierResolver} over a {@link WorkspaceMap}, with Deno import-map semantics: a
 * relative specifier joins its importer's directory; an exact alias wins over a prefix alias, and
 * the longest prefix wins among those; a package name or `name/sub` maps through the package's
 * `exports`. Everything else resolves to `null`.
 */
export function createResolver(map: WorkspaceMap): SpecifierResolver {
	const prefixes = Object.keys(map.aliases)
		.filter((key) => key.endsWith("/"))
		.sort((a, b) => b.length - a.length);

	return (specifier, from) => {
		if (specifier.startsWith("./") || specifier.startsWith("../")) {
			return joinPath(dirname(from), specifier);
		}
		const exact = map.aliases[specifier];
		if (exact !== undefined && !specifier.endsWith("/")) return joinPath("", exact);
		const prefix = prefixes.find((key) => specifier.startsWith(key));
		if (prefix !== undefined) {
			return joinPath(map.aliases[prefix], specifier.slice(prefix.length));
		}
		for (const pkg of map.packages) {
			if (specifier !== pkg.name && !specifier.startsWith(`${pkg.name}/`)) continue;
			const sub = specifier === pkg.name ? "." : `.${specifier.slice(pkg.name.length)}`;
			const file = pkg.exports[sub];
			return file === undefined ? null : joinPath(pkg.dir, file);
		}
		return null;
	};
}
// #endregion

// #region Parsing
/**
 * Blanks every comment in a script, skipping string and template literals so a `//` inside one (a
 * URL) is not read as a comment. Line breaks survive, so offsets keep their line.
 */
export function blankComments(src: string): string {
	let out = "";
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		const next = src[i + 1];
		if (ch === "/" && (next === "/" || next === "*")) {
			const close = next === "*" ? src.indexOf("*/", i + 2) : src.indexOf("\n", i);
			const end = close === -1 ? src.length : next === "*" ? close + 2 : close;
			out += src.slice(i, end).replace(/[^\n]/g, " ");
			i = end;
		} else if (ch === '"' || ch === "'" || ch === "`") {
			let j = i + 1;
			while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
			out += src.slice(i, j + 1);
			i = j + 1;
		} else {
			out += ch;
			i++;
		}
	}
	return out;
}

/** `import [type] <clause> from "<specifier>"`, where the clause is a default, a namespace, a brace list, or a default plus either. */
const IMPORT_FROM_RE =
	/\bimport\s+(type\s+)?([\w$]+\s*,\s*\{[^{}]*\}|[\w$]+\s*,\s*\*\s*as\s+[\w$]+|\{[^{}]*\}|\*\s*as\s+[\w$]+|[\w$]+)\s*from\s*(["'])([^"']+)\3/g;

/** `import "<specifier>"` — a bare side-effect import. */
const IMPORT_BARE_RE = /\bimport\s*(["'])([^"']+)\1/g;

/** `export [type] <* | * as ns | { … }> from "<specifier>"`. */
const EXPORT_FROM_RE =
	/\bexport\s+(type\s+)?(\*\s*as\s+[\w$]+|\*|\{[^{}]*\})\s*from\s*(["'])([^"']+)\3/g;

/** `export [default] <declaration> <name>`. */
const EXPORT_DECLARATION_RE =
	/\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|enum|interface|type|namespace)\s+([\w$]+)/g;

/** `export { … }` with no `from` — a local export list. */
const EXPORT_LIST_RE = /\bexport\s*\{([^{}]*)\}(?!\s*from)/g;

/** The `[source, local]` pairs of a brace list, inline `type` items dropped. */
function braceItems(list: string): Array<[string, string]> {
	const items: Array<[string, string]> = [];
	for (const raw of list.replace(/^\{|\}$/g, "").split(",")) {
		const item = raw.trim();
		if (item === "" || /^type\s/.test(item)) continue;
		const [source, alias] = item.split(/\s+as\s+/);
		items.push([source.trim(), (alias ?? source).trim()]);
	}
	return items;
}

/** Every static, non-type import of a script (comments blanked first). */
export function parseImports(src: string): ImportStatement[] {
	const code = blankComments(src);
	const statements: ImportStatement[] = [];
	for (const match of code.matchAll(IMPORT_FROM_RE)) {
		if (match[1]) continue;
		const clause = match[2];
		const brace = clause.indexOf("{");
		const names = brace === -1 ? [] : braceItems(clause.slice(brace)).map(([source]) => source);
		const head = brace === -1 ? clause : clause.slice(0, brace);
		const whole = /[\w$*]/.test(head.replace(/,\s*$/, ""));
		if (!whole && names.length === 0) continue;
		statements.push({ specifier: match[4], names, whole });
	}
	for (const match of code.matchAll(IMPORT_BARE_RE)) {
		statements.push({ specifier: match[2], names: [], whole: true });
	}
	return statements;
}

/** Every non-type `export … from` of a script. */
function parseReExports(code: string): ReExport[] {
	const out: ReExport[] = [];
	for (const match of code.matchAll(EXPORT_FROM_RE)) {
		if (match[1]) continue;
		const clause = match[2];
		const namespace = /^\*\s*as\s+([\w$]+)$/.exec(clause)?.[1] ?? null;
		out.push({
			specifier: match[4],
			star: clause === "*",
			namespace,
			pairs: clause.startsWith("{") ? braceItems(clause) : [],
		});
	}
	return out;
}

/** The names a script exports from its own declarations and local export lists. */
function localExports(code: string): Set<string> {
	const names = new Set<string>();
	for (const match of code.matchAll(EXPORT_DECLARATION_RE)) names.add(match[1]);
	if (/\bexport\s+default\b/.test(code)) names.add("default");
	for (const match of code.matchAll(EXPORT_LIST_RE)) {
		for (const [, exported] of braceItems(match[1])) names.add(exported);
	}
	return names;
}
// #endregion

// #region Walk
/** What {@link islandsRenderedBy} needs to read and resolve modules. */
export interface WalkOptions {
	read: SourceReader;
	resolve: SpecifierResolver;
}

/**
 * The module that defines the export `name` of `file`, followed through re-exports, or `null` when
 * `file` does not export it.
 */
function definerOf(
	file: string,
	name: string,
	options: WalkOptions,
	seen: Set<string>,
): string | null {
	const key = `${file}#${name}`;
	if (seen.has(key)) return null;
	seen.add(key);

	const src = options.read(file);
	if (src === null) return null;
	const code = blankComments(src);
	const reExports = parseReExports(code);

	for (const re of reExports) {
		const pair = re.pairs.find(([, exported]) => exported === name);
		if (!pair && re.namespace !== name) continue;
		const target = options.resolve(re.specifier, file);
		if (target === null) return null;
		return pair ? definerOf(target, pair[0], options, seen) ?? target : target;
	}
	if (localExports(code).has(name)) return file;
	for (const re of reExports) {
		if (!re.star) continue;
		const target = options.resolve(re.specifier, file);
		if (target === null) continue;
		const found = definerOf(target, name, options, seen);
		if (found !== null) return found;
	}
	return null;
}

/**
 * The islands the server render of `roots` can meet: every island module reachable from them
 * through static imports of server modules, sorted, repository-relative.
 *
 * @param roots Repository-relative server modules (a page controller, a shell component).
 * @throws When a root cannot be read.
 */
export function islandsRenderedBy(roots: readonly string[], options: WalkOptions): string[] {
	const islands = new Set<string>();
	const walked = new Set<string>();

	const use = (path: string): void => {
		if (isDevToolsPath(path) || !isScriptPath(path)) return;
		if (isIslandPath(path)) islands.add(path);
		else walk(path);
	};

	const walk = (file: string): void => {
		if (walked.has(file)) return;
		walked.add(file);
		const src = options.read(file);
		if (src === null) return;
		for (const statement of parseImports(src)) {
			const target = options.resolve(statement.specifier, file);
			if (target === null) continue;
			if (statement.whole || isIslandPath(target)) use(target);
			if (isIslandPath(target)) continue;
			for (const name of statement.names) {
				use(definerOf(target, name, options, new Set()) ?? target);
			}
		}
	};

	for (const root of roots) {
		if (options.read(root) === null) throw new Error(`island-graph: cannot read root ${root}`);
		walk(root);
	}
	return [...islands].sort();
}

/**
 * The islands `file` imports directly (one level, no walk) — for a module that renders different
 * islands on different branches, where only the branch's own list can say which apply.
 */
export function islandsImportedBy(file: string, options: WalkOptions): string[] {
	const src = options.read(file);
	if (src === null) throw new Error(`island-graph: cannot read ${file}`);
	const found = new Set<string>();
	for (const statement of parseImports(src)) {
		const target = options.resolve(statement.specifier, file);
		if (target !== null && isIslandPath(target) && !isDevToolsPath(target)) found.add(target);
	}
	return [...found].sort();
}
// #endregion
