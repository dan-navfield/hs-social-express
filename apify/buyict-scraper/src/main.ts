/**
 * BuyICT Opportunities Scraper
 * 
 * Scrapes procurement opportunities from BuyICT.gov.au
 * No login required - opportunities are publicly viewable
 * 
 * Page structure:
 * <a class="opportunities-card__link" href="?id=opportunity_details&table=...&sys_id=..." 
 *    aria-label="View details for [Title], ID: [REF]">
 *   <div class="opportunities-card">
 *     <div class="opportunities-card__title">
 *       <strong>[Title]</strong>
 *       <div class="opportunities-card__number">ID: [REF]</div>
 *     </div>
 *     <div class="ng-binding">[Agency]</div>
 *     [More content with Location, Working arrangement, Closing, Module]
 *     <div class="opportunities-card__footer">View details</div>
 *   </div>
 * </a>
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
const seenIds = new Set<string>();
const BASE_URL = 'https://buyict.gov.au';
const START_URL = `${BASE_URL}/sp?id=opportunities`;

console.log('=== BuyICT Scraper Starting ===');
console.log(`Target URL: ${START_URL}`);
console.log(`Max opportunities: ${maxOpportunities}`);

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: 200,
    navigationTimeoutSecs: 120,
    requestHandlerTimeoutSecs: 300,
    
    async requestHandler({ page, request, log }) {
        const url = request.url;
        const pageNum = request.userData?.pageNum || 1;
        log.info(`Processing page ${pageNum}: ${url}`);
        
        // Wait for page to fully load
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(5000);
        
        // Check if this is the listing page
        if (url.includes('sp?id=opportunities') && !url.includes('opportunity_details')) {
            log.info(`On opportunities listing page (page ${pageNum})`);
            
            // Wait for the specific card elements
            try {
                await page.waitForSelector('a.opportunities-card__link', { timeout: 20000 });
                log.info('Opportunity cards loaded');
            } catch (e) {
                log.warning('Could not find opportunity cards');
                return;
            }
            
            // Extract all opportunity cards
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
                
                const cardLinks = document.querySelectorAll('a.opportunities-card__link');
                
                cardLinks.forEach((link) => {
                    const href = link.getAttribute('href') || '';
                    const fullUrl = href.startsWith('http') ? href : `https://buyict.gov.au/sp${href}`;
                    
                    // Get aria-label which contains title and ID
                    const ariaLabel = link.getAttribute('aria-label') || '';
                    
                    // Extract title from strong element
                    const titleEl = link.querySelector('strong');
                    const title = titleEl?.textContent?.trim() || '';
                    
                    // Extract ID from card number div
                    const idEl = link.querySelector('.opportunities-card__number, [class*="number"]');
                    let id = '';
                    if (idEl) {
                        const idText = idEl.textContent?.trim() || '';
                        const idMatch = idText.match(/ID:\s*([A-Z]+-\d+)/i) || idText.match(/([A-Z]{2,4}-\d{4,6})/);
                        id = idMatch ? idMatch[1] : '';
                    }
                    
                    // If no ID from element, try aria-label
                    if (!id && ariaLabel) {
                        const ariaIdMatch = ariaLabel.match(/ID:\s*([A-Z]+-\d+)/i);
                        if (ariaIdMatch) id = ariaIdMatch[1];
                    }
                    
                    // Get entire card text for regex extraction
                    const fullText = link.textContent || '';
                    
                    // Extract using regex patterns on full text
                    const closingMatch = fullText.match(/Closing:\s*([^,\n]+(?:Canberra time)?)/i);
                    const locationMatch = fullText.match(/Location:\s*([A-Z,\s]+?)(?=Working|Closing|Module|$)/i);
                    const workingMatch = fullText.match(/Working arrangement:\s*([A-Za-z]+)/i);
                    const moduleMatch = fullText.match(/Module:\s*([^\n]+?)(?=Category|$)/i);
                    const categoryMatch = fullText.match(/Category:\s*([^\n]+)/i);
                    
                    // Extract agency - usually right after title, before other fields
                    // Look for government entity names
                    let agency = '';
                    const agencyPatterns = [
                        /\n([A-Z][a-zA-Z\s-]+(?:Department|Agency|Council|Commission|Authority|Office|Service)s?)\s*\n/,
                        /\n([A-Z][a-zA-Z\s-]+(?:Government|Bureau|Institute|Board))\s*\n/,
                        /(?:ID:[^\n]+\n)([A-Z][a-zA-Z\s-]+(?=\s*\n|Working|Location|Closing))/
                    ];
                    
                    for (const pattern of agencyPatterns) {
                        const match = fullText.match(pattern);
                        if (match && match[1].trim().length > 5 && match[1].trim().length < 100) {
                            agency = match[1].trim();
                            break;
                        }
                    }
                    
                    // If still no agency, try the div after title
                    if (!agency) {
                        const divs = link.querySelectorAll('div');
                        for (let i = 0; i < divs.length; i++) {
                            const text = divs[i].textContent?.trim() || '';
                            if (text.length > 10 && text.length < 80 && 
                                !text.includes('ID:') && 
                                !text.includes('Closing') && 
                                !text.includes('Location') &&
                                !text.includes('Working') &&
                                !text.includes('Module') &&
                                !text.includes('View details')) {
                                // Check if it looks like an organization name
                                if (/^[A-Z]/.test(text)) {
                                    agency = text;
                                    break;
                                }
                            }
                        }
                    }
                    
                    // Status from badge class or invitation type
                    let status = 'Open';
                    if (fullText.includes('Invited sellers')) status = 'Invited sellers';
                    if (fullText.includes('Open to all')) status = 'Open to all';
                    if (fullText.includes('Closed')) status = 'Closed';
                    
                    if (id || title) {
                        results.push({
                            url: fullUrl,
                            title: title,
                            id: id,
                            agency: agency,
                            closingDate: closingMatch ? closingMatch[1].trim() : '',
                            location: locationMatch ? locationMatch[1].trim() : '',
                            workingArrangement: workingMatch ? workingMatch[1].trim() : '',
                            module: moduleMatch ? moduleMatch[1].trim() : '',
                            category: categoryMatch ? categoryMatch[1].trim() : (moduleMatch ? moduleMatch[1].trim() : ''),
                            status: status
                        });
                    }
                });
                
                return results;
            });
            
            log.info(`Found ${cards.length} opportunity cards on page ${pageNum}`);
            
            // Store unique opportunities
            let newCount = 0;
            for (const card of cards) {
                if (opportunities.length >= maxOpportunities) {
                    log.info(`Reached max limit (${maxOpportunities})`);
                    break;
                }
                
                // Skip duplicates
                if (seenIds.has(card.id)) {
                    continue;
                }
                seenIds.add(card.id);
                
                const oppData: OpportunityData = {
                    buyict_reference: card.id,
                    buyict_url: card.url,
                    title: card.title,
                    buyer_entity_raw: card.agency || null,
                    category: card.category || card.module || null,
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
                newCount++;
                log.info(`✓ ${oppData.buyict_reference}: ${oppData.title.substring(0, 50)}...`);
            }
            
            log.info(`Added ${newCount} new opportunities (total: ${opportunities.length})`);
            
            // Handle pagination - look for next page
            if (opportunities.length < maxOpportunities) {
                const hasNextPage = await page.evaluate(() => {
                    const pagination = document.querySelectorAll('ul.pagination li');
                    for (const li of pagination) {
                        const link = li.querySelector('a');
                        const text = link?.textContent?.trim();
                        // Look for "›" which is the next page button
                        if (text === '›' && !li.classList.contains('disabled')) {
                            return true;
                        }
                    }
                    return false;
                });
                
                if (hasNextPage) {
                    log.info('Clicking next page...');
                    
                    // Click the next button
                    await page.click('ul.pagination li a:has-text("›")');
                    await page.waitForLoadState('networkidle');
                    await page.waitForTimeout(3000);
                    
                    // Get the new URL and continue processing
                    const newUrl = page.url();
                    log.info(`Navigated to: ${newUrl}`);
                    
                    // Re-run extraction on this page by calling handler recursively
                    // Note: We're on the same page, so we process it again
                    await page.waitForSelector('a.opportunities-card__link', { timeout: 15000 });
                    
                    // Extract from new page
                    const moreCards = await page.evaluate(() => {
                        const results: any[] = [];
                        const cardLinks = document.querySelectorAll('a.opportunities-card__link');
                        
                        cardLinks.forEach((link) => {
                            const href = link.getAttribute('href') || '';
                            const fullUrl = href.startsWith('http') ? href : `https://buyict.gov.au/sp${href}`;
                            const ariaLabel = link.getAttribute('aria-label') || '';
                            const titleEl = link.querySelector('strong');
                            const title = titleEl?.textContent?.trim() || '';
                            const idEl = link.querySelector('.opportunities-card__number');
                            let id = '';
                            if (idEl) {
                                const idMatch = (idEl.textContent || '').match(/ID:\s*([A-Z]+-\d+)/i);
                                id = idMatch ? idMatch[1] : '';
                            }
                            if (!id && ariaLabel) {
                                const ariaMatch = ariaLabel.match(/ID:\s*([A-Z]+-\d+)/i);
                                if (ariaMatch) id = ariaMatch[1];
                            }
                            
                            const fullText = link.textContent || '';
                            const closingMatch = fullText.match(/Closing:\s*([^,\n]+)/i);
                            const locationMatch = fullText.match(/Location:\s*([A-Z,\s]+)/i);
                            const workingMatch = fullText.match(/Working arrangement:\s*(\w+)/i);
                            const moduleMatch = fullText.match(/Module:\s*([^\n]+)/i);
                            
                            // Agency extraction
                            let agency = '';
                            const divs = link.querySelectorAll('div');
                            for (const div of divs) {
                                const t = div.textContent?.trim() || '';
                                if (t.length > 10 && t.length < 80 && 
                                    !t.includes('ID:') && !t.includes('Closing') && 
                                    !t.includes('Location') && !t.includes('Working') &&
                                    !t.includes('Module') && !t.includes('View') &&
                                    /^[A-Z]/.test(t)) {
                                    agency = t;
                                    break;
                                }
                            }
                            
                            if (id || title) {
                                results.push({
                                    url: fullUrl, title, id, agency,
                                    closingDate: closingMatch?.[1]?.trim() || '',
                                    location: locationMatch?.[1]?.trim() || '',
                                    workingArrangement: workingMatch?.[1]?.trim() || '',
                                    module: moduleMatch?.[1]?.trim() || '',
                                    category: moduleMatch?.[1]?.trim() || '',
                                    status: fullText.includes('Invited') ? 'Invited sellers' : 'Open'
                                });
                            }
                        });
                        return results;
                    });
                    
                    log.info(`Page 2: Found ${moreCards.length} more cards`);
                    
                    for (const card of moreCards) {
                        if (opportunities.length >= maxOpportunities) break;
                        if (seenIds.has(card.id)) continue;
                        seenIds.add(card.id);
                        
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
                    }
                } else {
                    log.info('No more pages');
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
    console.log('No webhook URL configured');
} else {
    console.log('No opportunities found');
}

await Actor.exit();
