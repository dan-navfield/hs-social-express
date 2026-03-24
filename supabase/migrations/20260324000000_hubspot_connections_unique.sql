-- Add unique constraint on space_id for hubspot_connections (needed for upsert)
ALTER TABLE hubspot_connections ADD CONSTRAINT hubspot_connections_space_id_key UNIQUE (space_id);
