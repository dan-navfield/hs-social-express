-- Add slug column for friendly URLs
ALTER TABLE gov_agencies ADD COLUMN IF NOT EXISTS slug TEXT;

-- Create unique index on slug
CREATE UNIQUE INDEX IF NOT EXISTS idx_gov_agencies_slug ON gov_agencies(space_id, slug);

-- Function to generate slug from name
CREATE OR REPLACE FUNCTION generate_agency_slug(agency_name TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN lower(
        regexp_replace(
            regexp_replace(
                regexp_replace(agency_name, '[^a-zA-Z0-9\s-]', '', 'g'),  -- Remove special chars
                '\s+', '-', 'g'  -- Replace spaces with hyphens
            ),
            '-+', '-', 'g'  -- Remove multiple hyphens
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Populate slugs for existing agencies
UPDATE gov_agencies 
SET slug = generate_agency_slug(name)
WHERE slug IS NULL;

-- Add trigger to auto-generate slug on insert
CREATE OR REPLACE FUNCTION set_agency_slug()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        NEW.slug := generate_agency_slug(NEW.name);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agency_slug_trigger ON gov_agencies;
CREATE TRIGGER agency_slug_trigger
    BEFORE INSERT OR UPDATE ON gov_agencies
    FOR EACH ROW
    EXECUTE FUNCTION set_agency_slug();
