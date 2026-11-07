import { assert, assertEquals, assertFalse } from "@std/assert";
import { MAX_SVG_BYTES, sanitizeSvg } from "./svg-sanitize.ts";

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const INK = 'xmlns:ink="http://www.inkscape.org/namespaces/inkscape"';

/** Sanitise, and answer the output as text; fails the test when the file was refused. */
function clean(svg: string): { text: string; changed: boolean; removed: string[] } {
	const verdict = sanitizeSvg(encode(svg));
	if (!verdict.ok) throw new Error(`refused: ${verdict.reason}`);
	return {
		text: decode(verdict.bytes),
		changed: verdict.changed,
		removed: verdict.changed ? verdict.removed : [],
	};
}

function refused(svg: string | Uint8Array): boolean {
	return !sanitizeSvg(typeof svg === "string" ? encode(svg) : svg).ok;
}

/** Nothing a browser could execute survives, however the input spelled it. */
function assertInert(text: string): void {
	const lower = text.toLowerCase();
	for (
		const banned of ["<script", "javascript:", "vbscript:", "foreignobject", "<iframe", "<!entity"]
	) {
		assertFalse(lower.includes(banned), `found ${banned} in ${text}`);
	}
	assertFalse(/\son\w+\s*=/i.test(text), `found a handler in ${text}`);
}

// #region What must not change
Deno.test("a clean file keeps its exact bytes", () => {
	const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Exported by a real editor -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg ${XMLNS} ${XLINK} viewBox="0 0 24 24" width='24' height="24">
	<defs>
		<linearGradient id="a"><stop offset="0" stop-color="#fff"/></linearGradient>
		<clipPath id="c"><rect width="10" height="10"/></clipPath>
	</defs>
	<style>.x { fill: url(#a); opacity: .5 }</style>
	<g class="x" clip-path="url(#c)" style="stroke: red">
		<path d="M0 0h24v24H0z" fill="url(#a)"/>
		<use xlink:href="#c" href="#c"/>
		<text x="1" y="2">Tom &amp; Jerry</text>
	</g>
</svg>`;
	const bytes = encode(svg);
	const verdict = sanitizeSvg(bytes);
	assert(verdict.ok && !verdict.changed);
	assertEquals(verdict.bytes, bytes);
});

Deno.test("an editor's own namespaces are inert, so its layers survive", () => {
	const svg = `<svg ${XMLNS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
		xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">
		<sodipodi:namedview id="n"/><g inkscape:label="Layer 1" inkscape:groupmode="layer"/></svg>`;
	assertEquals(clean(svg).changed, false);
});

Deno.test("embedded raster pictures and ordinary links stay", () => {
	const svg = `<svg ${XMLNS} ${XLINK}><image href="data:image/png;base64,iVBORw0KGgo="/>
		<image xlink:href="data:image/jpeg;base64,/9j/4AAQ"/>
		<a href="https://example.com/x"><rect/></a><a href="mailto:a@b.c"><rect/></a></svg>`;
	assertEquals(clean(svg).changed, false);
});

Deno.test("a harmless animation stays", () => {
	const svg =
		`<svg ${XMLNS}><rect><animate attributeName="x" from="0" to="9" dur="1s"/></rect></svg>`;
	assertEquals(clean(svg).changed, false);
});
// #endregion

// #region Attacks
const ATTACKS: Readonly<Record<string, string>> = {
	"a script": `<svg ${XMLNS}><script>alert(1)</script><rect/></svg>`,
	"a script in CDATA": `<svg ${XMLNS}><script><![CDATA[alert(1)]]></script></svg>`,
	"a self-closed script": `<svg ${XMLNS}><script href="https://evil.example/x.js"/></svg>`,
	"a script under a prefix":
		`<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script></s:svg>`,
	"an XHTML script":
		`<svg ${XMLNS}><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script></svg>`,
	"a default namespace rebound":
		`<svg ${XMLNS}><div xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></div></svg>`,
	"a handler on the root": `<svg ${XMLNS} onload="alert(1)"><rect/></svg>`,
	"a handler in odd case": `<svg ${XMLNS}><rect ONCLICK="alert(1)" oNmOuSeOvEr='alert(1)'/></svg>`,
	"embedded HTML":
		`<svg ${XMLNS}><foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert(1)"/></foreignObject></svg>`,
	"a script link": `<svg ${XMLNS}><a href="javascript:alert(1)"><text>x</text></a></svg>`,
	"a script link in xlink":
		`<svg ${XMLNS} ${XLINK}><a xlink:href="javascript:alert(1)"><rect/></a></svg>`,
	"a script link with an entity":
		`<svg ${XMLNS}><a href="&#106;avascript:alert(1)"><rect/></a></svg>`,
	"a script link with a hex entity":
		`<svg ${XMLNS}><a href="java&#x73;cript:alert(1)"><rect/></a></svg>`,
	"a script link split by a tab":
		`<svg ${XMLNS}><a href="java&#9;script:alert(1)"><rect/></a></svg>`,
	"a script link after a newline":
		`<svg ${XMLNS}><a href="&#10; javascript:alert(1)"><rect/></a></svg>`,
	"a data link":
		`<svg ${XMLNS}><a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"><rect/></a></svg>`,
	"an animated link":
		`<svg ${XMLNS}><a><animate attributeName="href" values="javascript:alert(1)"/><rect/></a></svg>`,
	"an animated xlink":
		`<svg ${XMLNS} ${XLINK}><a><animate attributeName="xlink:href" to="javascript:alert(1)"/></a></svg>`,
	"a set element":
		`<svg ${XMLNS}><a><set attributeName="href" to="javascript:alert(1)"/></a></svg>`,
	"a remote use": `<svg ${XMLNS}><use href="https://evil.example/x.svg#a"/></svg>`,
	"a data use": `<svg ${XMLNS}><use href="data:image/svg+xml;base64,PHN2Zz4="/></svg>`,
	"a remote image": `<svg ${XMLNS}><image href="https://evil.example/track.png"/></svg>`,
	"a nested SVG image": `<svg ${XMLNS}><image href="data:image/svg+xml;base64,PHN2Zz4="/></svg>`,
	"a remote filter image":
		`<svg ${XMLNS}><filter><feImage href="https://evil.example/x"/></filter></svg>`,
	"a stylesheet instruction":
		`<?xml-stylesheet href="https://evil.example/x.xsl" type="text/xsl"?><svg ${XMLNS}/>`,
	"an import": `<svg ${XMLNS}><style>@import url(https://evil.example/x.css);</style></svg>`,
	"a remote fill in a style":
		`<svg ${XMLNS}><style>rect { fill: url(https://evil.example/x) }</style></svg>`,
	"an escaped import": `<svg ${XMLNS}><style>@\\69mport "https://evil.example/x";</style></svg>`,
	"a split url": `<svg ${XMLNS}><style>a{b:u/**/rl(https://evil.example)}</style></svg>`,
	"a remote fill attribute": `<svg ${XMLNS}><rect fill="url(https://evil.example/x)"/></svg>`,
	"a remote style attribute":
		`<svg ${XMLNS}><rect style="background:url('https://evil.example/x')"/></svg>`,
	"an expression": `<svg ${XMLNS}><rect style="width:expression(alert(1))"/></svg>`,
	"a remote DTD": `<!DOCTYPE svg SYSTEM "https://evil.example/x.dtd"><svg ${XMLNS}/>`,
	"an unknown element": `<svg ${XMLNS}><marquee>x</marquee></svg>`,
	"a script inside an editor's element":
		`<svg ${XMLNS} ${INK}><ink:x><script>alert(1)</script></ink:x></svg>`,
	"a prefixed script inside an editor's element":
		`<s:svg xmlns:s="http://www.w3.org/2000/svg" ${INK}><ink:x><s:script>alert(1)</s:script></ink:x></s:svg>`,
	"a handler inside an editor's element":
		`<svg ${XMLNS} ${INK}><ink:x><rect onclick="alert(1)"/></ink:x></svg>`,
	"a handler on an editor's element": `<svg ${XMLNS} ${INK}><ink:x onclick="alert(1)"/></svg>`,
	"a remote style inside an editor's element":
		`<svg ${XMLNS} ${INK}><ink:x><style>@import url(https://evil.example/x.css);</style></ink:x></svg>`,
	"a script under a dropped element":
		`<svg ${XMLNS}><marquee><script>alert(1)</script></marquee></svg>`,
	"a re-pointed document base":
		`<svg ${XMLNS} xml:base="https://evil.example/"><use href="#a"/></svg>`,
	"an XInclude":
		`<svg ${XMLNS}><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://evil.example/x"/></svg>`,
	"a remote DTD in single quotes":
		`<!DOCTYPE svg SYSTEM 'https://evil.example/x.dtd'><svg ${XMLNS}/>`,
	"a comment HTML ends early": `<svg ${XMLNS}><!--><script>alert(1)</script>--></svg>`,
	"a comment HTML ends earlier": `<svg ${XMLNS}><!---><script>alert(1)</script>--></svg>`,
	"a script hidden in a comment": `<svg ${XMLNS}><!-- <script>alert(1)</script> --></svg>`,
	"a script hidden in a style's CDATA":
		`<svg ${XMLNS}><style><![CDATA[</style><script>alert(1)</script>]]></style></svg>`,
	"a script hidden in a title's CDATA":
		`<svg ${XMLNS}><title><![CDATA[</title><script>alert(1)</script>]]></title></svg>`,
	"a tag spelled out in a style":
		`<svg ${XMLNS}><style>&lt;/style&gt;&lt;img src=x onerror=alert(1)&gt;</style></svg>`,
};

for (const [name, attack] of Object.entries(ATTACKS)) {
	Deno.test(`rebuilt without its active content: ${name}`, () => {
		const { text, changed, removed } = clean(attack);
		assert(changed, "the file should have been rewritten");
		assert(removed.length > 0);
		assertInert(text);
		assertFalse(text.includes("evil.example"), text);
		assert(text.startsWith("<svg "), text);
	});
}

const SCRIPT = `alert(1)`;
Deno.test("the rebuilt file keeps everything that was safe", () => {
	const { text } = clean(
		`<svg ${XMLNS} viewBox="0 0 9 9" onload="${SCRIPT}"><title>Logo</title><g fill="#f00"><script>${SCRIPT}</script><path d="M0 0"/></g></svg>`,
	);
	assert(text.includes('viewBox="0 0 9 9"'));
	assert(text.includes("<title>Logo</title>"));
	assert(text.includes('<g fill="#f00"><path d="M0 0"/></g>'));
});

Deno.test("a rebuilt file says what went, in words", () => {
	const { removed } = clean(`<svg ${XMLNS} onload="x"><script>x</script></svg>`);
	assertEquals(removed.sort(), ["event handlers", "scripts"]);
});

Deno.test("what a rebuild writes is escaped, so a value cannot break out of its quotes", () => {
	const { text } = clean(
		`<svg ${XMLNS} onload="x"><text id="&quot;&gt;&lt;script&gt;">&lt;script&gt;alert(1)&lt;/script&gt;</text></svg>`,
	);
	assertInert(text);
	assert(text.includes('id="&quot;&gt;&lt;script&gt;"'));
});

Deno.test("an SVG inside a dropped element goes with it", () => {
	const { text } = clean(
		`<svg ${XMLNS}><foreignObject><svg ${XMLNS}><script>x</script><rect id="inner"/></svg></foreignObject><rect id="outer"/></svg>`,
	);
	assertFalse(text.includes("inner"));
	assert(text.includes("outer"));
});
// #endregion

// #region Refusals
Deno.test("declared entities are refused, which stops an XML bomb and any external entity", () => {
	assert(
		refused(
			`<!DOCTYPE svg [<!ENTITY a "aaaaaaaa"><!ENTITY b "&a;&a;&a;">]><svg ${XMLNS}>&b;</svg>`,
		),
	);
	assert(
		refused(`<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg ${XMLNS}>&x;</svg>`),
	);
	assert(refused(`<svg ${XMLNS}>&undeclared;</svg>`));
	assert(refused(`<svg ${XMLNS} id="&undeclared;"/>`));
});

Deno.test("a quoted > cannot end a DOCTYPE early and hide the subset behind it", () => {
	assert(refused(`<!DOCTYPE svg SYSTEM "x>" [<!ENTITY a "b">]><svg ${XMLNS}>&a;</svg>`));
	assert(refused(`<!DOCTYPE svg SYSTEM "x><!--" [<!ENTITY a "b">]><svg ${XMLNS}/><!-- -->`));
});

Deno.test("what is not well-formed is refused rather than guessed at", () => {
	assert(refused(`<svg ${XMLNS}><rect></svg>`));
	assert(refused(`<svg ${XMLNS}></g></svg>`));
	assert(refused(`<svg ${XMLNS}`));
	assert(refused(`<svg ${XMLNS} width=10/>`));
	assert(refused(`<svg ${XMLNS} width="1" width="2"/>`));
	assert(refused(`<svg ${XMLNS} title="a<b"/>`));
	assert(refused(`<svg ${XMLNS}/><svg ${XMLNS}/>`));
	assert(refused(`<svg ${XMLNS}/>trailing text`));
	assert(refused(`<svg ${XMLNS}><!-- a -- b --></svg>`));
	assert(refused(`<svg ${XMLNS}>&#0;</svg>`));
	assert(refused(`<svg ${XMLNS}>a & b</svg>`));
	assert(refused(`<svg ${XMLNS}><x:rect/></svg>`));
});

Deno.test("only an SVG passes for an SVG", () => {
	assert(refused("<html><body>hi</body></html>"));
	assert(refused(`<rect ${XMLNS}/>`));
	assert(refused(`<svg/>`));
	assert(refused("not markup at all"));
	assert(refused(""));
	assert(refused(new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
});

Deno.test("bytes the two parsers might read differently are refused", () => {
	const utf16 = new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x73, 0x00, 0xff, 0xd8]);
	assert(refused(utf16));
	assert(refused(`<?xml version="1.0" encoding="UTF-7"?><svg ${XMLNS}/>`));
	assert(refused(`<?xml version="1.0" encoding="ISO-8859-1"?><svg ${XMLNS}/>`));
});

Deno.test("a file too large to hold is refused before it is read", () => {
	assert(refused(new Uint8Array(MAX_SVG_BYTES + 1)));
});
// #endregion
