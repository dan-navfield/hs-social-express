/**
 * BuyICT Opportunities Scraper
 * 
 * This Apify actor scrapes procurement opportunities from BuyICT.gov.au
 * It handles authentication and extracts opportunity details including contacts.
 * 
 * Deploy to Apify: https://console.apify.com/actors
 * 
 * Based on actual BuyICT page structure:
 * - List page: Card-based layout with filters
 * - Detail page: RFQ details table, opportunity summary, job details, criteria
 */

import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

interface BuyICTCredentials {
    email: string;
    password: string;
}

interface OpportunityData {
    buyict_reference: string;
    buyict_url: string;
    title: string;
    buyer_entity_raw: string | null;
    category: string | null;
    description: string | null;
    publish_date: string | null;
    closing_date: string | null;
    opportunity_status: string | null;
    contact_text_raw: string | null;
    rfq_id: string | null;
    target_sector: string | null;
    engagement_type: string | null;
    estimated_value: string | null;
    location: string | null;
    experience_level: string | null;
    working_arrangement: string | null;
    key_duties: string | null;
    criteria: string[];
    attachments: { name: string; url: string; type: string }[];
}

interface ActorInput {
    credentials?: BuyICTCredentials;
    webhookUrl?: string;
    spaceId?: string;
    maxOpportunities?: number;
    filterStatus?: 'open' | 'closed' | 'all';
}

await Actor.init();

const input = await Actor.getInput<ActorInput>() ?? {};
const {
    credentials,
    webhookUrl,
    spaceId,
    maxOpportunities = 100,
    filterStatus = 'open'
} = input;

if (!credentials?.email || !credentials?.password) {
    console.log('No BuyICT credentials provided - will scrape public opportunities only');
}

const opportunities: OpportunityData[] = [];

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: maxOpportunities + 20, // Extra for pagination
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,
    
    async requestHandler({ page, request, enqueueLinks, log }) {
        const url = request.url;
        
        // Handle login page
        if (url.includes('login') || await page.$('input[type="email"], input[name="email"], #email')) {
            log.info('Logging into BuyICT...');
            
            // Wait for login form
            await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 15000 });
            
            // Fill credentials - try multiple selector patterns
            const emailInput = await page.$('input[type="email"], input[name="email"], #email');
            const passwordInput = await page.$('input[type="password"], input[name="password"], #password');
            
            if (emailInput && passwordInput) {
                await emailInput.fill(credentials!.email);
                await passwordInput.fill(credentials!.password);
                
                // Submit form - try multiple patterns
                const submitButton = await page.$('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');
                if (submitButton) {
                    await submitButton.click();
                } else {
                    await page.keyboard.press('Enter');
                }
                
                // Wait for navigation
                await page.waitForLoadState('networkidle', { timeout: 30000 });
                
                log.info('Login successful, navigating to opportunities...');
                await page.goto('https://buyict.gov.au/opportunities');
                await page.waitForLoadState('networkidle');
            }
        }
        
        // Handle opportunities listing page
        if (url.includes('/opportunities') && !url.match(/\/opportunities\/[\w-]+$/)) {
            log.info('Scraping opportunities listing page...');
            
            // Wait for opportunity cards to load (based on screenshot - card layout)
            await page.waitForTimeout(3000); // Allow dynamic content to load
            
            // Try to find opportunity cards/links
            const opportunityLinks = await page.evaluate(() => {
                const links: { url: string; title: string }[] = [];
                
                // Find all "View details" links or opportunity card links
                const viewDetailsLinks = document.querySelectorAll('a[href*="/opportunities/"]');
                viewDetailsLinks.forEach((link) => {
                    const href = (link as HTMLAnchorElement).href;
                    // Skip if it's just the base opportunities page
                    if (href !== 'https://buyict.gov.au/opportunities' && 
                        href !== 'https://buyict.gov.au/opportunities/' &&
                        !href.includes('?')) {
                        const title = link.closest('article, .card, [class*="opportunity"]')?.querySelector('h2, h3, .title')?.textContent?.trim() || 
                                      link.textContent?.trim() || '';
                        links.push({ url: href, title });
                    }
                });
                
                // Deduplicate
                return [...new Map(links.map(l => [l.url, l])).values()];
            });
            
            log.info(`Found ${opportunityLinks.length} opportunity links on this page`);
            
            // Enqueue individual opportunity pages
            for (const link of opportunityLinks.slice(0, maxOpportunities - opportunities.length)) {
                if (opportunities.length >= maxOpportunities) break;
                await enqueueLinks({
                    urls: [link.url],
                    label: 'OPPORTUNITY_DETAIL'
                });
            }
            
            // Handle pagination - look for next page link/button
            if (opportunities.length < maxOpportunities) {
                const nextPage = await page.$('a:has-text("Next"), button:has-text("Next"), nav[aria-label="pagination"] a:last-child, .pagination a:last-child');
                if (nextPage) {
                    const nextUrl = await nextPage.getAttribute('href');
                    if (nextUrl && !nextUrl.includes('#')) {
                        log.info('Found next page, enqueueing...');
                        await enqueueLinks({
                            urls: [nextUrl.startsWith('http') ? nextUrl : `https://buyict.gov.au${nextUrl}`],
                            label: 'LISTING'
                        });
                    }
                }
            }
        }
        
        // Handle individual opportunity page
        if (request.label === 'OPPORTUNITY_DETAIL' || url.match(/\/opportunities\/[\w-]+$/)) {
            log.info(`Scraping opportunity detail: ${url}`);
            
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(2000); // Allow dynamic content
            
            // Extract opportunity details based on actual BuyICT page structure
            const opportunity = await page.evaluate(() => {
                const getText = (selectors: string[]): string | null => {
                    for (const selector of selectors) {
                        const el = document.querySelector(selector);
                        if (el?.textContent?.trim()) {
                            return el.textContent.trim();
                        }
                    }
                    return null;
                };
                
                const getTableValue = (label: string): string | null => {
                    // Look for definition list patterns (dt/dd) or table patterns (th/td)
                    const dtElements = document.querySelectorAll('dt, th, .label, [class*="label"]');
                    for (const dt of dtElements) {
                        if (dt.textContent?.toLowerCase().includes(label.toLowerCase())) {
                            const dd = dt.nextElementSibling;
                            if (dd) return dd.textContent?.trim() || null;
                        }
                    }
                    // Try table rows
                    const rows = document.querySelectorAll('tr');
                    for (const row of rows) {
                        const cells = row.querySelectorAll('td, th');
                        if (cells[0]?.textContent?.toLowerCase().includes(label.toLowerCase())) {
                            return cells[1]?.textContent?.trim() || null;
                        }
                    }
                    return null;
                };
                
                // Title - usually in h1 or main heading
                const title = getText(['h1', '.page-title', '[class*="title"]:first-of-type', 'main h1']);
                
                // RFQ ID
                const rfqId = getTableValue('rfqid') || getTableValue('rfq id') || getTableValue('reference');
                
                // Dates
                const publishDate = getTableValue('publish') || getTableValue('posted') || getTableValue('rfp published');
                const closingDate = getTableValue('closing') || getTableValue('close') || getTableValue('deadline');
                
                // Target/Agency
                const buyerEntity = getTableValue('target') || getTableValue('agency') || getTableValue('department') || getTableValue('buyer');
                
                // Category/Type
                const category = getTableValue('type') || getTableValue('category') || getTableValue('aps');
                
                // Engagement details
                const engagementType = getTableValue('engagement') || getTableValue('working arrangement');
                const location = getTableValue('location') || getTableValue('work location');
                const experienceLevel = getTableValue('experience') || getTableValue('level');
                
                // Estimated value (from opportunity summary box)
                const estimatedValue = getTableValue('estimated') || getTableValue('value') || getTableValue('contract');
                
                // Job details/Description
                const description = getText([
                    '[class*="job-detail"] p',
                    '[class*="description"] p', 
                    'section:has(h2:contains("Job details")) p',
                    'main section p'
                ]);
                
                // Key duties
                const keyDuties = getText([
                    '[class*="duties"]',
                    'section:has(h2:contains("Key duties"))',
                    'section:has(h2:contains("Responsibilities"))'
                ]);
                
                // Criteria
                const criteriaElements = document.querySelectorAll('li, [class*="criteria"] p');
                const criteria: string[] = [];
                criteriaElements.forEach((el) => {
                    const text = el.textContent?.trim();
                    if (text && text.length > 20 && text.length < 500) {
                        criteria.push(text);
                    }
                });
                
                // Contact info (look for emails and contact sections)
                const allText = document.body.textContent || '';
                const emailMatches = allText.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
                const contactText = emailMatches.length > 0 ? emailMatches.join(', ') : null;
                
                // Status
                const status = getText([
                    '.status', 
                    '[class*="status"]',
                    '.badge'
                ]) || 'Open';
                
                // Attachments
                const attachments = Array.from(document.querySelectorAll('a[href*=".pdf"], a[href*=".doc"], a[href*=".xlsx"], a[download]'))
                    .map((link) => ({
                        name: link.textContent?.trim() || 'Attachment',
                        url: (link as HTMLAnchorElement).href,
                        type: (link as HTMLAnchorElement).href.split('.').pop()?.split('?')[0] || 'unknown'
                    }));
                
                return {
                    title,
                    rfqId,
                    publishDate,
                    closingDate,
                    buyerEntity,
                    category,
                    engagementType,
                    location,
                    experienceLevel,
                    estimatedValue,
                    description,
                    keyDuties,
                    criteria: criteria.slice(0, 20), // Limit criteria
                    contactText,
                    status,
                    attachments
                };
            });
            
            if (opportunity.title) {
                // Extract reference from URL
                const urlMatch = url.match(/\/opportunities\/([\w-]+)/);
                const reference = opportunity.rfqId || urlMatch?.[1] || url.split('/').pop() || '';
                
                const oppData: OpportunityData = {
                    buyict_reference: reference,
                    buyict_url: url,
                    title: opportunity.title,
                    buyer_entity_raw: opportunity.buyerEntity,
                    category: opportunity.category,
                    description: opportunity.description,
                    publish_date: opportunity.publishDate,
                    closing_date: opportunity.closingDate,
                    opportunity_status: opportunity.status,
                    contact_text_raw: opportunity.contactText,
                    rfq_id: opportunity.rfqId,
                    target_sector: opportunity.buyerEntity,
                    engagement_type: opportunity.engagementType,
                    estimated_value: opportunity.estimatedValue,
                    location: opportunity.location,
                    experience_level: opportunity.experienceLevel,
                    working_arrangement: opportunity.engagementType,
                    key_duties: opportunity.keyDuties,
                    criteria: opportunity.criteria,
                    attachments: opportunity.attachments
                };
                
                opportunities.push(oppData);
                await Dataset.pushData(oppData);
                log.info(`✓ Scraped: ${oppData.title} (${oppData.buyict_reference})`);
            } else {
                log.warning(`Could not extract title from ${url}`);
            }
        }
    },
    
    failedRequestHandler({ request, log }) {
        log.error(`Request failed: ${request.url}`);
    }
});

// Start crawling from the opportunities page
await crawler.run(['https://buyict.gov.au/opportunities']);

console.log(`\n=== Scraping Complete ===`);
console.log(`Total opportunities scraped: ${opportunities.length}`);

// Send to webhook if configured
if (webhookUrl && opportunities.length > 0) {
    console.log(`Sending ${opportunities.length} opportunities to webhook: ${webhookUrl}`);
    
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                spaceId,
                opportunities,
                scrapedAt: new Date().toISOString(),
                totalCount: opportunities.length,
                source: 'apify-buyict-scraper'
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Webhook failed: ${response.status} - ${errorText}`);
        } else {
            console.log('✓ Webhook sent successfully');
        }
    } catch (error) {
        console.error('Webhook error:', error);
    }
} else if (!webhookUrl) {
    console.log('No webhook URL configured - data saved to Apify dataset only');
}

await Actor.exit();
