-- Views: messaging (from 0300)

-- security_invoker: the reader's RLS on message_attachments and files.items applies, so a signed-in
-- user lists only the attachments of messages they can read (a definer view listed every one).
CREATE OR REPLACE VIEW comms.message_file_details WITH (security_invoker = true) AS
SELECT ma.message_id, ma.message_table, ma.attachment_id, f.id AS file_id, f.display_name, f.mime_type, f.size_bytes, f.status, f.storage_path
FROM comms.message_attachments ma
    JOIN files.items f ON ma.attachment_id = f.id;
