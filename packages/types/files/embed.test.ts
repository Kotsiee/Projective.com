import { assert, assertEquals } from "@std/assert";
import { EMBED_FRAME_ORIGINS, embedFor, embedForUrl, youtubeStart } from "./embed.ts";

const DRIVE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const LOOM_ID = "0123456789abcdef0123456789abcdef";

Deno.test("embedForUrl: Drive file links of every shape preview at /file/d/{id}/preview", () => {
	for (
		const url of [
			`https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`,
			`https://drive.google.com/file/d/${DRIVE_ID}/edit`,
			`https://drive.google.com/open?id=${DRIVE_ID}`,
		]
	) {
		const embed = embedForUrl(url);
		assertEquals(embed?.provider, "google_drive", url);
		assertEquals(embed?.src, `https://drive.google.com/file/d/${DRIVE_ID}/preview`, url);
		assertEquals(embed?.referrerPolicy, "no-referrer");
	}
});

Deno.test("embedForUrl: Google Docs, Sheets and Slides open their own preview", () => {
	const cases: [string, string, string][] = [
		["document", "Google Docs", "document"],
		["spreadsheets", "Google Sheets", "spreadsheets"],
		["presentation", "Google Slides", "presentation"],
	];
	for (const [type, label, path] of cases) {
		const embed = embedForUrl(`https://docs.google.com/${type}/d/${DRIVE_ID}/edit#gid=0`);
		assertEquals(embed?.provider, "google_docs");
		assertEquals(embed?.label, label);
		assertEquals(embed?.src, `https://docs.google.com/${path}/d/${DRIVE_ID}/preview`);
	}
	assertEquals(embedForUrl(`https://docs.google.com/forms/d/${DRIVE_ID}/viewform`), null);
	assertEquals(embedForUrl("https://docs.google.com/document/d/e/2PACX-pub/pub"), null);
});

Deno.test("embedForUrl: YouTube watch, short, live and youtu.be links play on the no-cookie host", () => {
	for (
		const url of [
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x",
			"https://youtube.com/shorts/dQw4w9WgXcQ",
			"https://www.youtube.com/live/dQw4w9WgXcQ",
			"https://youtu.be/dQw4w9WgXcQ",
			"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
		]
	) {
		const embed = embedForUrl(url);
		assertEquals(embed?.provider, "youtube", url);
		assertEquals(embed?.src, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0", url);
		assertEquals(embed?.referrerPolicy, "strict-origin-when-cross-origin");
	}
	assertEquals(
		embedForUrl("https://youtu.be/dQw4w9WgXcQ?t=1m30s")?.src,
		"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=90",
	);
	assertEquals(embedForUrl("https://www.youtube.com/watch?v=short"), null);
	assertEquals(embedForUrl("https://www.youtube.com/@channel"), null);
});

Deno.test("youtubeStart reads seconds and h/m/s offsets, and refuses anything else", () => {
	assertEquals(youtubeStart("90"), 90);
	assertEquals(youtubeStart("90s"), 90);
	assertEquals(youtubeStart("1h2m3s"), 3723);
	assertEquals(youtubeStart("0"), null);
	assertEquals(youtubeStart("abc"), null);
	assertEquals(youtubeStart(null), null);
});

Deno.test("embedForUrl: Vimeo keeps an unlisted video's hash, and only a hash", () => {
	assertEquals(
		embedForUrl("https://vimeo.com/76979871")?.src,
		"https://player.vimeo.com/video/76979871",
	);
	assertEquals(
		embedForUrl("https://vimeo.com/76979871/abc123def0")?.src,
		"https://player.vimeo.com/video/76979871?h=abc123def0",
	);
	assertEquals(
		embedForUrl("https://player.vimeo.com/video/76979871?h=zz%22onload")?.src,
		"https://player.vimeo.com/video/76979871",
	);
	assertEquals(embedForUrl("https://vimeo.com/channels/staffpicks"), null);
});

Deno.test("embedForUrl: Loom shares and Figma files resolve; Figma's address is rebuilt, not passed", () => {
	assertEquals(
		embedForUrl(`https://www.loom.com/share/${LOOM_ID}`)?.src,
		`https://www.loom.com/embed/${LOOM_ID}`,
	);
	assertEquals(embedForUrl("https://www.loom.com/share/not-an-id"), null);
	const figma = embedForUrl(
		"https://www.figma.com/design/AbCdEfGhIj1234567890/My-File?node-id=12-34&t=secret",
	);
	assertEquals(figma?.provider, "figma");
	const target = new URL(figma!.src).searchParams.get("url");
	assertEquals(target, "https://www.figma.com/design/AbCdEfGhIj1234567890?node-id=12-34");
	assertEquals(new URL(figma!.src).searchParams.get("embed_host"), "projective");
	assertEquals(embedForUrl("https://www.figma.com/community/file/123"), null);
});

Deno.test("embedForUrl: only https, no credentials, no ports, no lookalike hosts", () => {
	for (
		const url of [
			"http://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://user:pw@www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
			"https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
			"https://evil.example/drive.google.com/file/d/" + DRIVE_ID,
			"javascript:alert(1)",
			"not a url",
			"",
		]
	) {
		assertEquals(embedForUrl(url), null, url);
	}
	assertEquals(embedForUrl(null), null);
});

Deno.test("every embed loads from an allowlisted origin, sandboxed without top navigation", () => {
	const samples = [
		`https://drive.google.com/file/d/${DRIVE_ID}/view`,
		`https://docs.google.com/document/d/${DRIVE_ID}/edit`,
		"https://youtu.be/dQw4w9WgXcQ",
		"https://vimeo.com/76979871",
		`https://www.loom.com/share/${LOOM_ID}`,
		"https://www.figma.com/file/AbCdEfGhIj1234567890/x",
	];
	for (const url of samples) {
		const embed = embedForUrl(url)!;
		assert(EMBED_FRAME_ORIGINS.includes(embed.origin), url);
		assertEquals(new URL(embed.src).origin, embed.origin, url);
		assert(!embed.sandbox.includes("allow-top-navigation"), url);
	}
});

Deno.test("embedFor: a link by its address, a connected Drive file by its page or its id", () => {
	assertEquals(
		embedFor({ source: "link", link: { url: "https://youtu.be/dQw4w9WgXcQ" } })?.provider,
		"youtube",
	);
	assertEquals(embedFor({ source: "link", link: { url: "https://example.com/x" } }), null);
	assertEquals(embedFor({ source: "link", link: null }), null);
	for (const scanStatus of ["suspicious", "blocked"]) {
		assertEquals(
			embedFor({ source: "link", link: { url: "https://youtu.be/dQw4w9WgXcQ", scanStatus } }),
			null,
			scanStatus,
		);
	}
	assertEquals(
		embedFor({
			source: "link",
			link: { url: "https://youtu.be/dQw4w9WgXcQ", scanStatus: "pending" },
		})
			?.provider,
		"youtube",
	);

	const external = { providerSlug: "google_drive", externalFileId: DRIVE_ID, externalWebUrl: null };
	assertEquals(
		embedFor({ source: "google_drive", external })?.src,
		`https://drive.google.com/file/d/${DRIVE_ID}/preview`,
	);
	assertEquals(
		embedFor({
			source: "google_drive",
			external: {
				...external,
				externalWebUrl: `https://docs.google.com/spreadsheets/d/${DRIVE_ID}/edit`,
			},
		})?.src,
		`https://docs.google.com/spreadsheets/d/${DRIVE_ID}/preview`,
	);
	assertEquals(
		embedFor({ source: "google_drive", external: { ...external, externalFileId: "a/b" } }),
		null,
	);
	assertEquals(
		embedFor({ source: "dropbox", external: { ...external, providerSlug: "dropbox" } }),
		null,
	);
	assertEquals(embedFor({ source: "supabase" }), null);
});
