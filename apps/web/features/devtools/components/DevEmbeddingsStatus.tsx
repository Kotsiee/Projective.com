import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { EmbeddingsStatus } from "@projective/types/explore";
import { ExploreService } from "@features/explore/core/ExploreService.ts";
import type { DevEmbeddings } from "../core/dev-context.ts";

/** Props for {@link DevEmbeddingsStatus}. */
export interface DevEmbeddingsStatusProps {
	/** The switcher's current Embeddings value — a change re-reads the effective state. */
	mode: DevEmbeddings;
	/** The master simulation switch — off removes the override cookie. */
	enabled: boolean;
}

function explain(status: EmbeddingsStatus): string {
	const by = status.override ? `cookie ${status.override}` : "env";
	if (status.ranking === "semantic") return `Semantic · ${status.model} (${by})`;
	if (status.mocks) return "Heuristic · USE_MOCKS is on";
	if (!status.supabaseConfigured) return "Heuristic · Supabase is not configured";
	if (!status.keyPresent) return "Heuristic · no VOYAGE_API_KEY";
	return `Heuristic (${by})`;
}

/**
 * DevEmbeddingsStatus — the embeddings switch as the server resolves it for this browser (Decision
 * #179), read from the development-only `/api/explore/ranking` on mount and after every change of the
 * Embeddings control, so the line says what discovery is actually doing, not what was asked for.
 */
export function DevEmbeddingsStatus(props: DevEmbeddingsStatusProps): JSX.Element {
	const line = useSignal("Checking…");

	useEffect(() => {
		let current = true;
		ExploreService.ranking().then((res) => {
			if (!current) return;
			line.value = res.ok && res.data
				? explain(res.data)
				: res.message ?? "The ranking status could not be read.";
		});
		return () => {
			current = false;
		};
	}, [props.mode, props.enabled]);

	return <span class="dev-ctx__hint" role="status">Effective: {line.value}</span>;
}
