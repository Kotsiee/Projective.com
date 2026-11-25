import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import {
	Button,
	InputText,
	type InputTextProps,
	Password,
	SelectButton,
	ToggleSwitch,
} from "@projective/ui/fields";
import type { S3ConnectionStart } from "@projective/types/integrations";
import type { S3Draft, S3Host } from "../../../core/integrations-model.ts";

/** Props for {@link S3SetupForm}. */
export interface S3SetupFormProps {
	/** The pending connection, its ExternalId and the account a role's trust policy names. */
	start: S3ConnectionStart;
	/** A save is in flight. */
	saving: boolean;
	/** Why the last save was refused, in words. */
	error: string | null;
	onSave: (draft: S3Draft) => void;
	onCancel: () => void;
}

const HOSTS = [
	{ label: "Amazon S3", value: "aws" },
	{ label: "S3-compatible", value: "compatible" },
];

/**
 * The S3 credential form (Decision #314), inline in Settings → Integrations → Cloud storage, because
 * S3 has no consent screen. An AWS bucket is reached by assuming an IAM role whose trust policy names
 * Projective's account and this connection's ExternalId; an S3-compatible endpoint (R2, MinIO, Wasabi)
 * signs with its own key pair, which the server seals and never shows again. Connect lists the bucket
 * once before anything is stored.
 */
export function S3SetupForm(props: S3SetupFormProps): JSX.Element {
	const { start } = props;
	const host = useSignal<S3Host>("aws");
	const endpoint = useSignal("");
	const region = useSignal("");
	const bucket = useSignal("");
	const prefix = useSignal("");
	const pathStyle = useSignal(false);
	const roleArn = useSignal("");
	const accessKeyId = useSignal("");
	const secretAccessKey = useSignal("");
	const aws = host.value === "aws";

	function submit(e: JSX.TargetedEvent<HTMLFormElement>): void {
		e.preventDefault();
		props.onSave({
			host: host.value,
			endpoint: endpoint.value,
			region: region.value,
			bucket: bucket.value,
			prefix: prefix.value,
			pathStyle: pathStyle.value,
			roleArn: roleArn.value,
			accessKeyId: accessKeyId.value,
			secretAccessKey: secretAccessKey.value,
		});
	}

	function field(label: string, control: JSX.Element, wide = false): JSX.Element {
		return (
			<label class={`stg-field${wide ? " stg-s3__wide" : ""}`}>
				<span class="stg-field__label">{label}</span>
				{control}
			</label>
		);
	}

	const text = (value: typeof region, extra: Partial<InputTextProps> = {}) => (
		<InputText
			value={value}
			disabled={props.saving}
			autoComplete="off"
			spellcheck={false}
			onValueChange={(v: string) => (value.value = v)}
			{...extra}
		/>
	);

	return (
		<form class="stg-s3" onSubmit={submit} noValidate aria-label="Connect S3 storage">
			<div class="stg-s3__wide">
				<SelectButton
					options={HOSTS}
					value={host}
					aria-label="Where the bucket lives"
					disabled={props.saving}
					onValueChange={(next) => (host.value = next as S3Host)}
				/>
			</div>
			<p class="stg-note stg-s3__wide">
				{aws
					? start.platformAccountId
						? `Create an IAM role that trusts AWS account ${start.platformAccountId} with the external ID ${start.externalId}, and give it read access to the bucket.`
						: "AWS buckets aren't enabled here yet. An S3-compatible endpoint still works."
					: "Use a key pair that can only read this bucket. It's encrypted when saved and never shown again."}
			</p>
			{aws
				? null
				: field("Endpoint", text(endpoint, { type: "url", placeholder: "https://" }), true)}
			{field("Bucket", text(bucket))}
			{field("Region", text(region, { placeholder: aws ? "eu-west-2" : "auto" }))}
			{field("Folder prefix (optional)", text(prefix, { placeholder: "projects/" }), true)}
			{aws ? field("Role ARN", text(roleArn, { placeholder: "arn:aws:iam::…:role/…" }), true) : (
				<>
					{field("Access key ID", text(accessKeyId))}
					{field(
						"Secret access key",
						<Password
							value={secretAccessKey}
							disabled={props.saving}
							feedback={false}
							toggleMask
							autoComplete="off"
							onValueChange={(v: string) => (secretAccessKey.value = v)}
						/>,
					)}
					<div class="stg-s3__wide">
						<ToggleSwitch
							size="sm"
							label="Path-style addresses (most self-hosted servers)"
							value={pathStyle}
							disabled={props.saving}
							onValueChange={(on: boolean) => (pathStyle.value = on)}
						/>
					</div>
				</>
			)}
			{props.error
				? <p class="stg-field__hint stg-field__hint--error" role="alert">{props.error}</p>
				: null}
			<div class="stg-s3__actions">
				<Button type="submit" size="sm" label="Connect" loading={props.saving} />
				<Button
					size="sm"
					variant="text"
					severity="secondary"
					label="Cancel"
					disabled={props.saving}
					onClick={props.onCancel}
				/>
			</div>
		</form>
	);
}
