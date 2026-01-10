/**
 * Gov Org Chart Scraper
 * 
 * Discovers leadership pages and extracts key personnel from Australian
 * government agency websites using Gemini AI for intelligent parsing.
 * 
 * Strategy:
 * 1. For each agency, visit their website
 * 2. Search for common leadership page patterns (/about, /our-people, /leadership, /executives)
 * 3. Extract people using AI parsing of HTML or PDF org charts
 * 4. Send extracted people to webhook for database storage
 */

import { Actor } from 'apify';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';

interface ActorInput {
    webhookUrl?: string;
    geminiApiKey: string;
    agencies: Agency[];  // List of agencies to process
    maxAgencies?: number;
}

interface Agency {
    id: string;
    name: string;
    website: string;
}

interface ExtractedPerson {
    name: string;
    title: string;
    division?: string;
    seniority_level?: number;  // 1=Secretary, 2=Deputy, 3=FAS, 4=Director
    photo_url?: string;
    email?: string;
    phone?: string;
}

// Common URL patterns for leadership pages
const LEADERSHIP_PATTERNS = [
    '/about-us/our-people',
    '/about-us/executive',
    '/about-us/leadership',
    '/about-us/senior-executive',
    '/about/our-people',
    '/about/executive',
    '/about/leadership',
    '/our-people',
    '/executive',
    '/leadership',
    '/senior-executives',
    '/our-leadership',
    '/organisational-structure',
    '/org-structure',
    '/who-we-are/executive',
    '/who-we-are/leadership',
];

await Actor.init();

const input = await Actor.getInput<ActorInput>() ?? {} as ActorInput;
const {
    webhookUrl,
    geminiApiKey,
    agencies = [],
    maxAgencies = 100
} = input;

console.log('=== Gov Org Chart Scraper Starting ===');
console.log(`Processing ${Math.min(agencies.length, maxAgencies)} agencies`);
console.log(`Webhook URL: ${webhookUrl ? 'PROVIDED' : 'NOT PROVIDED'}`);
console.log(`Gemini API: ${geminiApiKey ? 'PROVIDED' : 'NOT PROVIDED'}`);

if (!geminiApiKey) {
    console.error('GEMINI_API_KEY is required for AI extraction');
    await Actor.exit();
}

// Results storage
const results: Map<string, { agency: Agency; people: ExtractedPerson[]; orgChartUrl?: string }> = new Map();

// Send batch of extracted people to webhook
async function sendPeopleToWebhook(agencyId: string, people: ExtractedPerson[], orgChartUrl?: string) {
    if (!webhookUrl || people.length === 0) return;
    
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agencyId,
                people,
                orgChartUrl,
                extractedAt: new Date().toISOString(),
                source: 'gov-orgchart-scraper'
            })
        });
        
        if (!response.ok) {
            console.error(`Webhook error for agency ${agencyId}:`, await response.text());
        } else {
            console.log(`Sent ${people.length} people for agency ${agencyId} to webhook`);
        }
    } catch (error) {
        console.error(`Failed to send to webhook for agency ${agencyId}:`, error);
    }
}

// Use Gemini to extract people from HTML content
async function extractPeopleWithGemini(html: string, agencyName: string): Promise<ExtractedPerson[]> {
    const prompt = `You are analyzing a government agency leadership/executive page. Extract all senior personnel mentioned.

AGENCY: ${agencyName}

For each person found, extract:
- name: Full name
- title: Their position/title
- division: The division/branch they lead (if mentioned)
- seniority_level: 1=Secretary/CEO, 2=Deputy Secretary, 3=First Assistant Secretary/Group Manager, 4=Assistant Secretary/Director, 5=Other
- email: If publicly shown
- phone: If publicly shown

Return ONLY a valid JSON array of objects. If no people found, return [].

Example output:
[{"name": "Jane Smith", "title": "Secretary", "division": null, "seniority_level": 1}, {"name": "John Doe", "title": "Deputy Secretary", "division": "Corporate", "seniority_level": 2}]

HTML CONTENT:
${html.substring(0, 50000)}`;  // Limit to 50k chars for Gemini

    try {
        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': geminiApiKey,
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 4096,
                    }
                })
            }
        );
        
        if (!response.ok) {
            console.error('Gemini API error:', await response.text());
            return [];
        }
        
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        // Extract JSON from response (might be wrapped in markdown code block)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.error('Failed to parse Gemini JSON response:', e);
                return [];
            }
        }
        
        return [];
    } catch (error) {
        console.error('Gemini extraction error:', error);
        return [];
    }
}

// Create the crawler
const crawler = new PlaywrightCrawler({
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,
    maxRequestRetries: 2,
    maxConcurrency: 3,
    
    async requestHandler({ page, request, log }) {
        const url = request.url;
        const agencyId = request.userData?.agencyId;
        const agencyName = request.userData?.agencyName;
        const type = request.userData?.type;
        
        if (type === 'homepage') {
            // We're on the agency homepage - look for leadership page links
            log.info(`Checking homepage: ${url}`);
            
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(2000);
            
            // Find leadership page links
            const leadershipUrl = await page.evaluate((patterns) => {
                const links = Array.from(document.querySelectorAll('a[href]'));
                const lowerPatterns = patterns.map(p => p.toLowerCase());
                
                for (const link of links) {
                    const href = link.getAttribute('href')?.toLowerCase() || '';
                    const text = link.textContent?.toLowerCase() || '';
                    
                    // Check URL patterns
                    for (const pattern of lowerPatterns) {
                        if (href.includes(pattern)) {
                            return link.getAttribute('href');
                        }
                    }
                    
                    // Check link text
                    if (text.includes('executive') || 
                        text.includes('leadership') || 
                        text.includes('our people') ||
                        text.includes('senior staff') ||
                        text.includes('org chart') ||
                        text.includes('organisational structure')) {
                        return link.getAttribute('href');
                    }
                }
                
                return null;
            }, LEADERSHIP_PATTERNS);
            
            if (leadershipUrl) {
                // Resolve relative URLs
                const fullUrl = new URL(leadershipUrl, url).href;
                log.info(`Found leadership page: ${fullUrl}`);
                
                await crawler.addRequests([{
                    url: fullUrl,
                    userData: { type: 'leadership', agencyId, agencyName }
                }]);
            } else {
                // Try common patterns as fallback
                const baseUrl = new URL(url).origin;
                for (const pattern of LEADERSHIP_PATTERNS.slice(0, 5)) {
                    await crawler.addRequests([{
                        url: `${baseUrl}${pattern}`,
                        userData: { type: 'leadership', agencyId, agencyName }
                    }]);
                }
            }
            
            return;
        }
        
        if (type === 'leadership') {
            // We're on a potential leadership page - extract people
            log.info(`Extracting people from: ${url}`);
            
            try {
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(2000);
                
                // Get page content
                const html = await page.content();
                
                // Check if this looks like a leadership page
                const pageText = await page.evaluate(() => document.body?.textContent || '');
                const hasLeadershipContent = 
                    pageText.toLowerCase().includes('secretary') ||
                    pageText.toLowerCase().includes('executive') ||
                    pageText.toLowerCase().includes('director') ||
                    pageText.toLowerCase().includes('leadership');
                
                if (!hasLeadershipContent) {
                    log.info(`Page doesn't appear to contain leadership info: ${url}`);
                    return;
                }
                
                // Extract people using Gemini
                const people = await extractPeopleWithGemini(html, agencyName);
                
                if (people.length > 0) {
                    log.info(`Found ${people.length} people at ${agencyName}`);
                    
                    // Store results
                    let existing = results.get(agencyId);
                    if (!existing) {
                        existing = { agency: { id: agencyId, name: agencyName, website: '' }, people: [] as ExtractedPerson[], orgChartUrl: undefined };
                    }
                    existing.people.push(...people);
                    existing.orgChartUrl = url;
                    results.set(agencyId, existing);
                    
                    // Send to webhook immediately
                    await sendPeopleToWebhook(agencyId, people, url);
                }
            } catch (error) {
                log.error(`Error extracting from ${url}: ${error}`);
            }
        }
    },
    
    async failedRequestHandler({ request, log }) {
        log.warning(`Request failed: ${request.url}`);
    }
});

// Queue up agencies to process
const agenciesToProcess = agencies.slice(0, maxAgencies);
console.log(`Queuing ${agenciesToProcess.length} agencies for processing`);

for (const agency of agenciesToProcess) {
    if (!agency.website) {
        console.log(`Skipping ${agency.name} - no website`);
        continue;
    }
    
    // Normalize website URL
    let websiteUrl = agency.website;
    if (!websiteUrl.startsWith('http')) {
        websiteUrl = `https://${websiteUrl}`;
    }
    
    console.log(`Adding ${agency.name}: ${websiteUrl}`);
    
    await crawler.addRequests([{
        url: websiteUrl,
        userData: { 
            type: 'homepage',
            agencyId: agency.id,
            agencyName: agency.name
        }
    }]);
}

// Run the crawler
await crawler.run();

// Summary
console.log('\n=== Extraction Complete ===');
console.log(`Processed ${results.size} agencies`);
let totalPeople = 0;
results.forEach((result, agencyId) => {
    console.log(`  ${result.agency.name}: ${result.people.length} people`);
    totalPeople += result.people.length;
});
console.log(`Total people extracted: ${totalPeople}`);

await Actor.exit();
