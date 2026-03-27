-- AI model settings per space
CREATE TABLE IF NOT EXISTS ai_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    text_provider TEXT NOT NULL DEFAULT 'openai',
    text_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    image_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash-image',
    image_prompt_model TEXT NOT NULL DEFAULT 'gemini-2.0-flash-exp',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_settings_space_unique UNIQUE (space_id)
);
