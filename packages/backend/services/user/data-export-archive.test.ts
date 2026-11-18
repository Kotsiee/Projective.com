import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { strFromU8, unzipSync } from "fflate";
import {
	DATA_EXPORT_DOMAIN_SCHEMAS,
	DATA_EXPORT_MANIFEST_VERSION,
	DataExportDomain,
	DataExportManifestSchema,
} from "@projective/types/org";
import { buildArchive, buildManifest, type DataExportArchiveInput } from "./data-export-archive.ts";

const EMPTY: { [D in DataExportDomain]: unknown } = {
	profile: {
		account: null,
		profile: null,
		freelancer: null,
		languages: [],
		education: [],
		experience: [],
		certifications: [],
		portfolio: [],
		handle_changes: [],
	},
	emails: [{ email: "a@x.test", is_primary: true, verified_at: null, created_at: null }],
	preferences: { display: null, notifications: null, notification_categories: [] },
	projects: [],
	contributions: { memberships: [], stage_assignments: [], claimed_tickets: [], submissions: [] },
	messages: { direct: [], channel: [], threads: [] },
	files: [],
	wallet: [],
	invoices: { issued: [], statements: [], orders: [] },
	reviews: { written: [], received: [] },
	saved: { collections: [], bookmarks: [] },
	calendar: { entries: [], invitations: [] },
	notifications: [],
	search: { queries: [], recent_views: [] },
	security: { sign_ins: [], sessions: [], activity: [] },
};

function input(
	files = new Map(Object.entries(EMPTY)) as Map<DataExportDomain, unknown>,
): DataExportArchiveInput {
	return {
		requestId: "r1",
		requestedAt: "2026-11-18T10:00:00+00:00",
		userId: "u1",
		handle: "ana",
		generatedAt: new Date("2026-11-18T10:05:00Z"),
		files,
	};
}

Deno.test("the manifest lists every domain in order, with its file and record count", () => {
	const manifest = buildManifest(input());
	assertEquals(manifest.manifest_version, DATA_EXPORT_MANIFEST_VERSION);
	assertEquals(manifest.domains.map((d) => d.domain), [...DataExportDomain.options]);
	assertEquals(manifest.domains.find((d) => d.domain === "emails"), {
		domain: "emails",
		file: "emails.json",
		records: 1,
	});
});

Deno.test("a missing domain file is refused, not silently left out", () => {
	const files = new Map(Object.entries(EMPTY)) as Map<DataExportDomain, unknown>;
	files.delete("messages");
	assertThrows(() => buildManifest(input(files)), Error, "messages");
});

Deno.test("the ZIP opens, and every file in it validates against its schema", () => {
	const { bytes } = buildArchive(input());
	const entries = unzipSync(bytes);
	const manifest = DataExportManifestSchema.parse(JSON.parse(strFromU8(entries["manifest.json"])));
	assertEquals(
		Object.keys(entries).sort(),
		["README.txt", "manifest.json", ...manifest.domains.map((d) => d.file)].sort(),
	);
	for (const entry of manifest.domains) {
		DATA_EXPORT_DOMAIN_SCHEMAS[entry.domain].parse(JSON.parse(strFromU8(entries[entry.file])));
	}
	const readme = strFromU8(entries["README.txt"]);
	assertStringIncludes(readme, "@ana");
	assertStringIncludes(readme, "only the messages you sent");
});
