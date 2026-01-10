-- Add unique constraint for upserting people
-- This allows the webhook to upsert people by agency_id + name

ALTER TABLE gov_agency_people 
ADD CONSTRAINT gov_agency_people_agency_name_unique 
UNIQUE (agency_id, name);

-- Add index for faster lookups by seniority
CREATE INDEX IF NOT EXISTS idx_gov_people_seniority_level 
ON gov_agency_people(seniority_level);
