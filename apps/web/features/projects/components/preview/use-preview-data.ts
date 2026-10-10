import { type Signal, signal, useSignal } from "@preact/signals";
import { useMemo } from "preact/hooks";
import type { InspectAsset } from "@projective/types/files";
import type { AttachmentSource } from "@projective/types/projects";
import { FilesService } from "@features/files/core/FilesService.ts";
import { MessagingService } from "@features/messaging/core/MessagingService.ts";

/**
 * The preview modal's two reads, each cached per asset for the page's life so paging back through a
 * group, or reopening the modal, paints at once: the inspector DTO behind the canvas, and the
 * messages a file was posted in. Client-only; on the server both read as "nothing yet".
 */

// #region Types

/** Where an inspector DTO read stands. `missing` is a 404: the viewer cannot read the file. */
export type InspectLoad =
	| { status: "loading" }
	| { status: "ready"; asset: InspectAsset }
	| { status: "missing" }
	| { status: "error"; message: string };

/** {@link useInspectAsset}'s answer: the read (null when nothing is to be read) and a retry. */
export interface InspectRead {
	load: InspectLoad | null;
	retry(): void;
}

// #endregion

// #region Cache

const CACHE_LIMIT = 48;

const inspectCache = new Map<string, Signal<InspectLoad>>();
const sourceCache = new Map<string, Signal<readonly AttachmentSource[] | null>>();

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
	cache.delete(key);
	cache.set(key, value);
	if (cache.size > CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	return value;
}

function inspectEntry(id: string, share: string | null): Signal<InspectLoad> {
	const key = `${id}|${share ?? ""}`;
	const cached = inspectCache.get(key);
	if (cached && cached.peek().status !== "error") return cached;
	const entry = remember(inspectCache, key, signal<InspectLoad>({ status: "loading" }));
	FilesService.inspect(id, share)
		.then((asset) => {
			entry.value = asset ? { status: "ready", asset } : { status: "missing" };
		})
		.catch((error: unknown) => {
			entry.value = {
				status: "error",
				message: error instanceof Error ? error.message : "The preview could not be loaded.",
			};
		});
	return entry;
}

function sourceEntry(
	assetId: string,
	conversationId: string | null,
): Signal<readonly AttachmentSource[] | null> {
	const key = `${assetId}|${conversationId ?? ""}`;
	const cached = sourceCache.get(key);
	if (cached) return cached;
	const entry = remember(
		sourceCache,
		key,
		signal<readonly AttachmentSource[] | null>(null),
	);
	MessagingService.attachmentSource(assetId, conversationId)
		.then((sources) => {
			entry.value = sources;
		})
		.catch(() => {
			sourceCache.delete(key);
			entry.value = [];
		});
	return entry;
}

const onServer = typeof document === "undefined";

// #endregion

// #region Hooks

/** The inspector DTO for a stored asset, fetched once and shared by every preview that shows it. */
export function useInspectAsset(assetId: string | null, share: string | null): InspectRead {
	const attempt = useSignal(0);
	const round = attempt.value;
	const entry = useMemo(
		() => (assetId && !onServer ? inspectEntry(assetId, share) : null),
		[assetId, share, round],
	);
	return {
		load: entry ? entry.value : null,
		retry: () => attempt.value++,
	};
}

/**
 * The messages a stored asset was posted in, newest first, narrowed to one conversation when given;
 * `null` while the lookup runs or when there is nothing to look up. Never errors: the service
 * answers `[]` on any failure, and the modal has already painted from the row.
 */
export function useAttachmentSources(
	lookup: { assetId: string; conversationId: string | null } | null,
	enabled: boolean,
): readonly AttachmentSource[] | null {
	const assetId = enabled ? lookup?.assetId ?? null : null;
	const conversationId = lookup?.conversationId ?? null;
	const entry = useMemo(
		() => (assetId && !onServer ? sourceEntry(assetId, conversationId) : null),
		[assetId, conversationId],
	);
	return entry ? entry.value : null;
}

// #endregion
