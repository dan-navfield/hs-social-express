// Post Image Types

export interface PostImage {
    id: string;
    post_id: string;
    space_id: string;
    source_type: 'generated' | 'uploaded';
    storage_path: string;
    thumbnail_path: string | null;
    prompt_used: string | null;
    settings_used: ImageSettings | null;
    generation_status: 'pending' | 'generating' | 'completed' | 'failed';
    error: string | null;
    is_primary: boolean;
    width: number;
    height: number;
    file_size: number | null;
    mime_type: string;
    created_at: string;
}

export interface ImageSettings {
    style: 'photographic' | 'illustrative';
    include_people: boolean;
    include_text: boolean;
    include_logos: boolean;
    aspect_ratio: '1:1' | '4:5' | '16:9' | '9:16';
}

export type ImageStatus = 'no_image' | 'prompt_ready' | 'generating' | 'images_available' | 'failed';

export type PromptStyle = 'realistic' | 'editorial';

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
    style: 'photographic',
    include_people: true,
    include_text: false,
    include_logos: false,
    aspect_ratio: '1:1',
};

export const ASPECT_RATIO_DIMENSIONS: Record<ImageSettings['aspect_ratio'], { width: number; height: number }> = {
    '1:1': { width: 1024, height: 1024 },
    '4:5': { width: 1024, height: 1280 },
    '16:9': { width: 1920, height: 1080 },
    '9:16': { width: 1080, height: 1920 },
};

export const IMAGE_STATUS_LABELS: Record<ImageStatus, string> = {
    'no_image': 'No Image',
    'prompt_ready': 'Prompt Ready',
    'generating': 'Generating...',
    'images_available': 'Images Available',
    'failed': 'Failed',
};

export const IMAGE_STATUS_COLORS: Record<ImageStatus, string> = {
    'no_image': 'gray',
    'prompt_ready': 'blue',
    'generating': 'yellow',
    'images_available': 'green',
    'failed': 'red',
};
