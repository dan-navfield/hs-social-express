-- Disable RLS on storage.objects for dev environment
-- This allows all authenticated users to upload/read from storage buckets

-- Make generated-images bucket public for easy access
UPDATE storage.buckets SET public = true WHERE id = 'generated-images';
UPDATE storage.buckets SET public = true WHERE id = 'brand-assets';
UPDATE storage.buckets SET public = true WHERE id = 'final-images';

-- Drop any existing restrictive policies on storage.objects for our buckets
DROP POLICY IF EXISTS "Users can upload to generated-images" ON storage.objects;
DROP POLICY IF EXISTS "Users can read from generated-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users full access to generated-images" ON storage.objects;

-- Create permissive policies for generated-images bucket
CREATE POLICY "Authenticated users full access to generated-images" ON storage.objects
    FOR ALL
    TO authenticated
    USING (bucket_id = 'generated-images')
    WITH CHECK (bucket_id = 'generated-images');

-- Also allow public read access for generated-images
DROP POLICY IF EXISTS "Public read access to generated-images" ON storage.objects;
CREATE POLICY "Public read access to generated-images" ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'generated-images');

-- Same for brand-assets bucket (logos are stored here)
DROP POLICY IF EXISTS "Authenticated users full access to brand-assets" ON storage.objects;
CREATE POLICY "Authenticated users full access to brand-assets" ON storage.objects
    FOR ALL
    TO authenticated
    USING (bucket_id = 'brand-assets')
    WITH CHECK (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "Public read access to brand-assets" ON storage.objects;
CREATE POLICY "Public read access to brand-assets" ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'brand-assets');

