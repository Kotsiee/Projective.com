/**
 * `quill-runtime` — the Quill build this editor actually uses, assembled by hand.
 *
 * **Never import this module statically.** Quill reads `document` while it EVALUATES
 * (`core/emitter.js` builds its DOM event table at module scope), so a static import anywhere in a
 * module the SSR pass can reach throws `ReferenceError: document is not defined` and, because Fresh's
 * server snapshot does `import * as` over every island, takes the whole app down rather than one page.
 * {@link ../core/quill-loader.ts | `quill-loader`} is the only permitted entry, and it is a dynamic
 * import. This file is what that import resolves to, which is also why it is a MODULE rather than a
 * function: one dynamic import of one module gives Rollup exactly one chunk to emit, where eight
 * parallel dynamic imports would give it eight.
 *
 * ## Why `quill/core` and not `quill`
 *
 * The package's default entry is a convenience bundle. Its final act is one
 * `Quill.register({ ...twenty-nine things... }, true)` — and because that call is a side effect whose
 * arguments are all live references, no bundler may drop any of them. Importing `quill` therefore
 * ships the `snow` AND `bubble` themes, the picker / colour-picker / icon-picker / tooltip UI, the
 * syntax-highlighting and table modules, KaTeX formula support, and image, video, link, code, script,
 * align, direction, indent, blockquote, colour, background, font and size formats — every one of
 * which this component already forbids in `ALLOWED_FORMATS`, and whose themes it explicitly declines
 * in favour of its own token-driven stylesheet.
 *
 * `quill/core` is the same editor with an empty format registry, so the list below is the whole
 * inventory. Measured on this dependency tree, minified: **205 KB → 159 KB (60 KB → 47 KB gzipped)**.
 * The saving is not the point on its own — the point is that the bytes now correspond one-to-one with
 * the toolbar, so the two cannot drift.
 *
 * Adding a toolbar button therefore takes two edits: the `ToolButton` entry and a line here. That is
 * deliberate. A format registered but not offered is dead weight; a format offered but not registered
 * is a button that does nothing, which this repo grades as a defect of the same class as a broken
 * link (root `CLAUDE.md` §3 gate 11).
 */
import Quill from "quill/core";
import Bold from "quill/formats/bold";
import Italic from "quill/formats/italic";
import Underline from "quill/formats/underline";
import Strike from "quill/formats/strike";
import Header from "quill/formats/header";
import List from "quill/formats/list";
import Toolbar from "quill/modules/toolbar";

/**
 * Registers this editor's formats and returns the configured class.
 *
 * A FUNCTION whose result is the default export, rather than a bare top-level `Quill.register(...)`
 * followed by `export default Quill`, and the difference is load-bearing. `vite.config.ts` declares
 * every non-CSS module under `packages/ui` side-effect free so a barrel import does not drag forty
 * components and their stylesheets into a page that uses one — which means Rollup is explicitly told
 * it may discard top-level statements here. Making the registration part of the exported binding's
 * initialiser puts it beyond that: the export IS used, so the call cannot be dropped without dropping
 * the class itself. A dropped registration would not fail the build or the type-checker — it would
 * ship a toolbar whose buttons quietly do nothing, which is the failure this arrangement forecloses.
 *
 * Keys and the trailing `true` (overwrite) mirror `quill.js`'s own registration block verbatim, so a
 * blot resolves under exactly the name the full build would have given it. `formats/list` needs no
 * companion entry for its container: `List.register()` registers `ListContainer` itself.
 *
 * Everything a functional editor needs beyond formats — Clipboard (which `dangerouslyPasteHTML` and
 * the constructor's own initial-content path both run through), Keyboard, History, Input, Uploader,
 * UINode and the block/inline/text/cursor/break/container/embed/scroll blots — is already registered
 * by `quill/core` itself.
 */
function configureQuill(): typeof Quill {
	Quill.register({
		"formats/bold": Bold,
		"formats/italic": Italic,
		"formats/underline": Underline,
		"formats/strike": Strike,
		"formats/header": Header,
		"formats/list": List,
		"modules/toolbar": Toolbar,
	}, true);
	return Quill;
}

export default configureQuill();
