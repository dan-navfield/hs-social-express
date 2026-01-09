-- BuyICT Labour Hire Fields Migration
-- Adds columns for Labour Hire specific data

DO $$
BEGIN
    -- Opportunity type (role vs service)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'opportunity_type') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN opportunity_type TEXT;
    END IF;
    
    -- Key duties for labour hire
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'key_duties') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN key_duties TEXT;
    END IF;
    
    -- Experience level
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'experience_level') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN experience_level TEXT;
    END IF;
    
    -- Maximum hours
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'max_hours') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN max_hours TEXT;
    END IF;
    
    -- Security clearance
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'security_clearance') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN security_clearance TEXT;
    END IF;
END $$;

-- Add index for opportunity type
CREATE INDEX IF NOT EXISTS idx_buyict_opp_type ON buyict_opportunities(opportunity_type);
