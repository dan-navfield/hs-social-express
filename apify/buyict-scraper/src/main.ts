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
const sentIds = new Set<string>(); // Track what we've already sent
const seenIds = new Set<string>();
const BASE_URL = 'https://buyict.gov.au';
const START_URL = `${BASE_URL}/sp?id=opportunities`;

console.log('=== BuyICT Scraper Starting ===');
console.log(`Target URL: ${START_URL}`);
console.log(`Max opportunities: ${maxOpportunities}`);

// Batch size for incremental saves
const BATCH_SIZE = 20;
let lastSentIndex = 0;

// Helper function to send a batch of opportunities to webhook
async function sendBatch(batch: OpportunityData[], isFinal: boolean = false) {
    if (!webhookUrl || batch.length === 0) return;
    
    try {
        console.log(`📤 Sending batch of ${batch.length} opportunities (${isFinal ? 'final' : 'incremental'})...`);
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spaceId,
                opportunities: batch,
                scrapedAt: new Date().toISOString(),
                totalCount: batch.length,
                source: 'apify-buyict-scraper',
                isFinal
            })
        });
        
        if (!response.ok) {
            console.error(`Batch webhook failed: ${response.status}`);
        } else {
            const result = await response.json();
            console.log(`✓ Batch saved: ${result.stats?.opportunitiesAdded || 0} added, ${result.stats?.opportunitiesUpdated || 0} updated`);
            // Mark these as sent
            batch.forEach(opp => sentIds.add(opp.buyict_reference));
        }
    } catch (error) {
        console.error('Batch webhook error:', error);
    }
}

// Helper to check and send if batch is ready
async function checkAndSendBatch() {
    const unsent = opportunities.filter(opp => !sentIds.has(opp.buyict_reference));
    if (unsent.length >= BATCH_SIZE) {
        await sendBatch(unsent.slice(0, BATCH_SIZE));
    }
}

// Helper to extract text next to a label
function extractLabelValue(text: string, label: string): string {
    const regex = new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : '';
}

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: maxOpportunities + 20,
    navigationTimeoutSecs: 60,
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
                    
                    // Extract all details from the page using exact BuyICT DOM structure
                    const details = await page.evaluate(() => {
                        const data: Record<string, string> = {};
                        
                        // BuyICT uses Bootstrap rows with col-md-4 (label) and col-md-8 (value)
                        // Labels are in <strong class="ng-binding"> inside col-md-4
                        const rows = document.querySelectorAll('.row');
                        
                        rows.forEach(row => {
                            // Get label from col-md-4 > strong
                            const labelCol = row.querySelector('.col-md-4, .col-xs-12.col-md-4');
                            const valueCol = row.querySelector('.col-md-8, .col-xs-12.col-md-8');
                            
                            if (!labelCol || !valueCol) return;
                            
                            // Label is in the strong tag
                            const labelStrong = labelCol.querySelector('strong');
                            const labelText = (labelStrong?.textContent || labelCol.textContent || '').trim();
                            const valueText = valueCol.textContent?.trim() || '';
                            
                            if (labelText && valueText && labelText.length < 50 && valueText.length < 500) {
                                // Normalize key: "RFQ type" -> "rfq_type"
                                const key = labelText.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
                                if (key.length > 2) {
                                    data[key] = valueText;
                                }
                            }
                        });
                        
                        // Also try element-by-element for each known field
                        const knownFields = [
                            { key: 'rfq_type', labels: ['RFQ type'] },
                            { key: 'rfq_id', labels: ['RFQ ID'] },
                            { key: 'rfq_published_date', labels: ['RFQ published date'] },
                            { key: 'deadline_for_questions', labels: ['Deadline for asking questions'] },
                            { key: 'rfq_closing_date', labels: ['RFQ closing date'] },
                            { key: 'buyer', labels: ['Buyer'] },
                            { key: 'buyer_contact', labels: ['Buyer contact'] },
                            { key: 'estimated_start_date', labels: ['Estimated start date'] },
                            { key: 'initial_contract_duration', labels: ['Initial contract duration'] },
                            { key: 'extension_term', labels: ['Extension term'] },
                            { key: 'extension_term_details', labels: ['Extension term details'] },
                            { key: 'number_of_extensions', labels: ['Number of extensions'] },
                            { key: 'working_arrangements', labels: ['Working arrangements', 'Working arrangement'] },
                            { key: 'industry_briefing', labels: ['Industry briefing'] },
                            { key: 'location', labels: ['Location'] },
                        ];
                        
                        knownFields.forEach(({ key, labels }) => {
                            if (data[key]) return; // Already found
                            
                            // Find <strong> elements containing the label text
                            const strongs = document.querySelectorAll('strong, strong.ng-binding');
                            for (const strong of strongs) {
                                if (labels.some(label => strong.textContent?.trim() === label)) {
                                    // Found the label, now find value in the same row
                                    const row = strong.closest('.row');
                                    if (row) {
                                        const valueCol = row.querySelector('.col-md-8, .col-xs-12.col-md-8');
                                        if (valueCol?.textContent?.trim()) {
                                            data[key] = valueCol.textContent.trim();
                                            break;
                                        }
                                    }
                                }
                            }
                        });
                        
                        // Extract email from page
                        const pageText = document.body.innerText || '';
                        const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                        if (emailMatch) {
                            if (!data['buyer_contact']) {
                                data['buyer_contact'] = emailMatch[0];
                            } else if (!data['buyer_contact'].includes('@')) {
                                // Override if current value isn't an email
                                data['buyer_contact'] = emailMatch[0];
                            }
                        }
                        
                        // Extract requirements section
                        let requirements = '';
                        const reqHeading = document.querySelector('h2, h3');
                        const headings = document.querySelectorAll('h2, h3');
                        for (const h of headings) {
                            if (h.textContent?.trim() === 'Requirements') {
                                // Get all following siblings until next heading
                                let next = h.closest('.row')?.nextElementSibling || h.nextElementSibling;
                                const parts: string[] = [];
                                while (next && !next.querySelector('h2, h3')) {
                                    const text = next.textContent?.trim();
                                    if (text && text.length > 10) {
                                        parts.push(text);
                                    }
                                    next = next.nextElementSibling;
                                }
                                requirements = parts.join('\n').substring(0, 1500);
                                break;
                            }
                        }
                        
                        // Fallback to text extraction for requirements
                        if (!requirements) {
                            const reqIndex = pageText.indexOf('Requirements');
                            if (reqIndex > -1) {
                                const section = pageText.substring(reqIndex + 12);
                                const endIdx = section.indexOf('Criteria');
                                requirements = section.substring(0, endIdx > 50 ? endIdx : 1500).trim();
                            }
                        }
                        
                        // Extract essential criteria
                        const criteria: string[] = [];
                        const criteriaIndex = pageText.indexOf('Essential criteria');
                        if (criteriaIndex > -1) {
                            const section = pageText.substring(criteriaIndex, criteriaIndex + 2000);
                            const lines = section.split('\n')
                                .map(l => l.trim())
                                .filter(l => l.length > 20 && !l.startsWith('Essential') && !l.startsWith('Weighting'));
                            criteria.push(...lines.slice(0, 5));
                        }
                        
                        // Get title from h1 or h2
                        const title = document.querySelector('h1')?.textContent?.trim() || 
                                     document.querySelector('h2')?.textContent?.trim() || '';
                        
                        return {
                            title,
                            rfqType: data['rfq_type'] || '',
                            rfqId: data['rfq_id'] || '',
                            publishDate: data['rfq_published_date'] || '',
                            closingDate: data['rfq_closing_date'] || '',
                            deadlineQuestions: data['deadline_for_questions'] || '',
                            buyer: data['buyer'] || '',
                            buyerContact: data['buyer_contact'] || '',
                            estimatedStartDate: data['estimated_start_date'] || '',
                            contractDuration: data['initial_contract_duration'] || '',
                            extensionTerm: data['extension_term'] || '',
                            extensionTermDetails: data['extension_term_details'] || '',
                            numberOfExtensions: data['number_of_extensions'] || '',
                            workingArrangement: data['working_arrangements'] || '',
                            industryBriefing: data['industry_briefing'] || '',
                            location: data['location'] || '',
                            requirements: requirements.substring(0, 1500),
                            criteria: criteria.slice(0, 5),
                            rawData: data
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
                    
                    // Check if we should send a batch
                    await checkAndSendBatch();
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
                
                // Check if we should send a batch (even for failed ones)
                await checkAndSendBatch();
                
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
console.log(`Already sent: ${sentIds.size}`);

// Send any remaining unsent opportunities
const unsent = opportunities.filter(opp => !sentIds.has(opp.buyict_reference));
if (unsent.length > 0) {
    console.log(`Sending final batch of ${unsent.length} remaining opportunities...`);
    await sendBatch(unsent, true);
} else if (sentIds.size > 0) {
    console.log('✓ All opportunities already saved via incremental batches');
} else if (opportunities.length === 0) {
    console.log('No opportunities found');
}

console.log(`\n=== Summary ===`);
console.log(`Total scraped: ${opportunities.length}`);
console.log(`Total saved: ${sentIds.size}`);

await Actor.exit();
