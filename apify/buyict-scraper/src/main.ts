/**
 * BuyICT Opportunities Scraper
 * 
 * Scrapes ALL procurement opportunities from BuyICT.gov.au
 * Gets full details from each opportunity's detail page.
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
    // Extended fields from detail page
    rfq_type: string | null;
    deadline_for_questions: string | null;
    buyer_contact: string | null;
    estimated_start_date: string | null;
    initial_contract_duration: string | null;
    extension_term: string | null;
    extension_term_details: string | null;
    number_of_extensions: string | null;
    industry_briefing: string | null;
    requirements: string | null;
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
    maxOpportunities = 200,
} = input;

const opportunities: OpportunityData[] = [];
const seenIds = new Set<string>();
const BASE_URL = 'https://buyict.gov.au';
const START_URL = `${BASE_URL}/sp?id=opportunities`;

console.log('=== BuyICT Scraper Starting ===');
console.log(`Target URL: ${START_URL}`);
console.log(`Max opportunities: ${maxOpportunities}`);

// Helper to extract text next to a label
function extractLabelValue(text: string, label: string): string {
    const regex = new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
}

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: maxOpportunities + 20,
    navigationTimeoutSecs: 120,
    requestHandlerTimeoutSecs: 900, // 15 minutes total
    
    async requestHandler({ page, request, log }) {
        const isListingPage = !request.userData?.isDetailPage;
        
        if (isListingPage) {
            log.info('=== Phase 1: Collecting opportunity URLs ===');
            
            await page.goto(START_URL, { waitUntil: 'networkidle' });
            await page.waitForTimeout(5000);
            
            const opportunityUrls: { url: string; id: string; title: string }[] = [];
            let pageNum = 1;
            let hasMorePages = true;
            
            // Collect all opportunity URLs from all pages
            while (hasMorePages && opportunityUrls.length < maxOpportunities) {
                log.info(`Collecting from page ${pageNum}...`);
                
                try {
                    await page.waitForSelector('a.opportunities-card__link', { timeout: 15000 });
                } catch (e) {
                    log.warning(`No cards found on page ${pageNum}`);
                    break;
                }
                
                // Get URLs from this page
                const pageUrls = await page.evaluate(() => {
                    const results: { url: string; id: string; title: string }[] = [];
                    const cards = document.querySelectorAll('a.opportunities-card__link');
                    
                    cards.forEach((link) => {
                        const href = link.getAttribute('href') || '';
                        const url = href.startsWith('http') ? href : `https://buyict.gov.au/sp${href}`;
                        const ariaLabel = link.getAttribute('aria-label') || '';
                        const titleEl = link.querySelector('strong');
                        const title = titleEl?.textContent?.trim() || '';
                        const idEl = link.querySelector('.opportunities-card__number');
                        const idMatch = (idEl?.textContent || '').match(/ID:\s*([A-Z]+-\d+)/i) || 
                                       ariaLabel.match(/ID:\s*([A-Z]+-\d+)/i);
                        const id = idMatch ? idMatch[1] : '';
                        
                        if (id && url) {
                            results.push({ url, id, title });
                        }
                    });
                    return results;
                });
                
                // Add unique URLs
                for (const item of pageUrls) {
                    if (!seenIds.has(item.id) && opportunityUrls.length < maxOpportunities) {
                        seenIds.add(item.id);
                        opportunityUrls.push(item);
                    }
                }
                
                log.info(`Page ${pageNum}: Found ${pageUrls.length} items (total unique: ${opportunityUrls.length})`);
                
                // Try next page
                const nextButton = await page.$('ul.pagination li a:has-text("›")');
                const isDisabled = nextButton ? await nextButton.evaluate((el: any) => 
                    el.closest('li')?.classList.contains('disabled')
                ) : true;
                
                if (nextButton && !isDisabled && opportunityUrls.length < maxOpportunities) {
                    await nextButton.click();
                    await page.waitForLoadState('networkidle');
                    await page.waitForTimeout(3000);
                    pageNum++;
                } else {
                    hasMorePages = false;
                }
            }
            
            log.info(`=== Phase 2: Fetching details for ${opportunityUrls.length} opportunities ===`);
            
            // Now visit each detail page
            for (let i = 0; i < opportunityUrls.length; i++) {
                const item = opportunityUrls[i];
                log.info(`[${i + 1}/${opportunityUrls.length}] Fetching: ${item.id} - ${item.title.substring(0, 40)}...`);
                
                try {
                    await page.goto(item.url, { waitUntil: 'networkidle', timeout: 30000 });
                    await page.waitForTimeout(2000);
                    
                    // Extract all details from the page
                    const details = await page.evaluate(() => {
                        const getText = (selector: string): string => {
                            const el = document.querySelector(selector);
                            return el?.textContent?.trim() || '';
                        };
                        
                        const pageText = document.body.innerText || '';
                        
                        // Helper to extract value after label
                        const extractValue = (label: string): string => {
                            const regex = new RegExp(`${label}[\\s:]+([^\\n]+)`, 'i');
                            const match = pageText.match(regex);
                            return match ? match[1].trim() : '';
                        };
                        
                        // Extract requirements section
                        let requirements = '';
                        const reqHeader = document.querySelector('h2:has-text("Requirements"), h3:has-text("Requirements")');
                        if (reqHeader) {
                            let sibling = reqHeader.nextElementSibling;
                            const parts: string[] = [];
                            while (sibling && !sibling.tagName.match(/^H[1-3]$/)) {
                                parts.push(sibling.textContent?.trim() || '');
                                sibling = sibling.nextElementSibling;
                            }
                            requirements = parts.join('\n').trim();
                        }
                        
                        // Extract criteria
                        const criteria: string[] = [];
                        const criteriaSection = document.querySelector('.criteria, [class*="criteria"]');
                        if (criteriaSection) {
                            const items = criteriaSection.querySelectorAll('li, .criterion');
                            items.forEach(item => {
                                const text = item.textContent?.trim();
                                if (text) criteria.push(text);
                            });
                        }
                        
                        // Get all table rows or definition list items for structured data
                        const data: Record<string, string> = {};
                        
                        // Try table format
                        const rows = document.querySelectorAll('table tr, .field-row, dl dt');
                        rows.forEach(row => {
                            const cells = row.querySelectorAll('td, dd');
                            const label = row.querySelector('th, dt')?.textContent?.trim();
                            const value = cells[0]?.textContent?.trim();
                            if (label && value) {
                                data[label.toLowerCase().replace(/\s+/g, '_')] = value;
                            }
                        });
                        
                        return {
                            title: getText('h1') || getText('h2') || getText('.title'),
                            rfqType: extractValue('RFQ type') || data['rfq_type'],
                            rfqId: extractValue('RFQ ID') || data['rfq_id'],
                            publishDate: extractValue('RFQ published date') || extractValue('Published') || data['rfq_published_date'],
                            closingDate: extractValue('RFQ closing date') || extractValue('Closing') || data['rfq_closing_date'],
                            deadlineQuestions: extractValue('Deadline for asking questions') || data['deadline_for_asking_questions'],
                            buyer: extractValue('Buyer') || data['buyer'],
                            buyerContact: extractValue('Buyer contact') || data['buyer_contact'],
                            estimatedStartDate: extractValue('Estimated start date') || data['estimated_start_date'],
                            contractDuration: extractValue('Initial contract duration') || data['initial_contract_duration'],
                            extensionTerm: extractValue('Extension term') || data['extension_term'],
                            extensionTermDetails: extractValue('Extension term details') || data['extension_term_details'],
                            numberOfExtensions: extractValue('Number of extensions') || data['number_of_extensions'],
                            workingArrangement: extractValue('Working arrangement') || data['working_arrangements'],
                            industryBriefing: extractValue('Industry briefing') || data['industry_briefing'],
                            location: extractValue('Location') || data['location'],
                            requirements: requirements || pageText.substring(pageText.indexOf('Requirements'), pageText.indexOf('Criteria')).slice(0, 2000),
                            criteria: criteria,
                            fullText: pageText.substring(0, 5000) // For debugging
                        };
                    });
                    
                    const oppData: OpportunityData = {
                        buyict_reference: item.id,
                        buyict_url: item.url,
                        title: details.title || item.title,
                        buyer_entity_raw: details.buyer || null,
                        category: null,
                        description: details.requirements || null,
                        publish_date: details.publishDate || null,
                        closing_date: details.closingDate || null,
                        opportunity_status: 'Open',
                        contact_text_raw: details.buyerContact || null,
                        rfq_id: details.rfqId || item.id,
                        target_sector: null,
                        engagement_type: details.rfqType || null,
                        estimated_value: null,
                        location: details.location || null,
                        experience_level: null,
                        working_arrangement: details.workingArrangement || null,
                        module: null,
                        key_duties: null,
                        criteria: details.criteria || [],
                        attachments: [],
                        rfq_type: details.rfqType || null,
                        deadline_for_questions: details.deadlineQuestions || null,
                        buyer_contact: details.buyerContact || null,
                        estimated_start_date: details.estimatedStartDate || null,
                        initial_contract_duration: details.contractDuration || null,
                        extension_term: details.extensionTerm || null,
                        extension_term_details: details.extensionTermDetails || null,
                        number_of_extensions: details.numberOfExtensions || null,
                        industry_briefing: details.industryBriefing || null,
                        requirements: details.requirements || null
                    };
                    
                    opportunities.push(oppData);
                    await Dataset.pushData(oppData);
                    
                } catch (e) {
                    log.warning(`Failed to fetch ${item.id}: ${e}`);
                    // Still add with basic info
                    opportunities.push({
                        buyict_reference: item.id,
                        buyict_url: item.url,
                        title: item.title,
                        buyer_entity_raw: null,
                        category: null,
                        description: null,
                        publish_date: null,
                        closing_date: null,
                        opportunity_status: 'Open',
                        contact_text_raw: null,
                        rfq_id: item.id,
                        target_sector: null,
                        engagement_type: null,
                        estimated_value: null,
                        location: null,
                        experience_level: null,
                        working_arrangement: null,
                        module: null,
                        key_duties: null,
                        criteria: [],
                        attachments: [],
                        rfq_type: null,
                        deadline_for_questions: null,
                        buyer_contact: null,
                        estimated_start_date: null,
                        initial_contract_duration: null,
                        extension_term: null,
                        extension_term_details: null,
                        number_of_extensions: null,
                        industry_briefing: null,
                        requirements: null
                    });
                }
                
                // Small delay between requests
                await page.waitForTimeout(500);
            }
            
            log.info(`=== Completed: ${opportunities.length} opportunities scraped ===`);
        }
    },
    
    failedRequestHandler({ request, log, error }) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error(`Failed: ${request.url} - ${errorMessage}`);
    }
});

await crawler.run([START_URL]);

console.log(`\n=== Scraping Complete ===`);
console.log(`Total opportunities: ${opportunities.length}`);

// Send to webhook
if (webhookUrl && opportunities.length > 0) {
    console.log(`Sending ${opportunities.length} to webhook...`);
    
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spaceId,
                opportunities,
                scrapedAt: new Date().toISOString(),
                totalCount: opportunities.length,
                source: 'apify-buyict-scraper'
            })
        });
        
        if (!response.ok) {
            console.error(`Webhook failed: ${response.status}`);
        } else {
            const result = await response.json();
            console.log('✓ Webhook success:', result);
        }
    } catch (error) {
        console.error('Webhook error:', error);
    }
}

await Actor.exit();
