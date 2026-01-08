-- Brand Assets - Logo storage in brand_profile
-- Adding columns for logo URLs and brand assets

ALTER TABLE brand_profile
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS logo_position TEXT DEFAULT 'bottom-right',  -- Position for main logo
ADD COLUMN IF NOT EXISTS logo_top_left_url TEXT,
ADD COLUMN IF NOT EXISTS logo_top_left_position TEXT DEFAULT 'top-left',  -- fine-tuning within corner
ADD COLUMN IF NOT EXISTS logo_bottom_right_url TEXT,
ADD COLUMN IF NOT EXISTS logo_bottom_right_position TEXT DEFAULT 'bottom-right',
ADD COLUMN IF NOT EXISTS logo_corner_url TEXT,  -- Keep for backwards compatibility
ADD COLUMN IF NOT EXISTS brand_colors JSONB DEFAULT '[]';  -- Array of hex colors

-- Create storage bucket for brand assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their space folder
DROP POLICY IF EXISTS "Users can upload brand assets" ON storage.objects;
CREATE POLICY "Users can upload brand assets" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'brand-assets');

-- Allow public read access for logos
DROP POLICY IF EXISTS "Public read access for brand assets" ON storage.objects;
CREATE POLICY "Public read access for brand assets" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'brand-assets');

-- Allow authenticated users to update/delete their uploads
DROP POLICY IF EXISTS "Users can manage their brand assets" ON storage.objects;
CREATE POLICY "Users can manage their brand assets" ON storage.objects
FOR ALL TO authenticated
USING (bucket_id = 'brand-assets')
WITH CHECK (bucket_id = 'brand-assets');

