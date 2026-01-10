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
    const prompt = `You are analyzing an Australian government agency's leadership/executive webpage. Your task is to extract the names and titles of all senior personnel mentioned.

AGENCY: ${agencyName}

IMPORTANT INSTRUCTIONS:
1. Look for actual person names - typically in headings (h2, h3) or bold text
2. Names are usually in format "FirstName LastName" or "Dr. FirstName LastName" etc.
3. DO NOT use placeholders like "Not mentioned" - only return people with actual names
4. Look for titles like "Commissioner", "Secretary", "Deputy Secretary", "Chief Executive", "Executive Director", etc.
5. If you cannot find any person's actual name, return an empty array []

For each person found, extract:
- name: The person's FULL NAME (required - must be an actual name, not a placeholder)
- title: Their position/title (e.g., "Commissioner", "Deputy Secretary")
- division: The division/branch they lead (if mentioned)
- seniority_level: 1=Commissioner/Secretary/CEO, 2=Deputy Secretary/COO, 3=First Assistant Secretary/Group Manager, 4=Assistant Secretary/Director, 5=Other
- email: If publicly shown
- phone: If publicly shown

Return ONLY a valid JSON array. If no actual named people found, return [].

Example good output:
[{"name": "Liz Hefren-Webb", "title": "Commissioner", "division": null, "seniority_level": 1}]

Example bad output (DO NOT DO THIS):
[{"name": "Not mentioned", "title": "Executive", "seniority_level": 2}]

HTML CONTENT (look for names in headings and bold text):
${html.substring(0, 50000)}`;

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
                const people = JSON.parse(jsonMatch[0]) as ExtractedPerson[];
                // Filter out any entries with placeholder names
                return people.filter(p => 
                    p.name && 
                    p.name.length > 2 && 
                    !p.name.toLowerCase().includes('not mentioned') &&
                    !p.name.toLowerCase().includes('unknown') &&
                    !p.name.toLowerCase().includes('placeholder')
                );
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

// Use Gemini to extract people from a PDF org chart
async function extractPeopleFromPdf(pdfUrl: string, agencyName: string): Promise<ExtractedPerson[]> {
    console.log(`Extracting from PDF: ${pdfUrl}`);
    
    const prompt = `You are analyzing a PDF organisational chart from an Australian government agency.
    
AGENCY: ${agencyName}
PDF URL: ${pdfUrl}

Please access this PDF and extract all the senior executives/leadership shown in the org chart.

For each person found, extract:
- name: Full name (REQUIRED - actual name, not placeholder)
- title: Their position/title
- division: The division/branch they lead
- seniority_level: 1=Commissioner/Secretary/CEO, 2=Deputy Secretary/COO, 3=First Assistant Secretary/Group Manager, 4=Assistant Secretary/Director, 5=Other

Return ONLY a valid JSON array. Focus on the top 2-3 levels of the hierarchy.`;

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
                        parts: [
                            { text: prompt },
                            { 
                                fileData: {
                                    mimeType: 'application/pdf',
                                    fileUri: pdfUrl
                                }
                            }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 8192,
                    }
                })
            }
        );
        
        if (!response.ok) {
            console.error('Gemini PDF API error:', await response.text());
            return [];
        }
        
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const people = JSON.parse(jsonMatch[0]) as ExtractedPerson[];
                return people.filter(p => 
                    p.name && 
                    p.name.length > 2 && 
                    !p.name.toLowerCase().includes('not mentioned')
                );
            } catch (e) {
                console.error('Failed to parse PDF extraction response:', e);
                return [];
            }
        }
        
        return [];
    } catch (error) {
        console.error('PDF extraction error:', error);
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
                
                // First, look for PDF org chart links
                const pdfLinks = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a[href$=".pdf"]'));
                    const orgChartPdfs: string[] = [];
                    
                    for (const link of links) {
                        const href = link.getAttribute('href') || '';
                        const text = (link.textContent || '').toLowerCase();
                        
                        // Look for org chart related PDFs
                        if (text.includes('org') || 
                            text.includes('chart') || 
                            text.includes('structure') ||
                            href.toLowerCase().includes('org') ||
                            href.toLowerCase().includes('chart') ||
                            href.toLowerCase().includes('structure')) {
                            orgChartPdfs.push(href);
                        }
                    }
                    
                    return orgChartPdfs;
                });
                
                // If we found PDF org charts, try to extract from them
                if (pdfLinks.length > 0) {
                    log.info(`Found ${pdfLinks.length} PDF org chart(s)`);
                    
                    for (const pdfLink of pdfLinks) {
                        const pdfUrl = new URL(pdfLink, url).href;
                        log.info(`Attempting to extract from PDF: ${pdfUrl}`);
                        
                        const pdfPeople = await extractPeopleFromPdf(pdfUrl, agencyName);
                        
                        if (pdfPeople.length > 0) {
                            log.info(`Extracted ${pdfPeople.length} people from PDF`);
                            
                            // Store and send results
                            let existing = results.get(agencyId);
                            if (!existing) {
                                existing = { agency: { id: agencyId, name: agencyName, website: '' }, people: [] as ExtractedPerson[], orgChartUrl: undefined };
                            }
                            existing.people.push(...pdfPeople);
                            existing.orgChartUrl = pdfUrl;
                            results.set(agencyId, existing);
                            
                            await sendPeopleToWebhook(agencyId, pdfPeople, pdfUrl);
                            return; // Successfully got from PDF, don't also try HTML
                        }
                    }
                }
                
                // Fall back to HTML extraction
                const html = await page.content();
                
                // Check if this looks like a leadership page
                const pageText = await page.evaluate(() => document.body?.textContent || '');
                const hasLeadershipContent = 
                    pageText.toLowerCase().includes('secretary') ||
                    pageText.toLowerCase().includes('executive') ||
                    pageText.toLowerCase().includes('director') ||
                    pageText.toLowerCase().includes('commissioner') ||
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
