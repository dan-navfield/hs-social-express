-- BuyICT Extended Fields Migration
-- Adds additional columns to buyict_opportunities for comprehensive data capture

-- Add new columns if they don't exist
DO $$
BEGIN
    -- RFQ details
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'rfq_type') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN rfq_type TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'rfq_id') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN rfq_id TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'deadline_for_questions') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN deadline_for_questions TEXT;
    END IF;
    
    -- Contact
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'buyer_contact') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN buyer_contact TEXT;
    END IF;
    
    -- Contract details
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'estimated_start_date') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN estimated_start_date TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'initial_contract_duration') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN initial_contract_duration TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'extension_term') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN extension_term TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'extension_term_details') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN extension_term_details TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'number_of_extensions') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN number_of_extensions TEXT;
    END IF;
    
    -- Work details
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'industry_briefing') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN industry_briefing TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'location') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN location TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'working_arrangement') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN working_arrangement TEXT;
    END IF;
    
    -- Requirements and criteria
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'requirements') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN requirements TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'criteria') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN criteria JSONB DEFAULT '[]';
    END IF;
    
    -- Engagement type
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buyict_opportunities' AND column_name = 'engagement_type') THEN
        ALTER TABLE buyict_opportunities ADD COLUMN engagement_type TEXT;
    END IF;
END $$;

-- Add indexes for commonly queried new fields
CREATE INDEX IF NOT EXISTS idx_buyict_opp_rfq_type ON buyict_opportunities(rfq_type);
CREATE INDEX IF NOT EXISTS idx_buyict_opp_buyer_contact ON buyict_opportunities(buyer_contact);
