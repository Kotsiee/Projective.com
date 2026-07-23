import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import "../styles/log-inspector.css";
import type { LogLevel } from "@projective/types/logging";
import { logger } from "@web/utils/logger.ts";
import { JsonView } from "./JsonView.tsx";
import { IconChevron, IconClearCache, IconSearch, IconSort } from "./dev-glyphs.tsx";
import {
	formatTime,
	hasPayload,
	LEVEL_META,
	LEVELS,
	payloadOf,
	searchHaystack,
} from "../core/log-format.ts";

/**
 * LogInspector — the body of the Log & API Inspector window. Reads the logger's in-memory session
 * history and re-renders on change (via {@link Logger.subscribe}). Offers severity filtering, an
 * instant keyword search that reaches into request/response payloads, a chronological sort toggle, a
 * per-row collapsible {@link JsonView} of the payload, and a "Clear session logs" flush.
 *
 * Dev-only by construction (rendered inside the build-excluded Dev Tools island); the logger keeps no
 * history in production, so this surface is never reachable there.
 */
export function LogInspector(): JSX.Element {
	// Re-render whenever the logger's history changes.
	const [, force] = useState(0);
	useEffect(() => logger.subscribe(() => force((n) => n + 1)), []);

	const [search, setSearch] = useState("");
	const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(() => new Set(LEVELS));
	const [order, setOrder] = useState<"desc" | "asc">("desc");
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

	const logs = logger.getLogs();

	/** Per-level counts across the whole (unfiltered) history. */
	const counts = useMemo(() => {
		const acc: Partial<Record<LogLevel, number>> = {};
		for (const e of logs) acc[e.level] = (acc[e.level] ?? 0) + 1;
		return acc;
		// Recompute when the history length or contents change (force() re-runs render → new logs ref).
	}, [logs, logs.length]);

	const q = search.trim().toLowerCase();
	const filtered = logs.filter((e) =>
		activeLevels.has(e.level) && (q === "" || searchHaystack(e).includes(q))
	);
	const ordered = order === "desc" ? [...filtered].reverse() : filtered;

	const toggleLevel = (level: LogLevel) =>
		setActiveLevels((prev) => {
			const next = new Set(prev);
			next.has(level) ? next.delete(level) : next.add(level);
			return next;
		});

	const toggleRow = (id: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});

	const clear = () => {
		logger.clear();
		setExpanded(new Set());
	};

	// Whether logs persist across reloads (the logger notifies on toggle, so `force` re-reads this).
	const persistOn = logger.isLogPersistenceOn();

	return (
		<div class="dev-log">
			<div class="dev-log__persist">
				<button
					type="button"
					role="switch"
					aria-checked={persistOn}
					class="dev-log__switch"
					data-on={persistOn}
					title="Keep captured logs in cache across page reloads; when off, they flush on unload"
					onClick={() => logger.setLogPersistence(!persistOn)}
				>
					<span class="dev-log__switch-track">
						<span class="dev-log__switch-thumb" />
					</span>
					<span class="dev-log__switch-text">Keep logs on refresh</span>
				</button>
				<button
					type="button"
					class="dev-log__clearcache"
					aria-label="Clear cached logs"
					title="Wipe the in-memory and persisted logs"
					onClick={clear}
				>
					<span class="dev-log__clearcache-glyph" aria-hidden="true">
						<IconClearCache />
					</span>
					<span>Clear cache</span>
				</button>
			</div>

			<div class="dev-log__toolbar">
				<div class="dev-log__search">
					<span class="dev-log__search-icon" aria-hidden="true">
						<IconSearch />
					</span>
					<input
						type="search"
						class="dev-log__search-input"
						placeholder="Search message, URL, payload…"
						value={search}
						aria-label="Search logs"
						onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
					/>
				</div>

				<div class="dev-log__filters" role="group" aria-label="Filter by severity">
					{LEVELS.map((level) => {
						const meta = LEVEL_META[level];
						const active = activeLevels.has(level);
						return (
							<button
								key={level}
								type="button"
								class="dev-log__chip"
								data-tone={meta.tone}
								data-active={active}
								aria-pressed={active}
								onClick={() => toggleLevel(level)}
							>
								<span class="dev-log__chip-glyph" aria-hidden="true">
									<meta.Glyph />
								</span>
								<span>{meta.label}</span>
								<span class="dev-log__chip-count">{counts[level] ?? 0}</span>
							</button>
						);
					})}
					<div class="dev-log__tools">
						<button
							type="button"
							class="dev-log__tool"
							data-active={order === "asc"}
							aria-label={`Sort ${order === "desc" ? "newest first" : "oldest first"}`}
							title={order === "desc" ? "Newest first" : "Oldest first"}
							onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))}
						>
							<IconSort />
						</button>
						<button
							type="button"
							class="dev-log__tool dev-log__tool--danger"
							aria-label="Clear session logs"
							title="Clear session logs"
							onClick={clear}
						>
							<IconClearCache />
						</button>
					</div>
				</div>
			</div>

			<div class="dev-log__list" role="log" aria-label="Session logs" aria-live="off">
				{ordered.length === 0
					? (
						<p class="dev-log__empty">
							{logs.length === 0
								? "No logs yet. Interact with the app — network calls and events appear here."
								: "No entries match the current filter."}
						</p>
					)
					: (
						<ul class="dev-log__rows">
							{ordered.map((e) => {
								const meta = LEVEL_META[e.level];
								const expandable = hasPayload(e);
								const isOpen = expanded.has(e.id);
								return (
									<li key={e.id} class="dev-log__item">
										<button
											type="button"
											class="dev-log__row"
											data-tone={meta.tone}
											aria-expanded={expandable ? isOpen : undefined}
											onClick={() => expandable && toggleRow(e.id)}
										>
											<span class="dev-log__row-glyph" aria-hidden="true">
												<meta.Glyph />
											</span>
											<span class="dev-log__time">{formatTime(e.at)}</span>
											<span class="dev-log__msg">{e.message}</span>
											{e.level === "network" && e.status !== undefined && (
												<span
													class="dev-log__status"
													data-ok={e.status >= 200 && e.status < 400}
												>
													{e.status || "ERR"}
												</span>
											)}
											{e.level === "network" && e.durationMs !== undefined && (
												<span class="dev-log__dur">{e.durationMs}ms</span>
											)}
											{expandable && (
												<span class="dev-log__caret" data-open={isOpen} aria-hidden="true">
													<IconChevron />
												</span>
											)}
										</button>
										{expandable && isOpen && (
											<div class="dev-log__payload">
												<JsonView data={payloadOf(e)} defaultDepth={2} />
											</div>
										)}
									</li>
								);
							})}
						</ul>
					)}
			</div>

			<div class="dev-log__foot">
				<span>{ordered.length} shown</span>
				<span>{logs.length} total</span>
			</div>
		</div>
	);
}
