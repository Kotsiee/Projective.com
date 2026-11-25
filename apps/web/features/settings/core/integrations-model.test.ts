import { assert, assertEquals } from "@std/assert";
import {
	type ConnectionsView,
	type IntegrationProvider,
	SaveS3ConnectionSchema,
	type UserConnection,
} from "@projective/types/integrations";
import {
	consentFor,
	consentReturnPath,
	disconnectWarning,
	INTEGRATION_GROUPS,
	type IntegrationGroupKey,
	integrationRows,
	RETURN_PATH_MAX,
	type S3Draft,
	s3SavePayload,
	withoutConsentMarker,
} from "./integrations-model.ts";

const STAMP = "2026-11-17T09:00:00.000Z";

function provider(
	over: Partial<IntegrationProvider> & Pick<IntegrationProvider, "slug">,
): IntegrationProvider {
	return {
		label: over.slug,
		category: "calendar",
		capabilities: ["calendar"],
		authScheme: "oauth2",
		isEnabled: true,
		isBeta: false,
		broker: "direct",
		supportsWebhooks: false,
		defaultScopes: [],
		docsUrl: null,
		iconUrl: null,
		sortOrder: 100,
		createdAt: STAMP,
		...over,
	};
}

function connection(
	over: Partial<UserConnection> & Pick<UserConnection, "providerSlug">,
): UserConnection {
	return {
		id: "6d8f6a1e-2b7c-4f0e-9a51-3c2d1e0f9b84",
		userId: "1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0",
		providerLabel: over.providerSlug,
		providerCategory: "calendar",
		providerCapabilities: ["calendar"],
		status: "active",
		grantedKinds: ["calendar"],
		grantedScopes: [],
		syncDirection: "inbound",
		externalAccountId: null,
		externalAccountLabel: "ines@example.com",
		tokenExpiresAt: null,
		lastSyncedAt: null,
		lastError: null,
		errorCount: 0,
		config: null,
		connectedAt: STAMP,
		revokedAt: null,
		createdAt: STAMP,
		updatedAt: STAMP,
		...over,
	};
}

function view(
	providers: IntegrationProvider[],
	connections: UserConnection[] = [],
): ConnectionsView {
	return {
		providers,
		connections,
		hasCalendar: false,
		hasConferencing: false,
		activeConferencingProvider: null,
	};
}

function group(key: IntegrationGroupKey) {
	const found = INTEGRATION_GROUPS.find((g) => g.key === key);
	if (!found) throw new Error(`no group ${key}`);
	return found;
}

const GOOGLE = provider({
	slug: "google",
	label: "Google",
	capabilities: ["calendar", "freebusy", "conferencing"],
	sortOrder: 10,
});
const OUTLOOK = provider({ slug: "outlook", label: "Outlook", sortOrder: 20 });
const DROPBOX = provider({
	slug: "dropbox",
	label: "Dropbox",
	category: "storage",
	capabilities: ["storage"],
});
const GITHUB = provider({
	slug: "github",
	label: "GitHub",
	category: "developer",
	capabilities: ["code"],
});

Deno.test("every registry anchor of the section is a block, in the registry's order", () => {
	assertEquals(
		INTEGRATION_GROUPS.map((g) => g.key),
		["storage", "calendars", "conferencing", "other-services"],
	);
});

Deno.test("a block offers only enabled providers with its capability, by the catalogue's order", () => {
	const v = view([OUTLOOK, GOOGLE, DROPBOX, provider({ slug: "apple", isEnabled: false })]);
	const rows = integrationRows(v, group("calendars"));
	assertEquals(rows.map((r) => r.state === "available" ? r.provider.slug : null), [
		"google",
		"outlook",
	]);
	assertEquals(
		integrationRows(v, group("storage")).map((r) => r.state === "available" && r.provider.slug),
		["dropbox"],
	);
});

Deno.test("a provider no block names lands in Other services, and only there", () => {
	const v = view([GOOGLE, DROPBOX, GITHUB]);
	assertEquals(
		integrationRows(v, group("other-services")).map((r) =>
			r.state === "available" && r.provider.slug
		),
		["github"],
	);
	assertEquals(integrationRows(view([GOOGLE]), group("other-services")), []);
});

Deno.test("a live connection replaces its provider's offer in every block it serves", () => {
	const google = connection({
		providerSlug: "google",
		providerCapabilities: ["calendar", "freebusy", "conferencing"],
		grantedKinds: ["calendar", "freebusy", "conferencing"],
	});
	const v = view([GOOGLE, OUTLOOK], [google]);
	const calendars = integrationRows(v, group("calendars"));
	assertEquals(calendars.map((r) => r.state), ["connected", "available"]);
	const calls = integrationRows(v, group("conferencing"));
	assertEquals(calls.map((r) => r.state), ["connected"]);
	assert(calls[0].state === "connected" && !calls[0].canPublish, "publishing is a calendar's");
	assert(calendars[0].state === "connected" && calendars[0].canPublish);
});

Deno.test("a revoked or disconnected connection is gone, and its provider is offered afresh", () => {
	for (const status of ["revoked", "disconnected"] as const) {
		const rows = integrationRows(
			view([GOOGLE], [connection({ providerSlug: "google", status })]),
			group("calendars"),
		);
		assertEquals(rows.map((r) => r.state), ["available"], status);
	}
});

Deno.test("a connection to a provider since switched off stays listed, so it can be taken back", () => {
	const rows = integrationRows(
		view([provider({ slug: "outlook", isEnabled: false })], [
			connection({ providerSlug: "outlook" }),
		]),
		group("calendars"),
	);
	assertEquals(rows.map((r) => r.state), ["connected"]);
});

Deno.test("the consent offered follows recoverability, not the status name", () => {
	assertEquals(consentFor("active"), "none");
	assertEquals(consentFor("pending"), "none");
	assertEquals(consentFor("expired"), "reconnect");
	assertEquals(consentFor("degraded"), "reconnect");
	assertEquals(consentFor("error"), "connect");
});

Deno.test("only an active calendar grant can publish", () => {
	const expired = connection({ providerSlug: "google", status: "expired" });
	const rows = integrationRows(view([GOOGLE], [expired]), group("calendars"));
	assert(rows[0].state === "connected" && !rows[0].canPublish);
	assert(rows[0].state === "connected" && rows[0].consent === "reconnect");
});

Deno.test("a simulated connection replaces the block's own and withholds its provider's offer", () => {
	const real = connection({ providerSlug: "outlook" });
	const simulated = connection({ id: "dev-calendar", providerSlug: "google" });
	const rows = integrationRows(view([GOOGLE, OUTLOOK], [real]), group("calendars"), [simulated]);
	assertEquals(
		rows.map((r) => r.state === "connected" ? r.connection.id : r.provider.slug),
		["dev-calendar", "outlook"],
	);
});

Deno.test("a consent from the modal returns to the page underneath, reopened on Integrations", () => {
	assertEquals(
		consentReturnPath("/calendar?view=week&date=2026-11-17#grid", "modal"),
		"/calendar?view=week&date=2026-11-17&settings=integrations",
	);
	assertEquals(
		consentReturnPath("/files?settings=integrations&connect=failed", "modal"),
		"/files?settings=integrations",
	);
	assertEquals(
		consentReturnPath("/settings/integrations?connect=connected", "page"),
		"/settings/integrations",
	);
});

Deno.test("a return path too long for the start door keeps the page, then the console", () => {
	const long = `/calendar?view=week&q=${"x".repeat(RETURN_PATH_MAX)}`;
	assertEquals(consentReturnPath(long, "modal"), "/calendar?settings=integrations");
	assertEquals(
		consentReturnPath(`/${"p".repeat(RETURN_PATH_MAX)}`, "modal"),
		"/settings/integrations",
	);
});

Deno.test("the outcome marker is stripped, and nothing else is", () => {
	assertEquals(
		withoutConsentMarker("/calendar?view=week&connect=connected&settings=integrations#x"),
		"/calendar?view=week&settings=integrations#x",
	);
});

Deno.test("a disconnect names the provider, and the Projective calendar when one exists", () => {
	const plain = disconnectWarning(connection({ providerSlug: "google", providerLabel: "Google" }));
	assert(plain.includes("withdrawn at Google"));
	assert(!plain.includes("Projective calendar"));
	const publishing = disconnectWarning(
		connection({
			providerSlug: "google",
			providerLabel: "Google",
			config: { outbound_calendar_id: "cal-1" },
		}),
	);
	assert(publishing.includes("separate Projective calendar there is deleted"));
});

Deno.test("an unfinished S3 form offers the form again; any other pending consent offers nothing", () => {
	const S3 = provider({
		slug: "s3",
		category: "storage",
		capabilities: ["storage"],
		authScheme: "aws_sigv4",
	});
	const pending = (slug: string) =>
		connection({
			providerSlug: slug,
			status: "pending",
			providerCapabilities: ["storage"],
			grantedKinds: [],
		});
	const [s3] = integrationRows(view([S3], [pending("s3")]), group("storage"));
	assert(s3.state === "connected");
	assertEquals(s3.consent, "connect");
	const [drive] = integrationRows(view([DROPBOX], [pending("dropbox")]), group("storage"));
	assert(drive.state === "connected");
	assertEquals(drive.consent, "none");
});

Deno.test("an AWS bucket saves its role and no key; an S3-compatible endpoint its keys and no role", () => {
	const draft: S3Draft = {
		host: "aws",
		endpoint: "https://ignored.example",
		region: " eu-west-2 ",
		bucket: "studio-assets",
		prefix: "briefs/",
		pathStyle: true,
		roleArn: " arn:aws:iam::123456789012:role/projective ",
		accessKeyId: "ignored",
		secretAccessKey: "ignored",
	};
	const aws = s3SavePayload("6d8f6a1e-2b7c-4f0e-9a51-3c2d1e0f9b84", draft);
	assertEquals(aws.keys, null);
	assertEquals(aws.config, {
		endpoint: null,
		region: "eu-west-2",
		bucket: "studio-assets",
		prefix: "briefs/",
		pathStyle: false,
		roleArn: "arn:aws:iam::123456789012:role/projective",
	});
	assert(SaveS3ConnectionSchema.safeParse(aws).success);

	const r2 = s3SavePayload("6d8f6a1e-2b7c-4f0e-9a51-3c2d1e0f9b84", {
		...draft,
		host: "compatible",
		endpoint: "https://acct.r2.cloudflarestorage.com",
		region: "auto",
		accessKeyId: " AKID ",
		secretAccessKey: " s3cr3t ",
	});
	assertEquals([r2.config.roleArn, r2.config.pathStyle], [null, true]);
	assertEquals(r2.keys, { accessKeyId: "AKID", secretAccessKey: " s3cr3t " });
	assert(SaveS3ConnectionSchema.safeParse(r2).success);
	assert(!SaveS3ConnectionSchema.safeParse({ ...r2, keys: null }).success);
});
