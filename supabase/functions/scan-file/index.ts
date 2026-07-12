import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1';

console.log('Scan File Function Loaded');

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- [CONFIGURATION] ---
// If you have a real API key, set it in Supabase secrets:
// supabase secrets set VIRUSTOTAL_API_KEY="your-key"
const VIRUSTOTAL_API_KEY = Deno.env.get('VIRUSTOTAL_API_KEY');

Deno.serve(async (req) => {
	// Handle CORS preflight
	if (req.method === 'OPTIONS') {
		return new Response('ok', { headers: corsHeaders });
	}

	try {
		// 1. SETUP: Docker Networking Patch
		let supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
		// If running locally in Docker, point to host machine
		if (
			supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')
		) {
			supabaseUrl = 'http://host.docker.internal:54321';
		}

		const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
		if (!supabaseUrl || !serviceRoleKey) {
			throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
		}

		const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
			auth: { persistSession: false },
		});

		// 2. PARSE INPUT
		const { fileId } = await req.json();
		if (!fileId) throw new Error('Missing fileId');

		console.log(`Processing fileId: ${fileId}`);

		// 3. FETCH METADATA
		const { data: file, error: fetchError } = await supabaseClient
			.schema('files')
			.from('items')
			.select('*')
			.eq('id', fileId)
			.single();

		if (fetchError || !file) {
			console.error('Fetch Error:', fetchError);
			throw new Error('File not found in DB');
		}

		if (file.status === 'clean') {
			return new Response(JSON.stringify({ message: 'Already clean' }), {
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// 4. UPDATE STATUS -> SCANNING
		await supabaseClient.schema('files').from('items')
			.update({ status: 'scanning' })
			.eq('id', fileId);

		// ------------------------------------------------------------------------
		// 5. STEP A: VIRUS SCAN
		// ------------------------------------------------------------------------
		// Note: For large files, scanning might require a separate stream or
		// sending a URL to VirusTotal if the file is publicly accessible.
		// Here we use a Mock function to demonstrate the logic flow.

		const scanResult = await mockScanWithVirusTotal(file, supabaseClient);

		// --- [CRITICAL] HANDLE INFECTED FILES ---
		if (!scanResult.clean) {
			console.warn(`🚨 VIRUS DETECTED: ${file.storage_path}`);

			// A. Delete the file immediately from quarantine
			await supabaseClient.storage.from('quarantine').remove([
				file.storage_path,
			]);

			// B. Mark DB as infected (so user knows why it disappeared)
			const { data: infectedRecord } = await supabaseClient
				.schema('files')
				.from('items')
				.update({
					status: 'infected',
					storage_path: null, // No longer exists in storage
					scan_notes: `Threat Detected: ${scanResult.threat}`,
					updated_at: new Date().toISOString(),
				})
				.eq('id', fileId)
				.select()
				.single();

			return new Response(JSON.stringify(infectedRecord), {
				status: 200, // Return 200 so the client knows the process completed (even if result was bad)
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// ------------------------------------------------------------------------
		// 6. STEP B: MOVE FILE (STREAMING)
		// ------------------------------------------------------------------------
		// If we are here, the file is CLEAN. Move it to the target bucket.
		// We use Stream Piping to avoid loading the file into RAM.

		console.log(
			`File is clean. Streaming ${file.size_bytes} bytes to target...`,
		);

		// A. Get Download Stream (Signed URL)
		const { data: signData, error: signError } = await supabaseClient.storage
			.from('quarantine')
			.createSignedUrl(file.storage_path, 60);

		if (signError) throw signError;

		// B. Fetch the stream
		const sourceResponse = await fetch(signData.signedUrl);
		if (!sourceResponse.ok || !sourceResponse.body) {
			throw new Error(
				`Failed to open read stream: ${sourceResponse.statusText}`,
			);
		}

		// C. Pipe to Target Bucket (Using Raw Fetch for Streaming Control)
		const targetUploadUrl =
			`${supabaseUrl}/storage/v1/object/${file.target_bucket}/${file.target_path}`;

		const uploadResponse = await fetch(targetUploadUrl, {
			method: 'POST',
			body: sourceResponse.body, // <--- THE MAGIC: Pipe the stream directly
			headers: {
				'Authorization': `Bearer ${serviceRoleKey}`,
				'Content-Type': file.mime_type,
				'x-upsert': 'true',
				'Content-Length': file.size_bytes.toString(), // Required for streaming uploads
			},
			// @ts-ignore: 'duplex' is valid in Deno/Chrome
			duplex: 'half',
		});

		if (!uploadResponse.ok) {
			const errText = await uploadResponse.text();
			throw new Error(
				`Stream upload failed: ${uploadResponse.status} - ${errText}`,
			);
		}

		// D. Cleanup Quarantine
		await supabaseClient.storage.from('quarantine').remove([file.storage_path]);

		// 7. FINAL DB UPDATE -> CLEAN
		const { data: cleanRecord, error: updateError } = await supabaseClient
			.schema('files')
			.from('items')
			.update({
				bucket_id: file.target_bucket,
				storage_path: file.target_path,
				status: 'clean',
				updated_at: new Date().toISOString(),
			})
			.eq('id', fileId)
			.select()
			.single();

		if (updateError) throw updateError;

		return new Response(JSON.stringify(cleanRecord), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	} catch (error: any) {
		console.error('Scan/Move Error:', error.message);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 400,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}
});

// --- HELPER FUNCTIONS ---

/**
 * Mocks a VirusTotal Scan.
 * Replace this with actual API calls to VirusTotal or ClamAV.
 */
async function mockScanWithVirusTotal(file: any, supabase: any) {
	console.log(`Scanning ${file.display_name} (${file.size_bytes} bytes)...`);

	// SIMULATION LOGIC:
	// If filename contains "virus" or "eicar", mark as infected.
	const name = (file.original_name || '').toLowerCase();
	if (name.includes('virus') || name.includes('eicar')) {
		return { clean: false, threat: 'EICAR-Test-Signature' };
	}

	// Real implementation would:
	// 1. Get a read stream (like we do for moving).
	// 2. Stream it to the VirusTotal /files endpoint.
	// 3. Await the analysis report.

	return { clean: true, threat: null };
}
