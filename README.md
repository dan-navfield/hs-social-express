# HS Social Express

AI-powered LinkedIn content generation platform with campaign management, image generation, and logo overlay capabilities.

## Features

- **Campaign Management** - Create and manage LinkedIn content campaigns
- **AI Post Generation** - Generate engaging LinkedIn posts using GPT-4
- **AI Image Generation** - Create custom images using Gemini 2.5 Flash Image API
- **Logo Overlay** - Apply brand logos to generated images with client-side canvas compositing
- **Brand Studio** - Configure brand voice, tone, and visual assets
- **Bulk Operations** - Generate images and apply logos to multiple posts at once
- **Status Tracking** - Track post workflow from Draft → Ready → Published

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: CSS with custom design tokens
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **AI**: OpenAI GPT-4 for text, Gemini 2.5 Flash for images
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account

### Environment Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your Supabase credentials:
   ```
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

### Installation

```bash
npm install
npm run dev
```

### Supabase Setup

1. Create a new Supabase project
2. Run the migrations in `supabase/migrations/` in order
3. Deploy edge functions:
   ```bash
   npx supabase functions deploy generate-posts --no-verify-jwt
   npx supabase functions deploy generate-campaign-posts --no-verify-jwt
   npx supabase functions deploy generate-image-prompt --no-verify-jwt
   npx supabase functions deploy generate-post-images --no-verify-jwt
   ```

4. Set edge function secrets:
   ```bash
   npx supabase secrets set OPENAI_API_KEY=your_openai_key
   npx supabase secrets set GOOGLE_AI_API_KEY=your_gemini_key
   ```

## Deployment

### Vercel

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy

## License

Private - All rights reserved
