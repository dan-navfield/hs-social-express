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
                    
                    // Extract all details from the page
                    const details = await page.evaluate(() => {
                        const data: Record<string, string> = {};
                        
                        // Method 1: Look for definition list style (dt/dd or label/value pairs)
                        // BuyICT uses row-based layout with labels and values
                        const rows = document.querySelectorAll('.row, tr, dl, .field-row, .detail-row');
                        rows.forEach(row => {
                            const label = row.querySelector('.label, th, dt, .field-label, .col-md-4, .col-sm-4')?.textContent?.trim();
                            const value = row.querySelector('.value, td, dd, .field-value, .col-md-8, .col-sm-8')?.textContent?.trim();
                            if (label && value && label.length < 50) {
                                const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
                                if (key.length > 2 && value.length < 500) {
                                    data[key] = value;
                                }
                            }
                        });
                        
                        // Method 2: Find all text nodes that look like "Label: Value" or "Label Value" patterns
                        const pageText = document.body.innerText || '';
                        const fieldPatterns = [
                            { key: 'rfq_type', label: 'RFQ type' },
                            { key: 'rfq_id', label: 'RFQ ID' },
                            { key: 'rfq_published_date', label: 'RFQ published date' },
                            { key: 'deadline_for_questions', label: 'Deadline for asking questions' },
                            { key: 'rfq_closing_date', label: 'RFQ closing date' },
                            { key: 'buyer', label: 'Buyer' },
                            { key: 'buyer_contact', label: 'Buyer contact' },
                            { key: 'estimated_start_date', label: 'Estimated start date' },
                            { key: 'initial_contract_duration', label: 'Initial contract duration' },
                            { key: 'extension_term', label: 'Extension term' },
                            { key: 'extension_term_details', label: 'Extension term details' },
                            { key: 'number_of_extensions', label: 'Number of extensions' },
                            { key: 'working_arrangements', label: 'Working arrangements' },
                            { key: 'industry_briefing', label: 'Industry briefing' },
                            { key: 'location', label: 'Location' },
                        ];
                        
                        // For each field, find the label element and get sibling/adjacent value
                        fieldPatterns.forEach(({ key, label }) => {
                            if (data[key]) return; // Already found
                            
                            // Try to find element containing the label
                            const elements = document.querySelectorAll('*');
                            for (const el of elements) {
                                if (el.children.length === 0 && // Leaf node
                                    el.textContent?.trim() === label) {
                                    // Found label, look for value in next element or parent's next child
                                    const parent = el.parentElement;
                                    if (!parent) continue;
                                    
                                    // Check next sibling
                                    const nextSibling = el.nextElementSibling;
                                    if (nextSibling?.textContent?.trim()) {
                                        data[key] = nextSibling.textContent.trim();
                                        break;
                                    }
                                    
                                    // Check parent's next sibling
                                    const parentNextSibling = parent.nextElementSibling;
                                    if (parentNextSibling?.textContent?.trim()) {
                                        data[key] = parentNextSibling.textContent.trim();
                                        break;
                                    }
                                }
                            }
                        });
                        
                        // Method 3: Fallback to line-by-line text extraction
                        const lines = pageText.split('\n').map(l => l.trim()).filter(l => l);
                        for (let i = 0; i < lines.length - 1; i++) {
                            const line = lines[i];
                            const nextLine = lines[i + 1];
                            
                            fieldPatterns.forEach(({ key, label }) => {
                                if (data[key]) return; // Already found
                                if (line === label && nextLine && !nextLine.match(/^[A-Z][a-z]+ [a-z]/)) {
                                    // Line matches label exactly, next line is value
                                    if (nextLine.length < 200 && !fieldPatterns.some(p => p.label === nextLine)) {
                                        data[key] = nextLine;
                                    }
                                }
                            });
                        }
                        
                        // Extract email from buyer_contact or page
                        const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                        if (emailMatch && !data['buyer_contact']) {
                            data['buyer_contact'] = emailMatch[0];
                        }
                        
                        // Extract requirements section
                        let requirements = '';
                        const reqStartIndex = pageText.indexOf('Requirements');
                        if (reqStartIndex > -1) {
                            const reqSection = pageText.substring(reqStartIndex);
                            const criteriaIndex = reqSection.indexOf('Criteria');
                            const endIndex = criteriaIndex > 50 ? criteriaIndex : Math.min(reqSection.length, 2000);
                            requirements = reqSection.substring(12, endIndex).trim();
                        }
                        
                        // Extract essential criteria as array
                        const criteria: string[] = [];
                        const criteriaStartIndex = pageText.indexOf('Essential criteria');
                        if (criteriaStartIndex > -1) {
                            const criteriaSection = pageText.substring(criteriaStartIndex, criteriaStartIndex + 2000);
                            const criteriaLines = criteriaSection.split('\n')
                                .map(l => l.trim())
                                .filter(l => l.length > 20 && !l.startsWith('Essential criteria') && !l.startsWith('Weighting'));
                            criteria.push(...criteriaLines.slice(0, 5));
                        }
                        
                        // Get title
                        const title = document.querySelector('h1, h2, .opportunity-title, .page-title')?.textContent?.trim() || '';
                        
                        return {
                            title,
                            rfqType: data['rfq_type'] || '',
                            rfqId: data['rfq_id'] || data['rfq_id'] || '',
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
                            rawData: data // For debugging
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
