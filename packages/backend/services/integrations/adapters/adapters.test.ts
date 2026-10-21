import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { AssetSource } from "@projective/types/files";
import { DriveBrowsePageSchema, type UserConnection } from "@projective/types/integrations";
import { isIntegrationsBackendLive } from "../../../core/supabase.ts";
import { isMountedSource } from "../../files/asset-row.ts";
import { pinnedRequest, pinnedRequestHead } from "../../files/link-fetch.ts";
import { clearAssumedRoles } from "./aws.ts";
import { createDropboxAdapter } from "./DropboxAdapter.ts";
import { createFrameIoAdapter } from "./FrameIoAdapter.ts";
import { createGoogleDriveAdapter } from "./GoogleDriveAdapter.ts";
import { createStorageAdapter, hasStorageAdapter, s3ExternalIdOf } from "./mod.ts";
import { createOneDriveAdapter } from "./OneDriveAdapter.ts";
import { createS3Adapter } from "./S3Adapter.ts";
import { signRequest, type SigV4Credentials } from "./sigv4.ts";
import {
	type StorageAdapterContext,
	StorageAdapterError,
	type StorageCredential,
	type StorageListing,
	type StorageNet,
} from "./StorageAdapter.ts";

// #region Kit

const NOW = new Date("2026-10-21T12:00:00.000Z");
const BEARER: StorageCredential = { scheme: "bearer", accessToken: "tok-123" };
const KEYS: StorageCredential = {
	scheme: "aws_sigv4",
	accessKeyId: "AKIDEXAMPLE",
	secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
	sessionToken: null,
};

function connection(providerSlug: string, config: UserConnection["config"] = null): UserConnection {
	return {
		id: "c0a8012e-0000-4000-8000-000000000001",
		userId: "950d68d1-8777-4bbe-ae59-3343e3e7f858",
		providerSlug,
		providerLabel: providerSlug,
		providerCategory: "storage",
		providerCapabilities: ["storage"],
		status: "active",
		grantedKinds: ["storage"],
		grantedScopes: [],
		syncDirection: "inbound",
		externalAccountId: null,
		externalAccountLabel: null,
		tokenExpiresAt: null,
		lastSyncedAt: null,
		lastError: null,
		errorCount: 0,
		config,
		connectedAt: "2026-10-01T00:00:00.000Z",
		revokedAt: null,
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-01T00:00:00.000Z",
	};
}

interface Call {
	url: URL;
	method: string;
	headers: Headers;
	body: string | null;
	/** The pre-checked address a pinned request was sent to; `null` for a plain `fetch`. */
	address: string | null;
}

/** A network that records every request and answers from `answer`; DNS resolves to a public address. */
function fakeNet(answer: (call: Call) => Response, addresses: string[] = ["93.184.216.34"]) {
	const calls: Call[] = [];
	const record = (url: string, init: RequestInit, address: string | null) => {
		const call = {
			url: new URL(url),
			method: init.method ?? "GET",
			headers: new Headers(init.headers),
			body: typeof init.body === "string" ? init.body : null,
			address,
		};
		calls.push(call);
		return Promise.resolve(answer(call));
	};
	const net: Partial<StorageNet> = {
		fetch: (url, init) => record(url, init, null),
		pinned: (url, init, address) => record(url, init, address),
		resolve: () => Promise.resolve(addresses),
		now: () => NOW,
	};
	return { calls, net };
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function ctxOf(
	slug: string,
	net: Partial<StorageNet>,
	config: UserConnection["config"] = null,
	credential: StorageCredential | null = BEARER,
): StorageAdapterContext {
	return { connection: connection(slug, config), credential, net };
}

/** Every listing must satisfy the browse contract a route would return. */
function contract(listing: StorageListing): StorageListing {
	DriveBrowsePageSchema.parse(listing);
	for (const row of [...listing.entries, ...listing.folders]) assertEquals(row.canManage, false);
	return listing;
}

async function refusal(work: () => Promise<unknown>, code: string): Promise<void> {
	const error = await assertRejects(work, StorageAdapterError);
	assertEquals(error.code, code);
}

// #endregion

// #region Registry

Deno.test("registry: every connector source has a real client, and nothing else does", () => {
	for (const source of AssetSource.options) {
		assertEquals(hasStorageAdapter(source), isMountedSource(source));
	}
	assertEquals(hasStorageAdapter("zoom"), false);
	assertEquals(hasStorageAdapter("toString"), false);
});

Deno.test({
	name: "registry: no adapter is constructed while INTEGRATIONS_BACKEND_LIVE is off",
	ignore: isIntegrationsBackendLive(),
	fn() {
		const error = assertThrows(
			() => createStorageAdapter(ctxOf("google_drive", {})),
			StorageAdapterError,
		);
		assertEquals(error.code, "unavailable");
	},
});

// #endregion

// #region Google Drive

Deno.test("google drive: lists one level — folders apart, shortcuts resolved, natives classified", async () => {
	const { calls, net } = fakeNet(() =>
		json({
			nextPageToken: "tok-2",
			files: [
				{
					id: "F1",
					name: "Clients",
					mimeType: "application/vnd.google-apps.folder",
					parents: ["0Root"],
				},
				{
					id: "S1",
					name: "Shared briefs",
					mimeType: "application/vnd.google-apps.shortcut",
					shortcutDetails: { targetId: "F2", targetMimeType: "application/vnd.google-apps.folder" },
				},
				{
					id: "P1",
					name: "brief.pdf",
					mimeType: "application/pdf",
					size: "2048",
					parents: ["0Root"],
					modifiedTime: "2026-10-20T09:30:00.000Z",
					webViewLink: "https://drive.google.com/file/d/P1/view",
					version: "17",
				},
				{
					id: "D1",
					name: "Retro notes",
					mimeType: "application/vnd.google-apps.document",
					parents: ["0Root"],
				},
			],
		})
	);
	const listing = contract(
		await createGoogleDriveAdapter(ctxOf("google_drive", net)).list(
			{ folderId: null, path: null },
			null,
			50,
		),
	);

	const sent = calls[0];
	assertEquals(sent.url.origin + sent.url.pathname, "https://www.googleapis.com/drive/v3/files");
	assertEquals(sent.url.searchParams.get("q"), "'root' in parents and trashed = false");
	assertEquals(sent.url.searchParams.get("supportsAllDrives"), "true");
	assertEquals(sent.url.searchParams.get("pageSize"), "50");
	assertEquals(sent.url.searchParams.has("pageToken"), false);
	assertEquals(sent.headers.get("authorization"), "Bearer tok-123");

	assertEquals(listing.folders.map((f) => [f.id, f.externalFolderId]), [["google_drive:F1", "F1"], [
		"google_drive:F2",
		"F2",
	]]);
	const [pdf, doc] = listing.entries;
	assertEquals([pdf.id, pdf.category, pdf.sizeBytes, pdf.url], [
		"google_drive:P1",
		"Document",
		2048,
		"https://drive.google.com/file/d/P1/view",
	]);
	assertEquals(pdf.external, {
		connectionId: "c0a8012e-0000-4000-8000-000000000001",
		providerSlug: "google_drive",
		externalFileId: "P1",
		externalParentId: "0Root",
		externalWebUrl: "https://drive.google.com/file/d/P1/view",
		externalEtag: "17",
	});
	assertEquals([pdf.source, pdf.visibility, pdf.ownerId], [
		"google_drive",
		"private",
		connection("x").userId,
	]);
	assertEquals([doc.category, doc.kind, doc.sizeBytes], ["Document", "doc", 0]);
	assertEquals([listing.hasMore, listing.nextCursor], [true, "tok-2"]);
});

Deno.test("google drive: a shared drive is scoped by corpora, and paging resumes from Drive's own token", async () => {
	const { calls, net } = fakeNet(() => json({ files: [] }));
	const drive = createGoogleDriveAdapter(ctxOf("google_drive", net, { driveId: "0AbcDrive" }));
	contract(await drive.list({ folderId: null, path: null }, "tok-2", 500));
	const params = calls[0].url.searchParams;
	assertEquals(params.get("q"), "'0AbcDrive' in parents and trashed = false");
	assertEquals([
		params.get("corpora"),
		params.get("driveId"),
		params.get("includeItemsFromAllDrives"),
	], [
		"drive",
		"0AbcDrive",
		"true",
	]);
	assertEquals(params.get("pageToken"), "tok-2");
});

Deno.test("google drive: a missing file is null, a revoked token is unauthorized, a quote cannot break q", async () => {
	const { calls, net } = fakeNet((call) => {
		if (call.url.pathname.endsWith("/gone")) {
			return json({ error: { code: 404, errors: [{ reason: "notFound" }] } }, 404);
		}
		if (call.url.pathname.endsWith("/revoked")) return json({ error: { code: 401 } }, 401);
		return json({ files: [] });
	});
	const drive = createGoogleDriveAdapter(ctxOf("google_drive", net));
	assertEquals(await drive.metadata("gone"), null);
	await refusal(() => drive.metadata("revoked"), "unauthorized");
	await drive.list({ folderId: "a'b\\c", path: null }, null, 10);
	assertEquals(
		calls.at(-1)?.url.searchParams.get("q"),
		"'a\\'b\\\\c' in parents and trashed = false",
	);
});

Deno.test("google drive: a native document downloads as its PDF export, a binary through webContentLink", async () => {
	const { net } = fakeNet((call) =>
		call.url.pathname.endsWith("/D1")
			? json({
				id: "D1",
				mimeType: "application/vnd.google-apps.document",
				exportLinks: { "application/pdf": "https://docs.google.com/export?id=D1&format=pdf" },
			})
			: json({
				id: "P1",
				mimeType: "application/pdf",
				webContentLink: "https://drive.google.com/uc?id=P1",
			})
	);
	const drive = createGoogleDriveAdapter(ctxOf("google_drive", net));
	assertEquals(await drive.downloadUrl("D1"), "https://docs.google.com/export?id=D1&format=pdf");
	assertEquals(await drive.downloadUrl("P1"), "https://drive.google.com/uc?id=P1");
});

Deno.test("google drive: no adapter is built without a bearer token", () => {
	const error = assertThrows(
		() => createGoogleDriveAdapter(ctxOf("google_drive", {}, null, null)),
		StorageAdapterError,
	);
	assertEquals(error.code, "misconfigured");
});

// #endregion

// #region Dropbox

Deno.test("dropbox: lists the root, skips deleted entries and builds the /home hand-off", async () => {
	const { calls, net } = fakeNet(() =>
		json({
			has_more: true,
			cursor: "c1",
			entries: [
				{ ".tag": "folder", id: "id:fold", name: "Clients", path_display: "/Clients" },
				{
					".tag": "file",
					id: "id:file",
					name: "SOW v2.pdf",
					path_display: "/Clients/SOW v2.pdf",
					size: 4096,
					server_modified: "2026-10-19T08:00:00Z",
					rev: "015f0000000a",
				},
				{ ".tag": "deleted", name: "old.txt", path_display: "/old.txt" },
			],
		})
	);
	const listing = contract(
		await createDropboxAdapter(ctxOf("dropbox", net)).list(
			{ folderId: null, path: null },
			null,
			50,
		),
	);
	assertEquals(calls[0].url.href, "https://api.dropboxapi.com/2/files/list_folder");
	assertEquals(JSON.parse(calls[0].body ?? "{}").path, "");
	assertEquals(JSON.parse(calls[0].body ?? "{}").limit, 50);
	assertEquals(listing.folders.map((f) => f.externalFolderId), ["id:fold"]);
	assertEquals(listing.entries.length, 1);
	assertEquals(listing.entries[0].url, "https://www.dropbox.com/home/Clients?preview=SOW%20v2.pdf");
	assertEquals(listing.entries[0].external?.externalEtag, "015f0000000a");
	assertEquals([listing.hasMore, listing.nextCursor], [true, "c1"]);
});

Deno.test("dropbox: continues from its cursor, and a team space rides Dropbox-API-Path-Root", async () => {
	const { calls, net } = fakeNet(() => json({ has_more: false, cursor: "c2", entries: [] }));
	const listing = await createDropboxAdapter(ctxOf("dropbox", net, { rootNamespaceId: "3235641" }))
		.list(
			{ folderId: null, path: null },
			"c1",
			50,
		);
	assertEquals(calls[0].url.pathname, "/2/files/list_folder/continue");
	assertEquals(JSON.parse(calls[0].body ?? "{}"), { cursor: "c1" });
	assertEquals(calls[0].headers.get("dropbox-api-path-root"), '{".tag":"root","root":"3235641"}');
	assertEquals(listing.nextCursor, null);
});

Deno.test("dropbox: a missing path is null and a folder mints no download link", async () => {
	const { net } = fakeNet((call) =>
		call.url.pathname.endsWith("get_temporary_link")
			? JSON.parse(call.body ?? "{}").path === "id:fold"
				? json({ error_summary: "path/not_file/.." }, 409)
				: json({ link: "https://uc.dropboxusercontent.com/cd/0/get/x" })
			: json({ error_summary: "path/not_found/.." }, 409)
	);
	const dropbox = createDropboxAdapter(ctxOf("dropbox", net));
	assertEquals(await dropbox.metadata("id:gone"), null);
	assertEquals(await dropbox.downloadUrl("id:fold"), null);
	assertEquals(
		await dropbox.downloadUrl("id:file"),
		"https://uc.dropboxusercontent.com/cd/0/get/x",
	);
	assertEquals(await dropbox.thumbnailUrl("id:file"), null);
});

// #endregion

// #region OneDrive / SharePoint

Deno.test("onedrive: lists the root, keeps Graph's nextLink as a path, and addresses shared folders by drive", async () => {
	const { calls, net } = fakeNet(() =>
		json({
			"@odata.nextLink":
				"https://graph.microsoft.com/v1.0/drives/D1/items/root/children?$skiptoken=abc",
			value: [
				{ id: "FOLD1", name: "Projects", folder: { childCount: 3 } },
				{
					id: "IMG1",
					name: "moodboard.png",
					size: 52000,
					file: { mimeType: "image/png" },
					image: { width: 1600, height: 900 },
					webUrl: "https://onedrive.live.com/?id=IMG1",
					eTag: '"{E1},2"',
				},
				{
					id: "SHORT1",
					name: "Agency share",
					remoteItem: { id: "R1", parentReference: { driveId: "D9" }, folder: {} },
				},
			],
		})
	);
	const listing = contract(
		await createOneDriveAdapter(ctxOf("onedrive", net)).list(
			{ folderId: null, path: null },
			null,
			50,
		),
	);
	assertEquals(
		calls[0].url.origin + calls[0].url.pathname,
		"https://graph.microsoft.com/v1.0/me/drive/root/children",
	);
	assertEquals(calls[0].url.searchParams.get("$top"), "50");
	assertEquals(listing.folders.map((f) => [f.externalFolderId, f.itemCount]), [["FOLD1", 3], [
		"D9:R1",
		0,
	]]);
	assertEquals([listing.entries[0].width, listing.entries[0].height, listing.entries[0].category], [
		1600,
		900,
		"Image",
	]);
	assertEquals(listing.nextCursor, "/v1.0/drives/D1/items/root/children?$skiptoken=abc");
});

Deno.test("onedrive: a cursor is followed only into Graph's drive paths — a forged one never leaves", async () => {
	const { calls, net } = fakeNet(() => json({ value: [] }));
	const drive = createOneDriveAdapter(ctxOf("onedrive", net));
	await drive.list(
		{ folderId: null, path: null },
		"/v1.0/drives/D1/items/root/children?$skiptoken=abc",
		50,
	);
	assertEquals(
		calls[0].url.href,
		"https://graph.microsoft.com/v1.0/drives/D1/items/root/children?$skiptoken=abc",
	);
	for (
		const forged of [
			"https://evil.example/x",
			"//evil.example/v1.0/me/drive/",
			"/v1.0/me/messages",
			"/v1.0/me/drive/../../me/messages",
		]
	) {
		await refusal(() => drive.list({ folderId: null, path: null }, forged, 50), "forbidden");
	}
	assertEquals(calls.length, 1);
});

Deno.test("onedrive: a SharePoint library and a shared folder each address their own drive", async () => {
	const { calls, net } = fakeNet(() => json({ value: [] }));
	await createOneDriveAdapter(ctxOf("onedrive", net, { driveId: "b!lib" })).list(
		{ folderId: null, path: null },
		null,
		10,
	);
	await createOneDriveAdapter(ctxOf("onedrive", net)).list(
		{ folderId: "D9:R1", path: null },
		null,
		10,
	);
	assertEquals(calls.map((c) => c.url.pathname), [
		"/v1.0/drives/b!lib/root/children",
		"/v1.0/drives/D9/items/R1/children",
	]);
});

Deno.test("onedrive: download and thumbnail URLs are read per call; a missing item is null", async () => {
	const { net } = fakeNet((call) => {
		if (call.url.pathname.includes("GONE")) return json({ error: { code: "itemNotFound" } }, 404);
		if (call.url.pathname.endsWith("/thumbnails")) {
			return json({ value: [{ medium: { url: "https://thumb.example/m" } }] });
		}
		return json({
			id: "IMG1",
			"@microsoft.graph.downloadUrl": "https://public.dm.files.1drv.com/x",
		});
	});
	const drive = createOneDriveAdapter(ctxOf("onedrive", net));
	assertEquals(await drive.downloadUrl("IMG1"), "https://public.dm.files.1drv.com/x");
	assertEquals(await drive.thumbnailUrl("IMG1"), "https://thumb.example/m");
	assertEquals(await drive.metadata("GONE"), null);
});

// #endregion

// #region S3

const PRINCIPAL: SigV4Credentials = {
	accessKeyId: "AKIDPLATFORM",
	secretAccessKey: "platformSecretExampleKey0000000000000000",
	sessionToken: null,
};
const ROLE = "arn:aws:iam::123456789012:role/projective/acme-assets-read";
const SESSION_TOKEN = "FwoGZXIvYXdzEXAMPLE//token=";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ROOT = { folderId: null, path: null };

const S3_BUCKET = {
	region: "eu-west-2",
	bucket: "acme-assets",
	prefix: "clients/acme",
	pathStyle: false,
};
const S3_CONFIG = { ...S3_BUCKET, roleArn: ROLE };
const compatible = (endpoint: string, pathStyle = true) => ({ ...S3_BUCKET, endpoint, pathStyle });

function listXml(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>acme-assets</Name><Prefix>clients%2Facme%2F</Prefix><EncodingType>url</EncodingType>
  <KeyCount>4</KeyCount><MaxKeys>50</MaxKeys><Delimiter>%2F</Delimiter><IsTruncated>true</IsTruncated>
  <NextContinuationToken>next/token==</NextContinuationToken>
  <Contents><Key>clients%2Facme%2F</Key><Size>0</Size><ETag>&quot;d41d&quot;</ETag></Contents>
  <Contents><Key>clients%2Facme%2FBrief+v2.pdf</Key><LastModified>2026-10-18T10:00:00.000Z</LastModified>
    <ETag>&quot;9b2cf535f27731c974343645a3985328-3&quot;</ETag><Size>734003</Size><StorageClass>STANDARD</StorageClass></Contents>
  <Contents><Key>clients%2Facme%2Fa%2Bb.txt</Key><Size>12</Size><ETag>&quot;5d41&quot;</ETag></Contents>
  <CommonPrefixes><Prefix>clients%2Facme%2Fraw%2F</Prefix></CommonPrefixes>
</ListBucketResult>`;
}

function stsXml(expiration = "2026-10-21T13:00:00Z"): string {
	return `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleResult>
    <Credentials>
      <AccessKeyId>ASIATEMPEXAMPLE</AccessKeyId>
      <SecretAccessKey>tempSecret/Example+Key</SecretAccessKey>
      <SessionToken>${SESSION_TOKEN}</SessionToken>
      <Expiration>${expiration}</Expiration>
    </Credentials>
  </AssumeRoleResult>
</AssumeRoleResponse>`;
}

function stsError(code: string): Response {
	return new Response(
		`<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>no</Message></Error></ErrorResponse>`,
		{ status: 403 },
	);
}

/** Answers STS with a session, and every other request from `answer`. */
function viaSts(
	answer: (call: Call) => Response,
	sts: () => Response = () => new Response(stsXml()),
) {
	return (call: Call) => call.url.hostname.startsWith("sts.") ? sts() : answer(call);
}

function awsS3(net: Partial<StorageNet>, config: UserConnection["config"] = S3_CONFIG) {
	return createS3Adapter(ctxOf("s3", net, config, null), PRINCIPAL);
}

function stsCount(calls: Call[]): number {
	return calls.filter((c) => c.url.hostname.startsWith("sts.")).length;
}

Deno.test("s3: lists one prefix level under the assumed role — url-encoded keys decoded, the folder marker skipped", async () => {
	clearAssumedRoles();
	const { calls, net } = fakeNet(viaSts(() => new Response(listXml(), { status: 200 })));
	const listing = contract(await awsS3(net).list(ROOT, null, 50));

	const sent = calls[1];
	assertEquals(
		sent.url.href,
		"https://acme-assets.s3.eu-west-2.amazonaws.com/?delimiter=%2F&encoding-type=url&list-type=2&max-keys=50&prefix=clients%2Facme%2F",
	);
	assertEquals(sent.address, null);
	assertEquals(
		sent.headers.get("authorization")?.startsWith(
			"AWS4-HMAC-SHA256 Credential=ASIATEMPEXAMPLE/20261021/eu-west-2/s3/aws4_request, " +
				"SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=",
		),
		true,
	);
	assertEquals(sent.headers.get("x-amz-security-token"), SESSION_TOKEN);
	assertEquals(sent.headers.get("x-amz-date"), "20261021T120000Z");

	assertEquals(listing.entries.map((e) => [e.name, e.external?.externalFileId]), [
		["Brief v2.pdf", "clients/acme/Brief v2.pdf"],
		["a+b.txt", "clients/acme/a+b.txt"],
	]);
	assertEquals(listing.entries[0].external?.externalEtag, "9b2cf535f27731c974343645a3985328-3");
	assertEquals(listing.entries[0].contentHash, null);
	assertEquals(listing.folders.map((f) => [f.name, f.externalFolderId, f.parentId]), [[
		"raw",
		"clients/acme/raw/",
		null,
	]]);
	assertEquals([listing.hasMore, listing.nextCursor], [true, "next/token=="]);
});

Deno.test("s3: an AWS bucket is reached by one AssumeRole, signed by the platform principal under STS", async () => {
	clearAssumedRoles();
	const { calls, net } = fakeNet(viaSts(() => new Response(listXml())));
	await awsS3(net).list(ROOT, null, 10);

	const sts = calls[0];
	assertEquals([sts.method, sts.address, sts.url.origin + sts.url.pathname], [
		"GET",
		null,
		"https://sts.eu-west-2.amazonaws.com/",
	]);
	assertEquals(Object.fromEntries(sts.url.searchParams), {
		Action: "AssumeRole",
		DurationSeconds: "3600",
		ExternalId: "projective-c0a8012e-0000-4000-8000-000000000001",
		RoleArn: ROLE,
		RoleSessionName: "projective-c0a8012e-0000-4000-8000-000000000001",
		Version: "2011-06-15",
	});
	assertEquals(
		sts.headers.get("authorization")?.startsWith(
			"AWS4-HMAC-SHA256 Credential=AKIDPLATFORM/20261021/eu-west-2/sts/aws4_request, " +
				"SignedHeaders=host;x-amz-date, Signature=",
		),
		true,
	);
	const resigned = await signRequest(
		{
			method: "GET",
			host: "sts.eu-west-2.amazonaws.com",
			canonicalPath: "/",
			query: [...sts.url.searchParams],
			region: "eu-west-2",
			service: "sts",
			amzDate: "20261021T120000Z",
		},
		PRINCIPAL,
		EMPTY_SHA256,
	);
	assertEquals(sts.headers.get("authorization"), resigned.headers.authorization);
	assertEquals(sts.headers.get("x-amz-security-token"), null);
});

Deno.test("s3: the external id is derived from the connection — stable, distinct, within STS's alphabet", () => {
	const id = "c0a8012e-0000-4000-8000-000000000001";
	assertEquals(s3ExternalIdOf(id), s3ExternalIdOf(id));
	assertEquals(s3ExternalIdOf(id), `projective-${id}`);
	assertEquals(
		s3ExternalIdOf(id) === s3ExternalIdOf("c0a8012e-0000-4000-8000-000000000002"),
		false,
	);
	assertEquals(/^[\w+=,.@:\/-]{2,1224}$/.test(s3ExternalIdOf(id)), true);
});

Deno.test("s3: an assumed session is shared and reused, and renewed before a download could outlive it", async () => {
	clearAssumedRoles();
	let now = NOW;
	const hourAfter = () => new Date(now.getTime() + 3_600_000).toISOString();
	const { calls, net } = fakeNet(
		viaSts(() => new Response(listXml()), () => new Response(stsXml(hourAfter()))),
	);
	net.now = () => now;
	const s3 = awsS3(net);

	await Promise.all([s3.list(ROOT, null, 10), s3.list(ROOT, null, 10)]);
	await s3.list(ROOT, null, 10);
	assertEquals(stsCount(calls), 1);

	now = new Date("2026-10-21T12:50:00.000Z");
	await s3.list(ROOT, null, 10);
	assertEquals(stsCount(calls), 1);
	const url = new URL((await s3.downloadUrl("clients/acme/brief.pdf")) ?? "");
	assertEquals(stsCount(calls), 2);
	assertEquals(url.searchParams.get("X-Amz-Security-Token"), SESSION_TOKEN);
	assertEquals(url.searchParams.get("X-Amz-Credential")?.startsWith("ASIATEMPEXAMPLE/"), true);
});

Deno.test("s3: a role that does not trust Projective is misconfigured, a refused platform key unavailable — neither cached", async () => {
	for (
		const [code, expected] of [["AccessDenied", "misconfigured"], [
			"InvalidClientTokenId",
			"unavailable",
		]]
	) {
		clearAssumedRoles();
		const { calls, net } = fakeNet(viaSts(() => new Response(listXml()), () => stsError(code)));
		const s3 = awsS3(net);
		const error = await assertRejects(() => s3.list(ROOT, null, 10), StorageAdapterError);
		assertEquals(error.code, expected);
		await assertRejects(() => s3.list(ROOT, null, 10), StorageAdapterError);
		assertEquals([calls.length, stsCount(calls)], [2, 2]);
		if (expected === "misconfigured") assertEquals(error.message.includes("trust policy"), true);
	}
});

Deno.test("s3: an AWS bucket never uses a stored key, and needs a role, the principal and a matching partition", async () => {
	const code = (
		config: UserConnection["config"],
		credential: StorageCredential | null,
		principal: SigV4Credentials | null = PRINCIPAL,
	) =>
		assertThrows(
			() => createS3Adapter(ctxOf("s3", {}, config, credential), principal),
			StorageAdapterError,
		).code;
	assertEquals(code(S3_CONFIG, KEYS), "misconfigured");
	assertEquals(code(S3_BUCKET, null), "misconfigured");
	assertEquals(
		code({ ...S3_CONFIG, roleArn: "arn:aws-cn:iam::123456789012:role/reader" }, null),
		"misconfigured",
	);
	assertEquals(
		code({ ...S3_CONFIG, roleArn: "arn:aws:iam::123456789012:user/reader" }, null),
		"misconfigured",
	);
	assertEquals(code({ ...S3_CONFIG, region: "auto" }, null), "misconfigured");
	assertEquals(code({ ...S3_CONFIG, region: "evil.example/" }, null), "misconfigured");
	assertEquals(code({ ...S3_CONFIG, bucket: "evil.example#" }, null), "misconfigured");
	assertEquals(code(S3_CONFIG, null, null), "unavailable");
	assertEquals(awsS3({}).source, "s3");

	clearAssumedRoles();
	const { calls, net } = fakeNet(viaSts(() => new Response(listXml())));
	const listing = await awsS3(net, {
		...S3_CONFIG,
		region: "cn-north-1",
		roleArn: "arn:aws-cn:iam::123456789012:role/reader",
	}).list(ROOT, null, 10);
	assertEquals(calls.map((c) => c.url.host), [
		"sts.cn-north-1.amazonaws.com.cn",
		"acme-assets.s3.cn-north-1.amazonaws.com.cn",
	]);
	assertEquals([listing.entries[0].url, listing.entries[0].external?.externalWebUrl], ["#", null]);
});

Deno.test("s3: the prefix is the tenant boundary — nothing outside it is listed, described or signed", async () => {
	clearAssumedRoles();
	const { calls, net } = fakeNet(viaSts(() => new Response(listXml())));
	const s3 = awsS3(net);
	await refusal(() => s3.list({ folderId: null, path: "clients/other/" }, null, 50), "forbidden");
	assertEquals(await s3.metadata("clients/other/secret.pdf"), null);
	assertEquals(await s3.downloadUrl("clients/other/secret.pdf"), null);
	assertEquals(calls.length, 0);
});

Deno.test("s3: a custom endpoint must be public https, checked by name and by every resolved address", async () => {
	for (
		const endpoint of [
			"http://minio.example.com",
			"https://localhost:9000",
			"https://10.0.0.5",
			"https://u:p@minio.example.com",
		]
	) {
		const error = assertThrows(
			() => createS3Adapter(ctxOf("s3", {}, compatible(endpoint), KEYS)),
			StorageAdapterError,
		);
		assertEquals(error.code, "misconfigured");
	}
	const privateDns = fakeNet(() => new Response(listXml()), ["10.1.2.3"]);
	await refusal(
		() =>
			createS3Adapter(
				ctxOf("s3", privateDns.net, compatible("https://minio.example.com:9000"), KEYS),
			)
				.list(ROOT, null, 10),
		"forbidden",
	);
	assertEquals(privateDns.calls.length, 0);

	const publicDns = fakeNet(() => new Response(listXml()));
	await createS3Adapter(
		ctxOf("s3", publicDns.net, compatible("https://minio.example.com:9000"), KEYS),
	)
		.list(ROOT, "tok", 10);
	assertEquals(
		publicDns.calls[0].url.origin + publicDns.calls[0].url.pathname,
		"https://minio.example.com:9000/acme-assets/",
	);
	assertEquals(publicDns.calls[0].url.searchParams.get("continuation-token"), "tok");
	assertEquals(
		publicDns.calls[0].headers.get("authorization")?.startsWith(
			"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261021/eu-west-2/s3/aws4_request",
		),
		true,
	);
});

Deno.test("s3: a custom endpoint is reached only over a connection pinned to the address it checked", async () => {
	const answers = [["93.184.216.34"], ["10.0.0.7"]];
	const resolved: string[] = [];
	const { calls, net } = fakeNet(() => new Response(listXml()));
	net.resolve = (hostname) => {
		resolved.push(hostname);
		return Promise.resolve(answers.shift() ?? []);
	};
	const s3 = createS3Adapter(ctxOf("s3", net, compatible("https://minio.example.com:9000"), KEYS));
	await s3.list(ROOT, null, 10);
	assertEquals([calls.length, calls[0].address], [1, "93.184.216.34"]);
	await refusal(() => s3.list(ROOT, null, 10), "forbidden");
	assertEquals(calls.length, 1);
	assertEquals(resolved, ["minio.example.com", "minio.example.com"]);

	const hosted = fakeNet(() => new Response(listXml()));
	const names: string[] = [];
	hosted.net.resolve = (hostname) => {
		names.push(hostname);
		return Promise.resolve(["93.184.216.34"]);
	};
	await createS3Adapter(
		ctxOf("s3", hosted.net, compatible("https://store.example.com", false), KEYS),
	)
		.list(ROOT, null, 10);
	assertEquals([names, hosted.calls[0].url.host, hosted.calls[0].address], [
		["acme-assets.store.example.com"],
		"acme-assets.store.example.com",
		"93.184.216.34",
	]);

	const literal = fakeNet(() =>
		new Response(null, { status: 200, headers: { "content-length": "3" } })
	);
	literal.net.resolve = () => Promise.reject(new Error("an IP literal is never resolved"));
	await createS3Adapter(ctxOf("s3", literal.net, compatible("https://93.184.216.34:9000"), KEYS))
		.metadata("clients/acme/a.txt");
	assertEquals(
		[literal.calls[0].address, literal.calls[0].method, literal.calls[0].url.host],
		["93.184.216.34", "HEAD", "93.184.216.34:9000"],
	);
});

Deno.test("pinned transport: the head is the caller's own after Host, the framing the transport's; https only", async () => {
	const head = pinnedRequestHead({
		method: "HEAD",
		url: new URL("https://minio.example.com:9000/acme-assets/a%20b%2B.txt?x-id=1"),
		headers: new Headers({
			authorization: "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/x",
			host: "evil.example",
			connection: "keep-alive",
			"x-amz-date": "20261021T120000Z",
		}),
	});
	assertEquals(
		head,
		"HEAD /acme-assets/a%20b%2B.txt?x-id=1 HTTP/1.1\r\nHost: minio.example.com:9000\r\n" +
			"authorization: AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/x\r\nx-amz-date: 20261021T120000Z\r\n" +
			"Accept-Encoding: identity\r\nConnection: close\r\n\r\n",
	);
	await assertRejects(() =>
		pinnedRequest(
			{ method: "GET", url: new URL("http://minio.example.com/"), headers: new Headers() },
			"93.184.216.34",
			Date.now() + 1_000,
			1_024,
		)
	);
});

Deno.test("s3: HEAD describes an object, and a download is a fifteen-minute pre-signed GET", async () => {
	clearAssumedRoles();
	const { net } = fakeNet(
		viaSts((call) =>
			call.url.pathname.endsWith("gone.pdf")
				? new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 })
				: new Response(null, {
					status: 200,
					headers: {
						"content-type": "application/pdf; charset=binary",
						"content-length": "1234",
						etag: '"abc-3"',
						"last-modified": "Sat, 18 Oct 2026 10:00:00 GMT",
					},
				})
		),
	);
	const s3 = awsS3(net);
	const item = await s3.metadata("clients/acme/specs/scope.pdf");
	assertEquals([item?.name, item?.category, item?.sizeBytes, item?.external?.externalEtag], [
		"scope.pdf",
		"Document",
		1234,
		"abc-3",
	]);
	assertEquals(item?.external?.externalParentId, "clients/acme/specs/");
	assertEquals(await s3.metadata("clients/acme/gone.pdf"), null);

	const url = new URL((await s3.downloadUrl("clients/acme/specs/scope v1.pdf")) ?? "");
	assertEquals(
		url.origin + url.pathname,
		"https://acme-assets.s3.eu-west-2.amazonaws.com/clients/acme/specs/scope%20v1.pdf",
	);
	assertEquals(
		[url.searchParams.get("X-Amz-Expires"), url.searchParams.get("X-Amz-SignedHeaders")],
		["900", "host"],
	);
	assertEquals(url.searchParams.get("X-Amz-Signature")?.length, 64);
});

Deno.test("s3: an S3-compatible endpoint signs with its stored key pair, and names no role", () => {
	const code = (config: UserConnection["config"], credential: StorageCredential | null) =>
		assertThrows(
			() => createS3Adapter(ctxOf("s3", {}, config, credential), null),
			StorageAdapterError,
		).code;
	const endpoint = "https://minio.example.com:9000";
	assertEquals(code(compatible(endpoint), BEARER), "misconfigured");
	assertEquals(code(compatible(endpoint), null), "misconfigured");
	assertEquals(code({ ...compatible(endpoint), roleArn: ROLE }, KEYS), "misconfigured");
	assertEquals(createS3Adapter(ctxOf("s3", {}, compatible(endpoint), KEYS), null).source, "s3");
});

// #endregion

// #region Frame.io

Deno.test("frame.io: a project connection roots at the project's root folder; a version stack lists its head", async () => {
	const { calls, net } = fakeNet((call) =>
		call.url.pathname.endsWith("/projects/prj1")
			? json({ data: { id: "prj1", root_folder_id: "root1" } })
			: json({
				links: { next: "/v4/accounts/acc1/folders/root1/children?after=CUR" },
				data: [
					{ id: "fo1", type: "folder", name: "Selects", updated_at: "2026-10-18T10:00:00Z" },
					{
						id: "fi1",
						type: "file",
						name: "cut-v3.mp4",
						media_type: "video/mp4",
						file_size: 9_000_000,
						view_url: "https://next.frame.io/v/fi1",
					},
					{
						id: "vs1",
						type: "version_stack",
						name: "Hero edit",
						head_version: {
							id: "fi9",
							type: "file",
							name: "hero.mov",
							media_type: "video/quicktime",
							file_size: 42,
						},
					},
					{ id: "vs2", type: "version_stack", name: "Empty stack", head_version: null },
				],
			})
	);
	const frameio = createFrameIoAdapter(
		ctxOf("frameio", net, { accountId: "acc1", projectId: "prj1" }),
	);
	const listing = contract(await frameio.list({ folderId: null, path: null }, null, 50));
	assertEquals(calls.map((c) => c.url.pathname), [
		"/v4/accounts/acc1/projects/prj1",
		"/v4/accounts/acc1/folders/root1/children",
	]);
	assertEquals(listing.folders.map((f) => f.externalFolderId), ["fo1"]);
	assertEquals(listing.entries.map((e) => [e.external?.externalFileId, e.name, e.category]), [
		["fi1", "cut-v3.mp4", "Video"],
		["fi9", "Hero edit", "Video"],
	]);
	assertEquals(listing.nextCursor, "CUR");
});

Deno.test("frame.io: a workspace connection lists its projects as the root's folders, paging by `after`", async () => {
	const { calls, net } = fakeNet(() =>
		json({
			links: { next: null },
			data: [{ id: "p1", name: "Atlas launch", root_folder_id: "r1" }, {
				id: "p2",
				name: "No root",
			}],
		})
	);
	const listing = contract(
		await createFrameIoAdapter(ctxOf("frameio", net, { accountId: "acc1", workspaceId: "ws1" }))
			.list(
				{ folderId: null, path: null },
				"CUR",
				50,
			),
	);
	assertEquals(calls[0].url.pathname, "/v4/accounts/acc1/workspaces/ws1/projects");
	assertEquals(calls[0].url.searchParams.get("after"), "CUR");
	assertEquals(listing.folders.map((f) => [f.name, f.externalFolderId]), [["Atlas launch", "r1"]]);
	assertEquals(listing.nextCursor, null);
});

Deno.test("frame.io: a connection must name a workspace or a project; a withheld download is no URL", async () => {
	const error = assertThrows(
		() => createFrameIoAdapter(ctxOf("frameio", {}, { accountId: "acc1" })),
		StorageAdapterError,
	);
	assertEquals(error.code, "misconfigured");
	const { net } = fakeNet((call) =>
		call.url.searchParams.get("include") === "media_links.original"
			? json({ errors: [{ title: "Forbidden" }] }, 403)
			: json({
				data: {
					id: "fi1",
					media_links: { thumbnail: { url: "https://assets.frame.io/t/fi1.jpg" } },
				},
			})
	);
	const frameio = createFrameIoAdapter(
		ctxOf("frameio", net, { accountId: "acc1", projectId: "prj1" }),
	);
	assertEquals(await frameio.downloadUrl("fi1"), null);
	assertEquals(await frameio.thumbnailUrl("fi1"), "https://assets.frame.io/t/fi1.jpg");
});

// #endregion
