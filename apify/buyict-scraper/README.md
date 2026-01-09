# BuyICT Scraper for Apify

This is a Playwright-based Apify actor that scrapes procurement opportunities from BuyICT.gov.au.

## Features

- ✅ Handles BuyICT authentication
- ✅ Scrapes opportunity listings with pagination
- ✅ Extracts detailed opportunity data (title, buyer, dates, contacts, criteria)
- ✅ Extracts email addresses from contact fields and descriptions
- ✅ Sends data to webhook (Supabase Edge Function)
- ✅ Outputs to Apify dataset for manual review

## Deployment to Apify

### Option 1: Via Apify CLI

```bash
cd apify/buyict-scraper
npm install -g apify-cli
apify login
apify push
```

### Option 2: Via Apify Console (Manual)

1. Go to [Apify Console → Actors](https://console.apify.com/actors)
2. Click "Create new" → "From scratch"
3. Name it `buyict-scraper`
4. In the Source section:
   - Upload all files from this directory
   - Or connect to your GitHub repo
5. Click "Build" and wait for completion

## Configuration

### Input Schema

The actor accepts the following inputs:

```json
{
  "credentials": {
    "email": "your-buyict-email@example.com",
    "password": "your-buyict-password"
  },
  "webhookUrl": "https://your-supabase-project.supabase.co/functions/v1/buyict-sync-webhook",
  "spaceId": "your-workspace-id",
  "maxOpportunities": 100,
  "filterStatus": "open"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `credentials.email` | ✅ | Your BuyICT login email |
| `credentials.password` | ✅ | Your BuyICT login password |
| `webhookUrl` | ❌ | URL to POST scraped data to |
| `spaceId` | ❌ | Your workspace ID (for multi-tenant) |
| `maxOpportunities` | ❌ | Max opportunities to scrape (default: 100) |
| `filterStatus` | ❌ | Filter: "open", "closed", or "all" |

## Output Format

Each scraped opportunity contains:

```typescript
{
  buyict_reference: string,
  buyict_url: string,
  title: string,
  buyer_entity_raw: string | null,
  category: string | null,
  description: string | null,
  publish_date: string | null,
  closing_date: string | null,
  opportunity_status: string | null,
  contact_text_raw: string | null,
  rfq_id: string | null,
  target_sector: string | null,
  engagement_type: string | null,
  estimated_value: string | null,
  location: string | null,
  experience_level: string | null,
  working_arrangement: string | null,
  key_duties: string | null,
  criteria: string[],
  attachments: { name: string, url: string, type: string }[]
}
```

## Webhook Payload

When `webhookUrl` is configured, the actor POSTs:

```json
{
  "spaceId": "workspace-uuid",
  "opportunities": [...],
  "scrapedAt": "2024-01-08T12:00:00.000Z",
  "totalCount": 50,
  "source": "apify-buyict-scraper"
}
```

## Scheduling

To schedule regular syncs:

1. Go to your actor in Apify Console
2. Click "Schedules" tab
3. Create a new schedule (e.g., daily at 6am)
4. Configure the input with your credentials and webhook URL

## Security Notes

- ⚠️ Store credentials as Apify secrets, not plain text in input
- ⚠️ Use only with your own BuyICT account
- ⚠️ Respect BuyICT's terms of service and rate limits
- ⚠️ The actor runs in headless mode within Apify's infrastructure

## Local Development

```bash
cd apify/buyict-scraper
npm install
npm run build
npm run start
```

You'll need to set the input in `storage/key_value_stores/default/INPUT.json`.

## Support

For issues, check:
1. Apify run logs for error messages
2. Browser screenshots in the run's key-value store
3. Network requests in the run's request queue
