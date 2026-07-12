CREATE OR REPLACE VIEW comms.message_file_details AS
SELECT ma.message_id, ma.message_table, ma.attachment_id, f.id AS file_id, f.display_name, f.mime_type, f.size_bytes, f.status, f.storage_path
FROM comms.message_attachments ma
    JOIN files.items f ON ma.attachment_id = f.id;

GRANT SELECT ON comms.message_file_details TO authenticated;

GRANT SELECT ON comms.message_file_details TO service_role;