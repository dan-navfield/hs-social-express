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
    // Labour Hire specific fields
    opportunity_type: string | null;
    max_hours: string | null;
    security_clearance: string | null;
}

interface ActorInput {
    webhookUrl?: string;
    spaceId?: string;
    maxOpportunities?: number;
    existingReferences?: string[]; // For incremental sync - skip these
    incrementalMode?: boolean; // If true, only fetch new opportunities
    status?: 'live' | 'closing_soon' | 'closed'; // Status filter
    startPage?: number; // Start from this page (for pagination across multiple runs)
}

await Actor.init();

const input = await Actor.getInput<ActorInput>() ?? {};
const {
    webhookUrl,
    spaceId,
    maxOpportunities = 200,
    existingReferences = [],
    incrementalMode = false,
    status = 'live',
    startPage = 1,
} = input;

// Build set of existing references for fast lookup
const existingRefs = new Set(existingReferences);
console.log(`Incremental mode: ${incrementalMode}, existing references: ${existingRefs.size}`);
console.log(`Status filter: ${status}, starting from page: ${startPage}`);

const opportunities: OpportunityData[] = [];
const sentIds = new Set<string>(); // Track what we've already sent
const seenIds = new Set<string>();
const BASE_URL = 'https://buyict.gov.au';

// Build URL based on status filter
function getOpportunitiesUrl(): string {
    // BuyICT uses URL parameters for filtering
    const baseUrl = `${BASE_URL}/sp?id=opportunities`;
    if (status === 'closed') {
        return `${baseUrl}&opportunities_status=Closed`;
    } else if (status === 'closing_soon') {
        return `${baseUrl}&opportunities_status=Closing%20Soon`;
    }
    return baseUrl; // Default is "Live"
}

const START_URL = getOpportunitiesUrl();

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
            
            // Skip to starting page if needed
            if (startPage > 1) {
                log.info(`Skipping to page ${startPage}...`);
                for (let skip = 1; skip < startPage; skip++) {
                    const nextBtn = await page.$('button[aria-label="Next page"], .pagination-next, [data-pagination-next]');
                    if (nextBtn) {
                        await nextBtn.click();
                        await page.waitForTimeout(3000);
                    } else {
                        log.warning(`Could not skip to page ${startPage}, only ${skip} pages found`);
                        break;
                    }
                }
                pageNum = startPage;
            }
            
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
                    
                    // Extract all details using simple text parsing
                    const details = await page.evaluate(() => {
                        const pageText = document.body.innerText || '';
                        const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                        const data: Record<string, string> = {};
                        
                        // Known field labels - when we see one, the next line(s) is the value
                        const fieldLabels: Record<string, string> = {
                            'RFQ type': 'rfq_type',
                            'RFQ ID': 'rfq_id',
                            'RFQ published date': 'rfq_published_date',
                            'Deadline for asking questions': 'deadline_for_questions',
                            'RFQ closing date': 'rfq_closing_date',
                            'Buyer': 'buyer',
                            'Buyer contact': 'buyer_contact',
                            'Estimated start date': 'estimated_start_date',
                            'Initial contract duration': 'initial_contract_duration',
                            'Extension term': 'extension_term',
                            'Extension term details': 'extension_term_details',
                            'Number of extensions': 'number_of_extensions',
                            'Working arrangements': 'working_arrangements',
                            'Working arrangement': 'working_arrangements',
                            'Industry briefing': 'industry_briefing',
                            'Location': 'location',
                            'Location of work': 'location',
                            // Labour Hire specific fields
                            'Experience level': 'experience_level',
                            'Maximum number of candidates per seller': 'max_candidates_per_seller',
                            'Maximum hours': 'max_hours',
                            'Security clearance': 'security_clearance',
                        };
                        
                        // Scan through lines looking for labels
                        for (let i = 0; i < lines.length - 1; i++) {
                            const line = lines[i];
                            const nextLine = lines[i + 1];
                            
                            // Check if this line is a known label
                            const fieldKey = fieldLabels[line];
                            if (fieldKey && !data[fieldKey]) {
                                // Check that next line isn't another label and isn't too long
                                const isNextLineLabel = Object.keys(fieldLabels).includes(nextLine);
                                if (!isNextLineLabel && nextLine.length < 300) {
                                    data[fieldKey] = nextLine;
                                }
                            }
                        }
                        
                        // Extract email addresses from page
                        const emailMatches = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.gov\.au/g);
                        if (emailMatches && emailMatches.length > 0) {
                            data['buyer_contact'] = emailMatches[0] as string;
                        }
                        
                        // Determine opportunity type based on RFQ type
                        const rfqType = (data['rfq_type'] || '').toLowerCase();
                        const isLabourHire = rfqType.includes('labour hire') || rfqType.includes('dmp2');
                        const opportunityType = isLabourHire ? 'role' : 'service';
                        
                        // Extract requirements/job details section (depends on type)
                        let requirements = '';
                        
                        // Try "Job details" first (Labour Hire)
                        const jobDetailsIndex = pageText.indexOf('Job details\n');
                        if (jobDetailsIndex > -1) {
                            const afterJob = pageText.substring(jobDetailsIndex + 12);
                            // Find where job details ends (at "Key duties" or "Criteria")
                            const keyDutiesIndex = afterJob.indexOf('\nKey duties');
                            const criteriaIndex = afterJob.indexOf('\nCriteria');
                            let endIndex = Math.min(afterJob.length, 2000);
                            if (keyDutiesIndex > 0 && keyDutiesIndex < endIndex) endIndex = keyDutiesIndex;
                            if (criteriaIndex > 0 && criteriaIndex < endIndex) endIndex = criteriaIndex;
                            requirements = afterJob.substring(0, endIndex).trim();
                        }
                        
                        // Try "Requirements" (Services) if no job details
                        if (!requirements) {
                            const reqIndex = pageText.indexOf('Requirements\n');
                            if (reqIndex > -1) {
                                const afterReq = pageText.substring(reqIndex + 12);
                                const criteriaIndex = afterReq.indexOf('\nCriteria');
                                const endIndex = criteriaIndex > 0 ? criteriaIndex : Math.min(afterReq.length, 2000);
                                requirements = afterReq.substring(0, endIndex).trim();
                            }
                        }
                        
                        // Extract Key duties and responsibilities (Labour Hire)
                        let keyDuties = '';
                        const keyDutiesIndex = pageText.indexOf('Key duties and responsibilities');
                        if (keyDutiesIndex > -1) {
                            const afterDuties = pageText.substring(keyDutiesIndex + 32);
                            const criteriaIndex = afterDuties.indexOf('\nCriteria');
                            const complianceIndex = afterDuties.indexOf('\nCompliance');
                            let endIndex = Math.min(afterDuties.length, 2000);
                            if (criteriaIndex > 0 && criteriaIndex < endIndex) endIndex = criteriaIndex;
                            if (complianceIndex > 0 && complianceIndex < endIndex) endIndex = complianceIndex;
                            keyDuties = afterDuties.substring(0, endIndex).trim();
                        }
                        
                        // Extract criteria section
                        const criteria: string[] = [];
                        const criteriaIndex = pageText.indexOf('Essential criteria');
                        if (criteriaIndex > -1) {
                            const section = pageText.substring(criteriaIndex, criteriaIndex + 2000);
                            const criteriaLines = section.split('\n')
                                .map(l => l.trim())
                                .filter(l => l.length > 30 && !l.startsWith('Essential') && !l.startsWith('Weighting') && !l.match(/^\d+$/));
                            criteria.push(...criteriaLines.slice(0, 5));
                        }
                        
                        // Get title from h1 element
                        // Based on actual page structure, h1 contains the opportunity title
                        let title = '';
                        
                        // Strategy 1: Get h1 (which should be the opportunity title)
                        const h1 = document.querySelector('h1');
                        if (h1 && h1.textContent) {
                            const h1Text = h1.textContent.trim();
                            // Make sure it's not just "BuyICT" branding
                            if (h1Text.length > 5 && h1Text !== 'BuyICT') {
                                title = h1Text;
                            }
                        }
                        
                        // Strategy 2: Try h2 if h1 didn't work
                        if (!title) {
                            const h2 = document.querySelector('h2');
                            if (h2 && h2.textContent && h2.textContent.trim().length > 10) {
                                title = h2.textContent.trim();
                            }
                        }
                        
                        // Strategy 3: First substantial text line
                        if (!title) {
                            for (const line of lines.slice(0, 20)) {
                                if (line.length > 15 && 
                                    line !== 'BuyICT' && 
                                    !line.toLowerCase().includes('logged in') &&
                                    !line.toLowerCase().includes('invited') &&
                                    !line.toLowerCase().includes('respond to this') &&
                                    !Object.keys(fieldLabels).includes(line)) {
                                    title = line;
                                    break;
                                }
                            }
                        }
                        
                        console.log('Extracted title from page:', title);
                        
                        // Debug: Log found fields
                        console.log('Extracted title:', title);
                        console.log('Extracted data:', data);
                        
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
                            keyDuties: keyDuties.substring(0, 1500),
                            opportunityType,
                            experienceLevel: data['experience_level'] || '',
                            maxCandidatesPerSeller: data['max_candidates_per_seller'] || '',
                            maxHours: data['max_hours'] || '',
                            securityClearance: data['security_clearance'] || '',
                            criteria: criteria.slice(0, 5),
                            rawData: data
                        };
                    });
                    
                    // Prefer listing page title over detail page title (which may have error messages)
                    // Use detail title only if it's valid and not an error
                    const finalTitle = (details.title && details.title.length > 5 && !details.title.includes('logged in') && !details.title.includes('invited'))
                        ? details.title 
                        : item.title;
                    
                    const oppData: OpportunityData = {
                        buyict_reference: item.id,
                        buyict_url: item.url,
                        title: finalTitle,
                        buyer_entity_raw: details.buyer || null,
                        category: null,
                        description: details.requirements || details.keyDuties || null,
                        publish_date: details.publishDate || null,
                        closing_date: details.closingDate || null,
                        opportunity_status: status === 'closed' ? 'Closed' : status === 'closing_soon' ? 'Closing Soon' : 'Open',
                        contact_text_raw: details.buyerContact || null,
                        rfq_id: details.rfqId || item.id,
                        target_sector: null,
                        engagement_type: details.rfqType || null,
                        estimated_value: null,
                        location: details.location || null,
                        experience_level: details.experienceLevel || null,
                        working_arrangement: details.workingArrangement || null,
                        opportunity_type: details.opportunityType || null,
                        key_duties: details.keyDuties || null,
                        max_hours: details.maxHours || null,
                        security_clearance: details.securityClearance || null,
                        module: null,
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
                        opportunity_status: status === 'closed' ? 'Closed' : status === 'closing_soon' ? 'Closing Soon' : 'Open',
                        contact_text_raw: null,
                        rfq_id: item.id,
                        target_sector: null,
                        engagement_type: null,
                        estimated_value: null,
                        location: null,
                        experience_level: null,
                        working_arrangement: null,
                        opportunity_type: null,
                        max_hours: null,
                        security_clearance: null,
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
