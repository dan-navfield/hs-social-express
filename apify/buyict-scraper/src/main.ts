/**
 * BuyICT Opportunities Scraper
 * 
 * This Apify actor scrapes procurement opportunities from BuyICT.gov.au
 * It handles authentication and extracts opportunity details including contacts.
 * 
 * Deploy to Apify: https://console.apify.com/actors
 * 
 * Based on actual BuyICT page structure:
 * - URL: https://www.buyict.gov.au/sp?id=opportunities
 * - Cards with "View details" links
 * - ServiceNow-based portal
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
    module: string | null;
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
const BASE_URL = 'https://www.buyict.gov.au';

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: maxOpportunities + 50, // Extra for pagination
    navigationTimeoutSecs: 90,
    requestHandlerTimeoutSecs: 180,
    
    async requestHandler({ page, request, enqueueLinks, log }) {
        const url = request.url;
        
        // Wait for page to load
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
        
        // Check if we're on a login page by looking at the page title or specific login elements
        const pageTitle = await page.title();
        const isLoginPage = url.includes('/loginpage') || 
                           url.includes('login') || 
                           pageTitle.toLowerCase().includes('sign in') ||
                           pageTitle.toLowerCase().includes('log in');
        
        if (isLoginPage) {
            if (credentials?.email && credentials?.password) {
                log.info('Login page detected, authenticating...');
                
                // Find and fill email field
                const emailInput = await page.$('input[type="email"], input[id*="email"], input[name*="email"]');
                if (emailInput) {
                    await emailInput.fill(credentials.email);
                }
                
                // Find and fill password field
                const passwordInput = await page.$('input[type="password"]');
                if (passwordInput) {
                    await passwordInput.fill(credentials.password);
                }
                
                // Submit
                const submitButton = await page.$('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');
                if (submitButton) {
                    await submitButton.click();
                } else {
                    await page.keyboard.press('Enter');
                }
                
                await page.waitForLoadState('networkidle', { timeout: 30000 });
                log.info('Login completed, navigating to opportunities...');
                
                // Navigate to opportunities page after login
                await page.goto(`${BASE_URL}/sp?id=opportunities`, { waitUntil: 'networkidle' });
            } else {
                log.warning('Login page detected but no credentials provided - continuing without auth');
            }
        }
        
        // Handle opportunities listing page
        if (url.includes('sp?id=opportunities') || url.includes('/opportunities') && !url.includes('sp?id=opportunity_details')) {
            log.info('Scraping opportunities listing page...');
            
            // Wait for opportunity cards to load
            await page.waitForTimeout(5000);
            
            // Wait for the cards to be visible
            try {
                await page.waitForSelector('a:has-text("View details")', { timeout: 15000 });
            } catch (e) {
                log.warning('Could not find View details links - page may require login');
            }
            
            // Extract opportunity info directly from the cards
            const cardData = await page.evaluate(() => {
                const cards: { 
                    url: string; 
                    title: string; 
                    id: string;
                    agency: string;
                    closingDate: string;
                    location: string;
                    workingArrangement: string;
                    module: string;
                }[] = [];
                
                // Find all "View details" links
                const viewDetailsLinks = document.querySelectorAll('a');
                viewDetailsLinks.forEach((link) => {
                    if (link.textContent?.includes('View details')) {
                        const href = (link as HTMLAnchorElement).href;
                        
                        // Get the parent card container
                        const card = link.closest('.card, [class*="card"], .panel, [class*="opportunity"]') || link.parentElement?.parentElement?.parentElement;
                        
                        if (card) {
                            const cardText = card.textContent || '';
                            
                            // Extract title (usually the first bold/header text)
                            const titleEl = card.querySelector('h3, h4, .title, strong');
                            const title = titleEl?.textContent?.trim() || '';
                            
                            // Extract ID (format: ID: XXX-XXXXX)
                            const idMatch = cardText.match(/ID:\s*([A-Z]+-\d+)/);
                            const id = idMatch ? idMatch[1] : '';
                            
                            // Extract agency
                            const agencyMatch = cardText.match(/(?:Agency|Department):\s*([^\n]+)/i);
                            const agency = agencyMatch ? agencyMatch[1].trim() : '';
                            
                            // Extract closing date
                            const closingMatch = cardText.match(/Closing:\s*([^\n]+)/i);
                            const closingDate = closingMatch ? closingMatch[1].trim() : '';
                            
                            // Extract location
                            const locationMatch = cardText.match(/Location:\s*([^\n]+)/i);
                            const location = locationMatch ? locationMatch[1].trim() : '';
                            
                            // Extract working arrangement
                            const workingMatch = cardText.match(/Working arrangement:\s*([^\n]+)/i);
                            const workingArrangement = workingMatch ? workingMatch[1].trim() : '';
                            
                            // Extract module
                            const moduleMatch = cardText.match(/Module:\s*([^\n]+)/i);
                            const module = moduleMatch ? moduleMatch[1].trim() : '';
                            
                            if (id || title) {
                                cards.push({ 
                                    url: href, 
                                    title, 
                                    id,
                                    agency,
                                    closingDate,
                                    location,
                                    workingArrangement,
                                    module
                                });
                            }
                        }
                    }
                });
                
                // Deduplicate by ID
                return [...new Map(cards.map(c => [c.id || c.url, c])).values()];
            });
            
            log.info(`Found ${cardData.length} opportunity cards on this page`);
            
            // Store card data and enqueue detail pages
            for (const card of cardData.slice(0, maxOpportunities - opportunities.length)) {
                if (opportunities.length >= maxOpportunities) break;
                
                // Store basic data from card
                await enqueueLinks({
                    urls: [card.url],
                    label: 'OPPORTUNITY_DETAIL',
                    userData: { cardData: card }
                });
            }
            
            // Handle pagination - look for next button or page numbers
            if (opportunities.length < maxOpportunities && cardData.length > 0) {
                const nextButton = await page.$('button:has-text("Next"), a:has-text("Next"), [aria-label="Next page"], .pagination-next');
                if (nextButton) {
                    const isDisabled = await nextButton.evaluate(el => 
                        el.hasAttribute('disabled') || 
                        el.classList.contains('disabled') ||
                        el.getAttribute('aria-disabled') === 'true'
                    );
                    
                    if (!isDisabled) {
                        log.info('Clicking next page...');
                        await nextButton.click();
                        await page.waitForTimeout(3000);
                        
                        // Re-run on the same page after pagination
                        await enqueueLinks({
                            urls: [page.url()],
                            label: 'LISTING'
                        });
                    }
                }
            }
        }
        
        // Handle individual opportunity detail page
        if (request.label === 'OPPORTUNITY_DETAIL' || url.includes('sp?id=opportunity_details')) {
            log.info(`Scraping opportunity detail: ${url}`);
            
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(3000);
            
            const cardData = request.userData?.cardData;
            
            // Extract detailed opportunity data
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
                
                const getFieldValue = (label: string): string | null => {
                    // Look in tables
                    const rows = document.querySelectorAll('tr');
                    for (const row of rows) {
                        const cells = row.querySelectorAll('td, th');
                        if (cells[0]?.textContent?.toLowerCase().includes(label.toLowerCase())) {
                            return cells[1]?.textContent?.trim() || null;
                        }
                    }
                    
                    // Look in definition lists
                    const dts = document.querySelectorAll('dt, .label, [class*="label"]');
                    for (const dt of dts) {
                        if (dt.textContent?.toLowerCase().includes(label.toLowerCase())) {
                            const dd = dt.nextElementSibling;
                            if (dd) return dd.textContent?.trim() || null;
                        }
                    }
                    
                    // Look in any labeled fields
                    const allText = document.body.textContent || '';
                    const regex = new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i');
                    const match = allText.match(regex);
                    return match ? match[1].trim().substring(0, 200) : null;
                };
                
                // Title
                const title = getText(['h1', 'h2', '.page-title', '[class*="title"]']);
                
                // IDs and references
                const rfqId = getFieldValue('rfq') || getFieldValue('id') || getFieldValue('reference');
                
                // Dates
                const publishDate = getFieldValue('publish') || getFieldValue('posted');
                const closingDate = getFieldValue('closing') || getFieldValue('close') || getFieldValue('deadline');
                
                // Entity/Agency
                const buyerEntity = getFieldValue('agency') || getFieldValue('department') || getFieldValue('target');
                
                // Category
                const category = getFieldValue('category') || getFieldValue('type');
                
                // Working arrangement
                const workingArrangement = getFieldValue('working arrangement') || getFieldValue('engagement');
                
                // Location  
                const location = getFieldValue('location') || getFieldValue('work location');
                
                // Module
                const module = getFieldValue('module') || getFieldValue('panel');
                
                // Description - get the main content area
                const descriptionEl = document.querySelector('.description, [class*="description"], .content, [class*="detail"]');
                const description = descriptionEl?.textContent?.trim()?.substring(0, 5000) || null;
                
                // Criteria
                const criteriaElements = document.querySelectorAll('li, .criteria, [class*="criteria"]');
                const criteria: string[] = [];
                criteriaElements.forEach((el) => {
                    const text = el.textContent?.trim();
                    if (text && text.length > 20 && text.length < 500) {
                        criteria.push(text);
                    }
                });
                
                // Contact info - extract emails
                const allText = document.body.textContent || '';
                const emailMatches = allText.match(/[\w.-]+@[\w.-]+\.(gov\.au|com\.au|org\.au|edu\.au|com|org|net)/gi) || [];
                const contactText = [...new Set(emailMatches)].join(', ');
                
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
                    workingArrangement,
                    location,
                    module,
                    description,
                    criteria: criteria.slice(0, 10),
                    contactText,
                    attachments
                };
            });
            
            // Combine with card data
            const finalTitle = opportunity.title || cardData?.title || 'Unknown Opportunity';
            const reference = cardData?.id || opportunity.rfqId || url.split('sys_id=')[1]?.split('&')[0] || '';
            
            if (reference || finalTitle !== 'Unknown Opportunity') {
                const oppData: OpportunityData = {
                    buyict_reference: reference,
                    buyict_url: url,
                    title: finalTitle,
                    buyer_entity_raw: opportunity.buyerEntity || cardData?.agency || null,
                    category: opportunity.category || null,
                    description: opportunity.description,
                    publish_date: opportunity.publishDate,
                    closing_date: opportunity.closingDate || cardData?.closingDate || null,
                    opportunity_status: 'Open', // Default since we're scraping open opps
                    contact_text_raw: opportunity.contactText || null,
                    rfq_id: opportunity.rfqId,
                    target_sector: opportunity.buyerEntity || cardData?.agency || null,
                    engagement_type: null,
                    estimated_value: null,
                    location: opportunity.location || cardData?.location || null,
                    experience_level: null,
                    working_arrangement: opportunity.workingArrangement || cardData?.workingArrangement || null,
                    module: opportunity.module || cardData?.module || null,
                    key_duties: null,
                    criteria: opportunity.criteria,
                    attachments: opportunity.attachments
                };
                
                opportunities.push(oppData);
                await Dataset.pushData(oppData);
                log.info(`✓ Scraped: ${oppData.title} (${oppData.buyict_reference})`);
            } else {
                log.warning(`Could not extract data from ${url}`);
            }
        }
    },
    
    failedRequestHandler({ request, log }) {
        log.error(`Request failed: ${request.url}`);
    }
});

// Start crawling from the correct opportunities page URL
console.log('Starting BuyICT scraper...');
console.log(`Credentials provided: ${credentials?.email ? 'Yes' : 'No'}`);
console.log(`Max opportunities: ${maxOpportunities}`);

await crawler.run([`${BASE_URL}/sp?id=opportunities`]);

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
            const result = await response.json();
            console.log('✓ Webhook sent successfully:', result);
        }
    } catch (error) {
        console.error('Webhook error:', error);
    }
} else if (!webhookUrl) {
    console.log('No webhook URL configured - data saved to Apify dataset only');
} else if (opportunities.length === 0) {
    console.log('No opportunities found - webhook not triggered');
}

await Actor.exit();
