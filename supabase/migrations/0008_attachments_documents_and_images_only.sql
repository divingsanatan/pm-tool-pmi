-- Already applied to the live project (attachments_documents_and_images_only). Kept here as a record.
-- Work item attachments: images and documents only (no video or audio).
-- Documents: PDF, Word, Excel, PowerPoint, OpenDocument, plain text, CSV, RTF, Markdown. Not allowed on purpose: SVG, HTML, scripts, programs and archives.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg','image/png','image/gif','image/webp','image/avif',
  'application/pdf',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet','application/vnd.oasis.opendocument.presentation',
  'text/plain','text/csv','application/rtf','text/markdown'
]
where id = 'attachments';
