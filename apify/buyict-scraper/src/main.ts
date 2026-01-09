/**
 * BuyICT Opportunities Scraper
 * 
 * Scrapes procurement opportunities from BuyICT.gov.au
 * No login required - opportunities are publicly viewable
 * 
 * Page structure:
 * - URL: https://buyict.gov.au/sp?id=opportunities
 * - Shows cards with "View details" links
 * - Pagination shows "1 - 90 of 91 opportunities"
 */

import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

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
    webhookUrl?: string;
    spaceId?: string;
    maxOpportunities?: number;
    filterStatus?: 'open' | 'closed' | 'all';
}

await Actor.init();

const input = await Actor.getInput<ActorInput>() ?? {};
const {
    webhookUrl,
    spaceId,
    maxOpportunities = 100,
} = input;

const opportunities: OpportunityData[] = [];
const BASE_URL = 'https://buyict.gov.au';
const START_URL = `${BASE_URL}/sp?id=opportunities`;

console.log('=== BuyICT Scraper Starting ===');
console.log(`Target URL: ${START_URL}`);
console.log(`Max opportunities: ${maxOpportunities}`);

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: maxOpportunities + 100,
    navigationTimeoutSecs: 120,
    requestHandlerTimeoutSecs: 180,
    
    async requestHandler({ page, request, log }) {
        const url = request.url;
        log.info(`Processing: ${url}`);
        
        // Wait for page to fully load
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(5000); // Give ServiceNow time to render
        
        // Check if this is the listing page
        if (url.includes('sp?id=opportunities') && !url.includes('opportunity_details')) {
            log.info('On opportunities listing page');
            
            // Take a screenshot for debugging
            const pageTitle = await page.title();
            log.info(`Page title: ${pageTitle}`);
            
            // Get page content to debug
            const pageContent = await page.content();
            log.info(`Page HTML length: ${pageContent.length}`);
            
            // Wait for cards to be visible
            try {
                await page.waitForSelector('text=View details', { timeout: 15000 });
                log.info('Found "View details" text on page');
            } catch (e) {
                log.warning('Could not find "View details" - trying alternate selectors');
            }
            
            // Try to extract opportunity data directly from the listing cards
            const cards = await page.evaluate(() => {
                const results: {
                    url: string;
                    title: string;
                    id: string;
                    agency: string;
                    closingDate: string;
                    location: string;
                    workingArrangement: string;
                    module: string;
                    category: string;
                }[] = [];
                
                // Find all links containing "View details"
                const allLinks = Array.from(document.querySelectorAll('a'));
                const viewDetailsLinks = allLinks.filter(a => 
                    a.textContent?.toLowerCase().includes('view details')
                );
                
                console.log(`Found ${viewDetailsLinks.length} View details links`);
                
                for (const link of viewDetailsLinks) {
                    const href = link.getAttribute('href') || '';
                    const fullUrl = href.startsWith('http') ? href : `https://buyict.gov.au${href}`;
                    
                    // Find the parent card/container
                    let card = link.parentElement;
                    for (let i = 0; i < 10 && card; i++) {
                        if (card.classList.contains('card') || 
                            card.classList.contains('panel') ||
                            card.getAttribute('class')?.includes('card') ||
                            card.getAttribute('class')?.includes('opportunity')) {
                            break;
                        }
                        card = card.parentElement;
                    }
                    
                    if (!card) {
                        card = link.parentElement?.parentElement?.parentElement || null;
                    }
                    
                    const cardText = card?.textContent || '';
                    
                    // Extract ID (format like PCS-03324, LH-05368)
                    const idMatch = cardText.match(/ID:\s*([A-Z]+-\d+)/i) || 
                                   cardText.match(/([A-Z]{2,4}-\d{4,6})/);
                    const id = idMatch ? idMatch[1] : '';
                    
                    // Extract title - first strong or h3/h4 in the card
                    const titleEl = card?.querySelector('strong, h3, h4, h5');
                    const title = titleEl?.textContent?.trim() || '';
                    
                    // Extract other fields
                    const agencyMatch = cardText.match(/(?:Agency|Department)[:\s]+([^\n]+?)(?=Working|Location|Closing|Module|$)/i);
                    const closingMatch = cardText.match(/Closing:\s*([^\n]+)/i);
                    const locationMatch = cardText.match(/Location:\s*([^\n]+)/i);
                    const workingMatch = cardText.match(/Working arrangement:\s*([^\n]+)/i);
                    const moduleMatch = cardText.match(/Module:\s*([^\n]+)/i);
                    const categoryMatch = cardText.match(/Category:\s*([^\n]+)/i);
                    
                    if (id || title) {
                        results.push({
                            url: fullUrl,
                            title: title,
                            id: id,
                            agency: agencyMatch ? agencyMatch[1].trim() : '',
                            closingDate: closingMatch ? closingMatch[1].trim() : '',
                            location: locationMatch ? locationMatch[1].trim() : '',
                            workingArrangement: workingMatch ? workingMatch[1].trim() : '',
                            module: moduleMatch ? moduleMatch[1].trim() : '',
                            category: categoryMatch ? categoryMatch[1].trim() : ''
                        });
                    }
                }
                
                // Deduplicate by ID or URL
                const seen = new Set();
                return results.filter(r => {
                    const key = r.id || r.url;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            });
            
            log.info(`Extracted ${cards.length} opportunity cards from listing`);
            
            // Store opportunities from cards
            for (const card of cards) {
                if (opportunities.length >= maxOpportunities) break;
                
                const oppData: OpportunityData = {
                    buyict_reference: card.id,
                    buyict_url: card.url,
                    title: card.title,
                    buyer_entity_raw: card.agency || null,
                    category: card.category || card.module || null,
                    description: null,
                    publish_date: null,
                    closing_date: card.closingDate || null,
                    opportunity_status: 'Open',
                    contact_text_raw: null,
                    rfq_id: card.id,
                    target_sector: card.agency || null,
                    engagement_type: null,
                    estimated_value: null,
                    location: card.location || null,
                    experience_level: null,
                    working_arrangement: card.workingArrangement || null,
                    module: card.module || null,
                    key_duties: null,
                    criteria: [],
                    attachments: []
                };
                
                opportunities.push(oppData);
                await Dataset.pushData(oppData);
                log.info(`✓ Added: ${oppData.title} (${oppData.buyict_reference})`);
            }
            
            // Handle pagination - click next page if available
            if (opportunities.length < maxOpportunities) {
                try {
                    // Look for next page button (the > arrow in pagination)
                    const nextButton = await page.$('[aria-label="Next page"], button:has-text(">"), a:has-text(">"):not(:has-text(">>"))');
                    if (nextButton) {
                        const isDisabled = await nextButton.evaluate(el => 
                            el.hasAttribute('disabled') || 
                            el.classList.contains('disabled') ||
                            el.getAttribute('aria-disabled') === 'true'
                        );
                        
                        if (!isDisabled) {
                            log.info('Clicking next page...');
                            await nextButton.click();
                            await page.waitForLoadState('networkidle');
                            await page.waitForTimeout(3000);
                            
                            // Process the next page by running the handler again
                            // The crawler will handle this naturally via the queue
                        }
                    }
                } catch (e) {
                    log.warning('No more pages or pagination failed');
                }
            }
        }
        
        // Handle individual opportunity detail page if we navigate to one
        if (url.includes('opportunity_details') || url.includes('sys_id=')) {
            log.info('On opportunity detail page');
            // Extract detailed info here if needed
        }
    },
    
    failedRequestHandler({ request, log, error }) {
        log.error(`Request failed: ${request.url} - ${error.message}`);
    }
});

// Start crawling
await crawler.run([START_URL]);

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
