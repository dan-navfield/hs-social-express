/**
 * BuyICT Opportunities Scraper
 * 
 * Scrapes procurement opportunities from BuyICT.gov.au
 * No login required - opportunities are publicly viewable
 * 
 * Page structure discovered:
 * - Cards use class: a.opportunities-card__link
 * - Title in: .opportunities-card__title strong
 * - ID in: .opportunities-card__number (format "ID: PCS-03324")
 * - Agency in: .ng-binding div
 * - Pagination: ul.pagination li a
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
        await page.waitForTimeout(5000);
        
        // Check if this is the listing page
        if (url.includes('sp?id=opportunities') && !url.includes('opportunity_details')) {
            log.info('On opportunities listing page');
            
            // Wait for the specific card elements
            try {
                await page.waitForSelector('a.opportunities-card__link', { timeout: 15000 });
                log.info('Found opportunity cards');
            } catch (e) {
                log.warning('Could not find opportunity cards with expected selector');
            }
            
            // Extract all opportunity cards using the discovered structure
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
                    status: string;
                }[] = [];
                
                // Select all card links with the specific class
                const cardLinks = document.querySelectorAll('a.opportunities-card__link');
                console.log(`Found ${cardLinks.length} card links`);
                
                cardLinks.forEach((link) => {
                    const href = link.getAttribute('href') || '';
                    const fullUrl = href.startsWith('http') ? href : `https://buyict.gov.au/sp${href}`;
                    
                    // Get aria-label for full details
                    const ariaLabel = link.getAttribute('aria-label') || '';
                    
                    // Extract title from .opportunities-card__title strong
                    const titleEl = link.querySelector('.opportunities-card__title strong');
                    const title = titleEl?.textContent?.trim() || '';
                    
                    // Extract ID from .opportunities-card__number
                    const idEl = link.querySelector('.opportunities-card__number');
                    const idText = idEl?.textContent?.trim() || '';
                    const idMatch = idText.match(/ID:\s*([A-Z]+-\d+)/i);
                    const id = idMatch ? idMatch[1] : '';
                    
                    // Extract agency - it's in a div with ng-binding class after the title
                    const cardText = link.textContent || '';
                    
                    // Look for common patterns in the card text
                    const agencyMatch = ariaLabel.match(/Department|Agency|Council|Government/i) ?
                        '' : // Will extract from card content instead
                        '';
                    
                    // Get all text nodes to extract structured data
                    const allDivs = link.querySelectorAll('div');
                    let agency = '';
                    let closingDate = '';
                    let location = '';
                    let workingArrangement = '';
                    let module = '';
                    
                    allDivs.forEach(div => {
                        const text = div.textContent?.trim() || '';
                        if (text.includes('Department') || text.includes('Agency') || text.includes('Council')) {
                            if (!agency && !text.startsWith('ID:') && text.length < 100) {
                                agency = text;
                            }
                        }
                        if (text.includes('Closing:')) {
                            closingDate = text.replace('Closing:', '').trim();
                        }
                        if (text.includes('Location:')) {
                            location = text.replace('Location:', '').trim();
                        }
                        if (text.includes('Working arrangement:')) {
                            workingArrangement = text.replace('Working arrangement:', '').trim();
                        }
                        if (text.includes('Module:')) {
                            module = text.replace('Module:', '').trim();
                        }
                    });
                    
                    // Extract status from badge (e.g., "Invited sellers", "Open to all")
                    const badge = link.querySelector('.badge, [class*="status"], [class*="label"]');
                    const status = badge?.textContent?.trim() || 'Open';
                    
                    if (id || title) {
                        results.push({
                            url: fullUrl,
                            title,
                            id,
                            agency,
                            closingDate,
                            location,
                            workingArrangement,
                            module,
                            category: module, // Use module as category
                            status
                        });
                    }
                });
                
                return results;
            });
            
            log.info(`Extracted ${cards.length} opportunity cards from listing`);
            
            // Store opportunities from cards
            for (const card of cards) {
                if (opportunities.length >= maxOpportunities) {
                    log.info(`Reached max opportunities limit (${maxOpportunities})`);
                    break;
                }
                
                const oppData: OpportunityData = {
                    buyict_reference: card.id,
                    buyict_url: card.url,
                    title: card.title,
                    buyer_entity_raw: card.agency || null,
                    category: card.category || null,
                    description: null,
                    publish_date: null,
                    closing_date: card.closingDate || null,
                    opportunity_status: card.status || 'Open',
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
            
            // Handle pagination - click next page if more needed
            if (opportunities.length < maxOpportunities) {
                try {
                    // Look for the "›" (next) button in pagination
                    const paginationLinks = await page.$$('ul.pagination li a');
                    let nextButton = null;
                    
                    for (const link of paginationLinks) {
                        const text = await link.textContent();
                        if (text?.includes('›') && !text?.includes('»')) {
                            nextButton = link;
                            break;
                        }
                    }
                    
                    if (nextButton) {
                        const isDisabled = await nextButton.evaluate(el => 
                            el.closest('li')?.classList.contains('disabled') || false
                        );
                        
                        if (!isDisabled) {
                            log.info('Clicking next page...');
                            await nextButton.click();
                            await page.waitForLoadState('networkidle');
                            await page.waitForTimeout(3000);
                            
                            // Recursively process the next page
                            await page.evaluate(() => window.scrollTo(0, 0));
                        } else {
                            log.info('No more pages (next button disabled)');
                        }
                    } else {
                        log.info('No pagination next button found');
                    }
                } catch (e) {
                    log.warning('Pagination handling failed');
                }
            }
        }
    },
    
    failedRequestHandler({ request, log, error }) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(`Request failed: ${request.url} - ${errorMessage}`);
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
} else {
    console.log('No opportunities found - webhook not triggered');
}

await Actor.exit();
