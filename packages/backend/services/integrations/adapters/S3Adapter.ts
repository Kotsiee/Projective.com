import type { AssetItem } from "@projective/types/files";
import { type S3ConnectionConfig, S3ConnectionConfigSchema } from "@projective/types/integrations";
import { isForbiddenAddress, isIpLiteral, isLocalName } from "../../files/link-guards.ts";
import {
	configOf,
	connectorAsset,
	connectorFolder,
	continuation,
	type ErrorClassifier,
	netOf,
	orNull,
	pageSize,
	providerFetch,
} from "./adapter-support.ts";
import {
	arnPartitionOf,
	assumeRole,
	awsDnsSuffixOf,
	type AwsPartition,
	awsPartitionOf,
	s3PlatformPrincipal,
	xmlBlocks,
	xmlText,
} from "./aws.ts";
import {
	amzDateOf,
	canonicalQuery,
	encodeKeyPath,
	presignUrl,
	signRequest,
	type SigV4Credentials,
} from "./sigv4.ts";
import {
	type DrivePath,
	type StorageAdapter,
	type StorageAdapterContext,
	StorageAdapterError,
	type StorageListing,
	type StorageNet,
} from "./StorageAdapter.ts";

/**
 * S3Adapter — the `s3` connector, for AWS S3 and every S3-compatible store (R2, MinIO, Wasabi, B2).
 *
 * - **No authorization server, so the credential is tiered by where the bucket lives** (Decision
 *   #314). An AWS bucket is signed with temporary credentials from assuming the customer's IAM role
 *   (`./aws.ts`), and a stored key pair is refused there, never used. An S3-compatible endpoint has no
 *   STS and signs with the key pair sealed in the vault. Every request is SigV4-signed (`./sigv4.ts`);
 *   `config` carries only the non-secret addressing (endpoint, region, bucket, prefix, role ARN).
 * - **No folders.** A level is `ListObjectsV2` with `delimiter=/`: `Contents` are the objects,
 *   `CommonPrefixes` the synthetic folders. A folder's id IS its full prefix, so a client browses into
 *   one by passing it back as `DrivePath.path`. The zero-byte `dir/` marker some consoles create is
 *   the folder itself and is not listed as a file inside it.
 * - **The prefix is the tenant boundary.** Nothing outside `config.prefix` is listed, described or
 *   signed, so one bucket can safely hold several tenants' connections.
 * - **Keys are listed with `encoding-type=url`**, so a key holding a byte XML 1.0 cannot carry still
 *   round-trips; `+` is a space in that encoding, as the AWS SDKs decode it.
 * - **A custom endpoint is a server-side fetch to a host a person chose.** It must be `https:` and not
 *   a local name; before every request it is resolved and refused if any address is private, and the
 *   request then goes over a connection PINNED to the address that was checked (`StorageNet.pinned`),
 *   so a second DNS answer cannot steer it inward. AWS's own hostnames are fetched normally — their
 *   region and bucket are validated as names, so a config cannot rewrite the host.
 * - **Download** — a pre-signed `GET`, valid for fifteen minutes. **Thumbnail** — none; S3 stores bytes.
 * - **`ETag` is the change token, never a content hash**: a multipart object's ETag is a digest of
 *   digests (`…-N`), so treating it as an MD5 would make dedup wrong for exactly the large files.
 */

const PROVIDER = "S3";
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const PRESIGN_SECONDS = 900;
const REQUEST_MIN_SECONDS = 60;

type Reach =
	| { kind: "aws" }
	| { kind: "resolve"; hostname: string }
	| { kind: "literal"; address: string };

interface Address {
	origin: string;
	host: string;
	/** `/bucket` for path-style addressing, `""` for virtual-hosted. */
	basePath: string;
	/** How a request gets there: AWS's own name, or a person's endpoint pinned to a checked address. */
	reach: Reach;
	/** The AWS partition, for an AWS bucket. */
	partition: AwsPartition | null;
}

/** Signing credentials good for at least `minRemainingSeconds`. */
type CredentialSource = (minRemainingSeconds: number) => Promise<SigV4Credentials>;

const classify: ErrorClassifier = (status, body) => {
	const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "";
	if (
		/^(InvalidAccessKeyId|SignatureDoesNotMatch|ExpiredToken|InvalidToken|TokenRefreshRequired)$/
			.test(code)
	) {
		return "unauthorized";
	}
	if (
		/^(NoSuchBucket|PermanentRedirect|AuthorizationHeaderMalformed|IllegalLocationConstraintException)$/
			.test(code)
	) {
		return "misconfigured";
	}
	if (status >= 300 && status < 400) return "misconfigured";
	return null;
};

function misconfigured(message: string): StorageAdapterError {
	return new StorageAdapterError("misconfigured", `${PROVIDER}: ${message}`);
}

/** A key from an `encoding-type=url` listing; a malformed escape is kept as sent rather than dropped. */
function urlDecoded(raw: string): string {
	try {
		return decodeURIComponent(raw.replaceAll("+", "%20"));
	} catch {
		return raw;
	}
}

/** The folder a key or prefix sits in, as a prefix — `null` when that is the connection's root. */
function parentOf(keyOrPrefix: string, root: string): string | null {
	const trimmed = keyOrPrefix.endsWith("/") ? keyOrPrefix.slice(0, -1) : keyOrPrefix;
	const cut = trimmed.lastIndexOf("/");
	const parent = cut >= 0 ? trimmed.slice(0, cut + 1) : "";
	return parent.length > root.length && parent.startsWith(root) ? parent : null;
}

function addressOf(config: S3ConnectionConfig): Address {
	if (!config.endpoint) {
		const partition = awsPartitionOf(config.region);
		if (!partition) throw misconfigured("the region is not an AWS region.");
		const suffix = awsDnsSuffixOf(partition);
		const pathStyle = config.pathStyle || config.bucket.includes(".");
		const host = pathStyle
			? `s3.${config.region}.${suffix}`
			: `${config.bucket}.s3.${config.region}.${suffix}`;
		return {
			origin: `https://${host}`,
			host,
			basePath: pathStyle ? `/${encodeKeyPath(config.bucket)}` : "",
			reach: { kind: "aws" },
			partition,
		};
	}
	let url: URL;
	try {
		url = new URL(config.endpoint);
	} catch {
		throw misconfigured("the endpoint is not a URL.");
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (
		url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
		(url.pathname !== "/" && url.pathname !== "") ||
		url.search !== "" || isLocalName(hostname) ||
		(isIpLiteral(hostname) && (isForbiddenAddress(hostname) || !config.pathStyle))
	) {
		throw misconfigured("the endpoint must be a public https:// address.");
	}
	const port = url.port ? `:${url.port}` : "";
	const host = config.pathStyle ? url.host : `${config.bucket}.${url.hostname}${port}`;
	return {
		origin: `https://${host}`,
		host,
		basePath: config.pathStyle ? `/${encodeKeyPath(config.bucket)}` : "",
		reach: isIpLiteral(hostname)
			? { kind: "literal", address: hostname }
			: { kind: "resolve", hostname: config.pathStyle ? hostname : `${config.bucket}.${hostname}` },
		partition: null,
	};
}

function credentialsOf(
	ctx: StorageAdapterContext,
	config: S3ConnectionConfig,
	address: Address,
	net: StorageNet,
	principal: SigV4Credentials | null,
): CredentialSource {
	if (config.endpoint) {
		const credential = ctx.credential;
		if (credential?.scheme !== "aws_sigv4") {
			throw misconfigured("the connection holds no access key.");
		}
		const keys: SigV4Credentials = credential;
		return () => Promise.resolve(keys);
	}
	if (ctx.credential) {
		throw misconfigured(
			"an AWS bucket is reached through its IAM role; a stored key is never used.",
		);
	}
	const partition = address.partition;
	const roleArn = config.roleArn;
	if (!partition || !roleArn || arnPartitionOf(roleArn) !== partition) {
		throw misconfigured("the role is not in the bucket's AWS partition.");
	}
	if (!principal) {
		throw new StorageAdapterError(
			"unavailable",
			`${PROVIDER}: AWS buckets are not enabled in this environment.`,
		);
	}
	return (minRemainingSeconds) =>
		assumeRole(net, {
			connectionId: ctx.connection.id,
			roleArn,
			region: config.region,
			partition,
			principal,
			minRemainingSeconds,
		});
}

/**
 * Construct the S3 connector for one connection. `principal` is the platform's own AWS principal,
 * read from the environment unless a caller supplies it.
 */
export function createS3Adapter(
	ctx: StorageAdapterContext,
	principal: SigV4Credentials | null = s3PlatformPrincipal(),
): StorageAdapter {
	const net = netOf(ctx);
	const config = configOf(S3ConnectionConfigSchema, ctx.connection, PROVIDER);
	const address = addressOf(config);
	const credentials = credentialsOf(ctx, config, address, net, principal);
	const root = config.prefix && !config.prefix.endsWith("/") ? `${config.prefix}/` : config.prefix;

	async function checkedAddressOf(hostname: string): Promise<string> {
		const addresses = await net.resolve(hostname).catch(() => [] as string[]);
		if (addresses.length === 0) {
			throw new StorageAdapterError(
				"provider_error",
				`${PROVIDER}: the endpoint does not resolve.`,
			);
		}
		if (addresses.some(isForbiddenAddress)) {
			throw new StorageAdapterError(
				"forbidden",
				`${PROVIDER}: the endpoint resolves to a private address.`,
			);
		}
		return addresses[0];
	}

	async function route(): Promise<StorageNet> {
		const reach = address.reach;
		if (reach.kind === "aws") return net;
		const checked = reach.kind === "literal"
			? reach.address
			: await checkedAddressOf(reach.hostname);
		return { ...net, fetch: (url, init) => net.pinned(url, init, checked) };
	}

	async function send(
		method: "GET" | "HEAD",
		keyPath: string,
		query: [string, string][],
	): Promise<Response> {
		const via = await route();
		const request = {
			method,
			host: address.host,
			canonicalPath: `${address.basePath}/${keyPath}`,
			query,
			region: config.region,
			service: "s3",
			amzDate: amzDateOf(net.now()),
		};
		const signed = await signRequest(
			request,
			await credentials(REQUEST_MIN_SECONDS),
			EMPTY_SHA256,
			{
				"x-amz-content-sha256": EMPTY_SHA256,
			},
		);
		const search = query.length > 0 ? `?${canonicalQuery(query)}` : "";
		return providerFetch(via, PROVIDER, `${address.origin}${request.canonicalPath}${search}`, {
			method,
			headers: signed.headers,
		}, classify);
	}

	function webUrlOf(keyOrPrefix: string, folder: boolean): string | null {
		if (address.partition !== "aws") return null;
		const view = folder ? "buckets" : "object";
		return `https://s3.console.aws.amazon.com/s3/${view}/${encodeURIComponent(config.bucket)}` +
			`?region=${encodeURIComponent(config.region)}&prefix=${encodeURIComponent(keyOrPrefix)}`;
	}

	function within(keyOrPrefix: string): boolean {
		return keyOrPrefix.startsWith(root);
	}

	return {
		slug: "s3",
		source: "s3",

		async list(path: DrivePath, cursor: string | null, limit: number): Promise<StorageListing> {
			const asked = path.path ?? root;
			const prefix = asked && !asked.endsWith("/") ? `${asked}/` : asked;
			if (!within(prefix)) {
				throw new StorageAdapterError(
					"forbidden",
					`${PROVIDER}: that folder is outside this connection.`,
				);
			}
			const query: [string, string][] = [
				["list-type", "2"],
				["prefix", prefix],
				["delimiter", "/"],
				["max-keys", String(pageSize(limit, 1000))],
				["encoding-type", "url"],
			];
			if (cursor) query.push(["continuation-token", cursor]);
			const xml = await (await send("GET", "", query)).text();

			const urlEncoded = xmlText(xml, "EncodingType") === "url";
			const keyOf = (raw: string) => urlEncoded ? urlDecoded(raw) : raw;
			const now = net.now().getTime();
			const truncated = xmlText(xml, "IsTruncated") === "true";
			const listing: StorageListing = {
				entries: [],
				folders: [],
				hasMore: truncated,
				nextCursor: truncated
					? continuation(xmlText(xml, "NextContinuationToken"), PROVIDER)
					: null,
			};
			const parent = prefix.length > root.length ? prefix : null;
			for (const block of xmlBlocks(xml, "CommonPrefixes")) {
				const folderPrefix = keyOf(xmlText(block, "Prefix") ?? "");
				if (!folderPrefix.startsWith(prefix) || folderPrefix === prefix) continue;
				listing.folders.push(connectorFolder("s3", ctx.connection, {
					externalId: folderPrefix,
					parentId: parent,
					name: folderPrefix.slice(prefix.length).replace(/\/$/, ""),
					itemCount: 0,
					modifiedAt: null,
				}, now));
			}
			for (const block of xmlBlocks(xml, "Contents")) {
				const key = keyOf(xmlText(block, "Key") ?? "");
				if (!key.startsWith(prefix) || key === prefix) continue;
				listing.entries.push(connectorAsset("s3", ctx.connection, {
					externalId: key,
					parentId: parent,
					name: key.slice(prefix.length),
					mimeType: null,
					sizeBytes: Number(xmlText(block, "Size") ?? 0),
					modifiedAt: xmlText(block, "LastModified"),
					webUrl: webUrlOf(key, false),
					etag: xmlText(block, "ETag")?.replaceAll('"', "") ?? null,
				}, now));
			}
			return listing;
		},

		async metadata(key: string): Promise<AssetItem | null> {
			if (!within(key) || key.endsWith("/")) return null;
			const head = await orNull(send("HEAD", encodeKeyPath(key), []));
			if (!head) return null;
			return connectorAsset("s3", ctx.connection, {
				externalId: key,
				parentId: parentOf(key, root),
				name: key.slice(key.lastIndexOf("/") + 1),
				mimeType: head.headers.get("content-type")?.split(";")[0].trim() || null,
				sizeBytes: Number(head.headers.get("content-length") ?? 0),
				modifiedAt: head.headers.get("last-modified"),
				webUrl: webUrlOf(key, false),
				etag: head.headers.get("etag")?.replaceAll('"', "") ?? null,
			}, net.now().getTime());
		},

		async downloadUrl(key: string): Promise<string | null> {
			if (!within(key) || key.endsWith("/")) return null;
			return await presignUrl(
				{
					method: "GET",
					host: address.host,
					canonicalPath: `${address.basePath}/${encodeKeyPath(key)}`,
					query: [],
					region: config.region,
					service: "s3",
					amzDate: amzDateOf(net.now()),
				},
				await credentials(PRESIGN_SECONDS + REQUEST_MIN_SECONDS),
				PRESIGN_SECONDS,
				address.origin,
			);
		},

		thumbnailUrl(_key: string): Promise<string | null> {
			return Promise.resolve(null);
		},
	};
}
