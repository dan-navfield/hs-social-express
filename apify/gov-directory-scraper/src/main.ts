/**
 * Australian Government Directory Scraper
 * Scrapes federal agencies from directory.gov.au
 */

import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

interface AgencyData {
    name: string;
    portfolio: string | null;
    description: string | null;
    website: string | null;
    phone: string | null;
    fax: string | null;
    abn: string | null;
    address: string | null;
    type_of_body: string | null;
    gfs_classification: string | null;
    established_under: string | null;
    established_info: string | null;
    classification: string | null;
    materiality: string | null;
    creation_date: string | null;
    directory_gov_url: string;
}

interface ActorInput {
    webhookUrl?: string;
    spaceId?: string;
    maxAgencies?: number;
    portfolioFilter?: string; // Optional: only scrape specific portfolio
}

await Actor.init();

const input = await Actor.getInput<ActorInput>() ?? {};
const {
    webhookUrl,
    spaceId,
    maxAgencies = 500,
    portfolioFilter
} = input;

const agencies: AgencyData[] = [];
const BASE_URL = 'https://www.directory.gov.au';
const PORTFOLIOS_URL = `${BASE_URL}/portfolios`;

console.log('=== Gov Directory Scraper Starting ===');
console.log(`Max agencies: ${maxAgencies}`);
if (portfolioFilter) console.log(`Portfolio filter: ${portfolioFilter}`);

// Send batch to webhook
async function sendBatch(batch: AgencyData[], isFinal: boolean = false) {
    if (!webhookUrl || batch.length === 0) return;
    
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spaceId,
                agencies: batch,
                scrapedAt: new Date().toISOString(),
                totalCount: batch.length,
                isFinal,
                source: 'gov-directory-scraper'
            })
        });
        
        if (!response.ok) {
            console.error('Webhook error:', await response.text());
        } else {
            console.log(`Sent ${batch.length} agencies to webhook`);
        }
    } catch (error) {
        console.error('Failed to send to webhook:', error);
    }
}

const crawler = new PlaywrightCrawler({
    headless: true,
    maxRequestsPerCrawl: maxAgencies + 50,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 600,
    
    async requestHandler({ page, request, log }) {
        const url = request.url;
        
        // Phase 1: Get all portfolio pages
        if (url === PORTFOLIOS_URL) {
            log.info('=== Phase 1: Collecting portfolio pages ===');
            
            await page.waitForSelector('a[href*="/portfolios/"]', { timeout: 15000 });
            
            const portfolioLinks = await page.evaluate(() => {
                const links = document.querySelectorAll('a[href*="/portfolios/"]');
                const urls: string[] = [];
                links.forEach(link => {
                    const href = link.getAttribute('href');
                    if (href && href.startsWith('/portfolios/') && !urls.includes(href)) {
                        urls.push(href);
                    }
                });
                return [...new Set(urls)];
            });
            
            log.info(`Found ${portfolioLinks.length} portfolios`);
            
            // Add all portfolio pages to queue
            for (const link of portfolioLinks) {
                const fullUrl = `${BASE_URL}${link}`;
                if (!portfolioFilter || link.includes(portfolioFilter.toLowerCase())) {
                    await crawler.addRequests([{ 
                        url: fullUrl, 
                        userData: { type: 'portfolio' } 
                    }]);
                }
            }
            return;
        }
        
        // Phase 2: Get all agency links from a portfolio page
        if (request.userData?.type === 'portfolio') {
            const portfolioName = await page.title();
            log.info(`=== Portfolio: ${portfolioName} ===`);
            
            // Wait for content to load
            await page.waitForTimeout(2000);
            
            // Find all agency links (they contain /departments/ or /agencies/ or similar)
            const agencyLinks = await page.evaluate(() => {
                const links: string[] = [];
                
                // Look for links in the main content area
                const contentArea = document.querySelector('main') || document.body;
                const allLinks = contentArea.querySelectorAll('a[href*="/"]');
                
                allLinks.forEach(link => {
                    const href = link.getAttribute('href') || '';
                    // Agency pages have URLs like /portfolios/defence/department-of-defence
                    // or direct entity URLs
                    if (href.match(/\/portfolios\/[^\/]+\/[^\/]+$/) && 
                        !href.includes('/reports') &&
                        !href.includes('/legislation')) {
                        links.push(href);
                    }
                });
                
                return [...new Set(links)];
            });
            
            log.info(`Found ${agencyLinks.length} agencies in ${portfolioName}`);
            
            // Add agency detail pages to queue
            for (const link of agencyLinks) {
                if (agencies.length >= maxAgencies) break;
                
                const fullUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
                await crawler.addRequests([{
                    url: fullUrl,
                    userData: { type: 'agency', portfolio: portfolioName.replace(' | Directory', '') }
                }]);
            }
            return;
        }
        
        // Phase 3: Extract agency details
        if (request.userData?.type === 'agency') {
            if (agencies.length >= maxAgencies) {
                log.info(`Reached max agencies limit (${maxAgencies})`);
                return;
            }
            
            log.info(`Scraping agency: ${url}`);
            
            try {
                // Wait for page to load
                await page.waitForTimeout(1500);
                
                // Extract agency data
                const agencyData = await page.evaluate((portfolioFromNav) => {
                    const data: Record<string, string | null> = {};
                    
                    // Name - usually in h1
                    const h1 = document.querySelector('h1');
                    data.name = h1?.textContent?.trim() || null;
                    
                    // Portfolio tag (the colored label)
                    const portfolioTag = document.querySelector('.field--name-field-portfolio a, .badge, [class*="portfolio"]');
                    data.portfolio = portfolioTag?.textContent?.trim() || portfolioFromNav || null;
                    
                    // Description
                    const descEl = document.querySelector('.field--name-body p, .description, article > p:first-of-type');
                    data.description = descEl?.textContent?.trim() || null;
                    
                    // Phone - look for tel: links
                    const phoneLinks = document.querySelectorAll('a[href^="tel:"]');
                    const phones: string[] = [];
                    phoneLinks.forEach(p => {
                        const phone = p.textContent?.trim();
                        if (phone) phones.push(phone);
                    });
                    data.phone = phones[0] || null;
                    data.fax = phones[1] || null;
                    
                    // Website
                    const websiteLink = document.querySelector('a[href^="http"]:not([href*="directory.gov.au"]):not([href*="legislation.gov.au"])');
                    data.website = websiteLink?.getAttribute('href') || null;
                    
                    // ABN - look for text containing ABN
                    const abnMatch = document.body.textContent?.match(/ABN[:\s]*(\d{2}\s*\d{3}\s*\d{3}\s*\d{3})/i);
                    data.abn = abnMatch ? abnMatch[1].replace(/\s/g, '') : null;
                    
                    // Address - look for location pin or address block
                    const addressEl = document.querySelector('a[href*="maps"], .field--name-field-address, [class*="address"]');
                    data.address = addressEl?.textContent?.trim() || null;
                    
                    // Further Information fields
                    const furtherInfo = document.querySelector('#further-information, .further-information, section:has(h2:contains("Further"))');
                    if (furtherInfo || document.body) {
                        const container = furtherInfo || document.body;
                        const text = container.textContent || '';
                        
                        // Type of Body
                        const typeMatch = text.match(/Type of Body[:\s]*([A-Z]\.?\s*[^\n]+)/i);
                        data.type_of_body = typeMatch ? typeMatch[1].trim() : null;
                        
                        // GFS Sector Classification
                        const gfsMatch = text.match(/GFS Sector Classification[:\s]*([^\n]+)/i);
                        data.gfs_classification = gfsMatch ? gfsMatch[1].trim() : null;
                        
                        // Established By/Under
                        const estMatch = text.match(/Established By \/ Under[:\s]*([^\n]+)/i);
                        data.established_under = estMatch ? estMatch[1].trim() : null;
                        
                        // Established By/Under More Info
                        const estInfoMatch = text.match(/Established By\/Under More info[:\s]*([^\n]+)/i);
                        data.established_info = estInfoMatch ? estInfoMatch[1].trim() : null;
                        
                        // Classification
                        const classMatch = text.match(/Classification[:\s]*([A-Z]\.?\s*[^\n]+)/i);
                        data.classification = classMatch ? classMatch[1].trim() : null;
                        
                        // Materiality
                        const matMatch = text.match(/Materiality[:\s]*([^\n]+)/i);
                        data.materiality = matMatch ? matMatch[1].trim() : null;
                        
                        // Creation Date
                        const dateMatch = text.match(/Creation Date[:\s]*([^\n]+)/i);
                        data.creation_date = dateMatch ? dateMatch[1].trim() : null;
                    }
                    
                    return data;
                }, request.userData?.portfolio);
                
                if (agencyData.name) {
                    agencies.push({
                        name: agencyData.name,
                        portfolio: agencyData.portfolio,
                        description: agencyData.description,
                        website: agencyData.website,
                        phone: agencyData.phone,
                        fax: agencyData.fax,
                        abn: agencyData.abn,
                        address: agencyData.address,
                        type_of_body: agencyData.type_of_body,
                        gfs_classification: agencyData.gfs_classification,
                        established_under: agencyData.established_under,
                        established_info: agencyData.established_info,
                        classification: agencyData.classification,
                        materiality: agencyData.materiality,
                        creation_date: agencyData.creation_date,
                        directory_gov_url: url
                    });
                    
                    log.info(`Extracted: ${agencyData.name} (${agencies.length} total)`);
                    
                    // Send batch every 20 agencies
                    if (agencies.length % 20 === 0 && webhookUrl) {
                        await sendBatch(agencies.slice(-20));
                    }
                }
            } catch (error) {
                log.error(`Failed to extract agency from ${url}: ${error}`);
            }
        }
    },
    
    async failedRequestHandler({ request, log }) {
        log.error(`Request failed: ${request.url}`);
    }
});

// Start crawling from portfolios page
await crawler.run([{ url: PORTFOLIOS_URL }]);

console.log(`=== Scraping complete: ${agencies.length} agencies ===`);

// Send final batch
if (webhookUrl) {
    await sendBatch(agencies, true);
}

// Save to Apify dataset
await Actor.pushData(agencies);

await Actor.exit();
