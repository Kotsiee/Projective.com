import "../styles/legal.css";
import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { Button, RadioGroup } from "@projective/ui/fields";
import { compareVersions, legalDocumentHref, legalPdfHref } from "../core/versions.ts";
import type { LegalVersionControlsProps } from "../types/controls.ts";

export type { LegalVersionControlsProps, LegalVersionOption } from "../types/controls.ts";

/** The radio value that means "the version in effect today" — an unpinned address. */
const CURRENT = "";

/**
 * LegalVersionControls — the document's meta rail: pick a version, pick an older one to compare it
 * with, download the shown version as a PDF, print it (Decision #270).
 *
 * It is a plain `<form method="get">` of native radios (`RadioGroup`), so it works without
 * JavaScript: submitting asks for `?v=&compare=`, and the server drops empty values with a redirect.
 * With JavaScript the island keeps "Compare with" to versions older than the one picked, and
 * navigates to the clean address itself. Print appears only once hydrated — without script it could
 * do nothing — and before the browser prints, every folded run of unchanged clauses is opened (and
 * closed again after), because paper cannot be clicked. The radios name no value for today's
 * version, so picking it returns to the unpinned address.
 */
export default function LegalVersionControls(props: LegalVersionControlsProps): JSX.Element {
	const { slug, versions, shown, current, compare } = props;
	const version = useSignal(shown === current ? CURRENT : shown);
	const compareWith = useSignal(compare ?? "");
	const ready = useSignal(false);

	const picked = useComputed(() => version.value || current);
	const olderOptions = useComputed(() =>
		versions.filter((v) => compareVersions(v.version, picked.value) < 0)
	);

	// A compare target that is no longer older than the picked version is cleared, never kept stale.
	useSignalEffect(() => {
		const target = compareWith.value;
		if (target && !olderOptions.value.some((v) => v.version === target)) compareWith.value = "";
	});

	useEffect(() => {
		ready.value = true;
		const opened: HTMLDetailsElement[] = [];
		const before = () => {
			for (const details of document.querySelectorAll<HTMLDetailsElement>(".lgl-unchanged")) {
				if (!details.open) {
					details.open = true;
					opened.push(details);
				}
			}
		};
		const after = () => {
			for (const details of opened.splice(0)) details.open = false;
		};
		addEventListener("beforeprint", before);
		addEventListener("afterprint", after);
		return () => {
			removeEventListener("beforeprint", before);
			removeEventListener("afterprint", after);
		};
	}, []);

	const onSubmit = (event: JSX.TargetedEvent<HTMLFormElement>) => {
		event.preventDefault();
		location.assign(legalDocumentHref(slug, {
			v: version.value || null,
			compare: compareWith.value || null,
		}));
	};

	const pdfHref = legalPdfHref(slug, shown === current ? null : shown);
	const only = versions.length < 2;

	return (
		<div class="lgl-controls" data-print="hide">
			{only
				? (
					<div class="lgl-controls__field">
						<p class="lgl-controls__label">Version</p>
						<p class="lgl-controls__hint">{props.onlyVersionNote}</p>
					</div>
				)
				: (
					<form
						class="lgl-controls__form"
						method="get"
						action={legalDocumentHref(slug)}
						onSubmit={onSubmit}
					>
						<div class="lgl-controls__field">
							<p class="lgl-controls__label" aria-hidden="true">Version</p>
							<RadioGroup
								name="v"
								aria-label="Version"
								orientation="vertical"
								size="sm"
								value={version}
								options={versions.map((v) => ({
									value: v.version === current ? CURRENT : v.version,
									label: v.label,
								}))}
							/>
						</div>
						<div class="lgl-controls__field">
							<p class="lgl-controls__label" aria-hidden="true">Compare with</p>
							{olderOptions.value.length > 0
								? (
									<RadioGroup
										name="compare"
										aria-label="Compare with"
										orientation="vertical"
										size="sm"
										value={compareWith}
										options={[
											{ value: "", label: "Don't compare" },
											...olderOptions.value.map((v) => ({ value: v.version, label: v.label })),
										]}
									/>
								)
								: <p class="lgl-controls__hint">There is no earlier version to compare with.</p>}
						</div>
						<div class="lgl-controls__actions">
							<Button
								type="submit"
								severity="neutral"
								variant="outlined"
								size="sm"
								label={compareWith.value ? "Compare versions" : "Show version"}
							/>
						</div>
					</form>
				)}
			<div class="lgl-controls__field">
				<p class="lgl-controls__label" aria-hidden="true">Download</p>
				<div class="lgl-controls__actions">
					<a
						class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
						href={pdfHref}
						download
					>
						<span class="ui-button__label">
							Download PDF<span class="ui-visually-hidden">, version {shown}</span>
						</span>
					</a>
					{ready.value
						? (
							<Button
								severity="neutral"
								variant="outlined"
								size="sm"
								label="Print"
								onClick={() => print()}
							/>
						)
						: null}
				</div>
			</div>
		</div>
	);
}
