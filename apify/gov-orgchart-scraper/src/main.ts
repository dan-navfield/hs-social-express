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
    '/about-us/who-we-are/our-executive',
    '/about-us/who-we-are/executive',
    '/about-us/who-we-are/leadership',
    '/about-us/who-we-are/our-people',
    '/about-us/who-we-are/senior-executive',
    '/about/our-people',
    '/about/executive',
    '/about/leadership',
    '/about/who-we-are',
    '/about/who-we-are/executive',
    '/our-people',
    '/executive',
    '/leadership',
    '/senior-executives',
    '/our-leadership',
    '/our-executive',
    '/organisational-structure',
    '/org-structure',
    '/who-we-are/executive',
    '/who-we-are/leadership',
    '/who-we-are/our-executive',
    '/who-we-are/our-people',
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
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
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
        
        // Log the raw response for debugging
        console.log(`Gemini raw response for ${agencyName}:`, text.substring(0, 500));
        
        // Extract JSON from response (might be wrapped in markdown code block)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const people = JSON.parse(jsonMatch[0]) as ExtractedPerson[];
                console.log(`Gemini parsed ${people.length} people for ${agencyName}`);
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
        
        console.log(`Gemini returned no JSON array for ${agencyName}`);
        return [];
    } catch (error) {
        console.error('Gemini extraction error:', error);
        return [];
    }
}

// Use Gemini to extract people from a PDF org chart
async function extractPeopleFromPdf(pdfUrl: string, agencyName: string): Promise<ExtractedPerson[]> {
    console.log(`Downloading PDF: ${pdfUrl}`);
    
    try {
        // Download PDF with timeout and retry
        let pdfBuffer: ArrayBuffer | null = null;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`PDF download attempt ${attempt}/3...`);
                
                // Create AbortController for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
                
                const pdfResponse = await fetch(pdfUrl, { 
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; GovScraper/1.0)'
                    }
                });
                clearTimeout(timeoutId);
                
                if (!pdfResponse.ok) {
                    console.error(`PDF HTTP error: ${pdfResponse.status}`);
                    return [];
                }
                
                pdfBuffer = await pdfResponse.arrayBuffer();
                console.log(`Downloaded PDF: ${pdfBuffer.byteLength} bytes`);
                break; // Success, exit retry loop
                
            } catch (fetchError: any) {
                console.error(`PDF download attempt ${attempt} failed: ${fetchError.message}`);
                if (attempt === 3) {
                    console.error('All PDF download attempts failed');
                    return [];
                }
                // Wait before retry
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        if (!pdfBuffer) {
            console.error('No PDF buffer after retries');
            return [];
        }
        
        const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
        console.log(`PDF base64 encoded: ${pdfBase64.length} chars`);
        
        const prompt = `You are analyzing a PDF organisational chart from an Australian government agency.
    
AGENCY: ${agencyName}

This is an organizational chart PDF. Extract ALL the senior executives/leadership shown.

For each person found, extract:
- name: Full name (REQUIRED - must be an actual person's name)
- title: Their position/title (e.g., "Commissioner", "Deputy Secretary", "First Assistant Secretary")
- division: The division/branch they lead (if shown)
- seniority_level: 1=Commissioner/Secretary/CEO, 2=Deputy Secretary/COO, 3=First Assistant Secretary/Group Manager, 4=Assistant Secretary/Director, 5=Other

Return ONLY a valid JSON array. Extract everyone visible in the org chart, focusing on top 3-4 levels of leadership.

Example format:
[{"name": "Jane Smith", "title": "Commissioner", "division": null, "seniority_level": 1}]`;

        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
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
                                inlineData: {
                                    mimeType: 'application/pdf',
                                    data: pdfBase64
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
            const errorText = await response.text();
            console.error('Gemini PDF API error:', errorText);
            return [];
        }
        
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        console.log('Gemini PDF response:', text.substring(0, 500));
        
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const people = JSON.parse(jsonMatch[0]) as ExtractedPerson[];
                const filtered = people.filter(p => 
                    p.name && 
                    p.name.length > 2 && 
                    !p.name.toLowerCase().includes('not mentioned')
                );
                console.log(`Extracted ${filtered.length} people from PDF`);
                return filtered;
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

// Extract people from PDF when we already have base64 data
async function extractPeopleFromPdfBase64(pdfBase64: string, agencyName: string): Promise<ExtractedPerson[]> {
    console.log(`Sending PDF to Gemini (${pdfBase64.length} chars)`);
    
    const prompt = `You are analyzing a PDF organisational chart from an Australian government agency.
    
AGENCY: ${agencyName}

This is an organizational chart PDF. Extract ALL the senior executives/leadership shown.

For each person found, extract:
- name: Full name (REQUIRED - must be an actual person's name like "John Smith" or "Dr Jane Doe")
- title: Their position/title (e.g., "Commissioner", "Deputy Secretary", "Assistant Commissioner")
- division: The division/branch they lead (if shown)
- seniority_level: 1=Commissioner/Secretary/CEO, 2=Deputy Commissioner/COO, 3=First Assistant Secretary/Group Manager, 4=Assistant Secretary/Director, 5=Other

Return ONLY a valid JSON array. Extract EVERYONE visible in the org chart - typically 15-30+ people.

Example format:
[{"name": "Jane Smith", "title": "Commissioner", "division": null, "seniority_level": 1}]`;

    try {
        const response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
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
                                inlineData: {
                                    mimeType: 'application/pdf',
                                    data: pdfBase64
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
            const errorText = await response.text();
            console.error('Gemini PDF API error:', errorText);
            return [];
        }
        
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        console.log('Gemini response length:', text.length);
        
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const people = JSON.parse(jsonMatch[0]) as ExtractedPerson[];
                const filtered = people.filter(p => 
                    p.name && 
                    p.name.length > 2 && 
                    !p.name.toLowerCase().includes('not mentioned')
                );
                console.log(`Gemini extracted ${filtered.length} people from PDF`);
                return filtered;
            } catch (e) {
                console.error('Failed to parse Gemini response:', e);
                return [];
            }
        }
        
        return [];
    } catch (error) {
        console.error('Gemini API error:', error);
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
                
                // First, look for PDF org chart links (broader search)
                const pdfLinks = await page.evaluate(() => {
                    // Find ALL PDF links on the page
                    const allPdfLinks = Array.from(document.querySelectorAll('a[href*=".pdf"]'));
                    
                    // Also find links with org chart text that might link to PDFs
                    const orgChartLinks = Array.from(document.querySelectorAll('a')).filter(link => {
                        const text = (link.textContent || '').toLowerCase();
                        return text.includes('org') && (text.includes('chart') || text.includes('structure'));
                    });
                    
                    const pdfs: string[] = [];
                    const seen = new Set<string>();
                    
                    // Add all PDF links
                    for (const link of allPdfLinks) {
                        const href = link.getAttribute('href');
                        if (href && !seen.has(href)) {
                            seen.add(href);
                            pdfs.push(href);
                        }
                    }
                    
                    // Add org chart links (might be PDFs)
                    for (const link of orgChartLinks) {
                        const href = link.getAttribute('href');
                        if (href && !seen.has(href)) {
                            seen.add(href);
                            pdfs.push(href);
                        }
                    }
                    
                    console.log('Found PDF/org chart links:', pdfs);
                    return pdfs;
                });
                
                let allExtractedPeople: ExtractedPerson[] = [];
                let primaryOrgChartUrl = url;
                
                // Process PDF/org chart links
                if (pdfLinks.length > 0) {
                    log.info(`Found ${pdfLinks.length} PDF/org chart link(s)`);
                    
                    for (const pdfLink of pdfLinks) {
                        const linkUrl = new URL(pdfLink, url).href;
                        
                        if (linkUrl.toLowerCase().includes('.pdf')) {
                            // Direct PDF - extract from it
                            log.info(`Attempting to extract from PDF: ${linkUrl}`);
                            
                            const pdfPeople = await extractPeopleFromPdf(linkUrl, agencyName);
                            
                            if (pdfPeople.length > 0) {
                                log.info(`Extracted ${pdfPeople.length} people from PDF`);
                                allExtractedPeople.push(...pdfPeople);
                                primaryOrgChartUrl = linkUrl;
                            }
                        } else {
                            // Not a PDF - might be a page that contains the PDF link
                            // Queue it for deeper crawling
                            log.info(`Org chart link is not a PDF, queuing for deeper crawl: ${linkUrl}`);
                            await crawler.addRequests([{
                                url: linkUrl,
                                userData: { 
                                    type: 'orgchart_page', 
                                    agencyId, 
                                    agencyName 
                                }
                            }]);
                        }
                    }
                }
                
                // ALSO try HTML extraction (in addition to PDF)
                const html = await page.content();
                
                // Check if this looks like a leadership page
                const pageText = await page.evaluate(() => document.body?.textContent || '');
                const hasLeadershipContent = 
                    pageText.toLowerCase().includes('secretary') ||
                    pageText.toLowerCase().includes('executive') ||
                    pageText.toLowerCase().includes('director') ||
                    pageText.toLowerCase().includes('commissioner') ||
                    pageText.toLowerCase().includes('leadership');
                
                log.info(`Leadership content check for ${url}: ${hasLeadershipContent}, pageText length: ${pageText.length}`);
                
                if (hasLeadershipContent) {
                    // Extract people using Gemini from HTML
                    log.info(`Sending ${html.length} chars of HTML to Gemini for ${agencyName}`);
                    const htmlPeople = await extractPeopleWithGemini(html, agencyName);
                    
                    if (htmlPeople.length > 0) {
                        log.info(`Found ${htmlPeople.length} people from HTML`);
                        allExtractedPeople.push(...htmlPeople);
                    } else {
                        log.info(`Gemini returned 0 people from HTML for ${agencyName}`);
                    }
                }
                
                // Dedupe by name
                const seenNames = new Set<string>();
                const dedupedPeople = allExtractedPeople.filter(p => {
                    const nameLower = p.name.toLowerCase();
                    if (seenNames.has(nameLower)) return false;
                    seenNames.add(nameLower);
                    return true;
                });
                
                if (dedupedPeople.length > 0) {
                    log.info(`Total unique people found: ${dedupedPeople.length}`);
                    
                    // Store results
                    let existing = results.get(agencyId);
                    if (!existing) {
                        existing = { agency: { id: agencyId, name: agencyName, website: '' }, people: [] as ExtractedPerson[], orgChartUrl: undefined };
                    }
                    existing.people.push(...dedupedPeople);
                    existing.orgChartUrl = primaryOrgChartUrl;
                    results.set(agencyId, existing);
                    
                    // Send to webhook
                    await sendPeopleToWebhook(agencyId, dedupedPeople, primaryOrgChartUrl);
                } else {
                    log.info(`No people found for ${agencyName}`);
                }
            } catch (error) {
                log.error(`Error extracting from ${url}: ${error}`);
            }
        }
        
        // Handle org chart intermediate page (find the PDF here)
        if (type === 'orgchart_page') {
            log.info(`Processing org chart page: ${url}`);
            
            try {
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(1000);
                
                // Find ALL PDF links on this page
                const pdfLinks = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a[href*=".pdf"]'));
                    return links.map(l => l.getAttribute('href')).filter(Boolean) as string[];
                });
                
                log.info(`Found ${pdfLinks.length} PDF(s) on org chart page`);
                
                for (const pdfLink of pdfLinks) {
                    const pdfUrl = new URL(pdfLink, url).href;
                    log.info(`Downloading PDF via Playwright: ${pdfUrl}`);
                    
                    try {
                        // Use Playwright's request API - this uses browser context and cookies
                        const context = page.context();
                        const apiRequest = context.request;
                        
                        const pdfResponse = await apiRequest.get(pdfUrl, {
                            timeout: 60000,  // 60 second timeout
                            headers: {
                                'Accept': 'application/pdf,*/*',
                            }
                        });
                        
                        if (!pdfResponse.ok()) {
                            log.error(`PDF request failed: ${pdfResponse.status()}`);
                            continue;
                        }
                        
                        const pdfBuffer = await pdfResponse.body();
                        log.info(`Downloaded PDF: ${pdfBuffer.length} bytes`);
                        
                        // Verify it's actually a PDF (starts with %PDF)
                        if (pdfBuffer.length < 1000) {
                            log.error(`PDF too small (${pdfBuffer.length} bytes), likely not a real PDF`);
                            const preview = pdfBuffer.toString('utf8', 0, Math.min(200, pdfBuffer.length));
                            log.error(`Content preview: ${preview}`);
                            continue;
                        }
                        
                        const header = pdfBuffer.toString('utf8', 0, 5);
                        if (!header.startsWith('%PDF')) {
                            log.error(`Not a valid PDF (header: ${header})`);
                            continue;
                        }
                        
                        // Convert to base64 and send to Gemini
                        const pdfBase64 = pdfBuffer.toString('base64');
                        log.info(`PDF base64 encoded: ${pdfBase64.length} chars`);
                        
                        const pdfPeople = await extractPeopleFromPdfBase64(pdfBase64, agencyName);
                        
                        if (pdfPeople.length > 0) {
                            log.info(`Extracted ${pdfPeople.length} people from org chart PDF`);
                            
                            // Store and send results
                            let existing = results.get(agencyId);
                            if (!existing) {
                                existing = { agency: { id: agencyId, name: agencyName, website: '' }, people: [] as ExtractedPerson[], orgChartUrl: undefined };
                            }
                            existing.people.push(...pdfPeople);
                            existing.orgChartUrl = pdfUrl;
                            results.set(agencyId, existing);
                            
                            await sendPeopleToWebhook(agencyId, pdfPeople, pdfUrl);
                        }
                    } catch (pdfError) {
                        log.error(`Failed to download PDF: ${pdfError}`);
                    }
                }
            } catch (error) {
                log.error(`Error processing org chart page ${url}: ${error}`);
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
