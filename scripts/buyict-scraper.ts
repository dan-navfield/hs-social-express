/**
 * Standalone BuyICT Scraper — runs without Apify
 *
 * Uses Playwright + Crawlee directly. Designed to run in GitHub Actions
 * on a daily cron schedule. Posts results to the Supabase webhook.
 *
 * Usage: npx tsx scripts/buyict-scraper.ts
 *
 * Required env vars:
 *   WEBHOOK_URL — the buyict-sync-webhook edge function URL
 *   SPACE_ID — the target workspace ID
 */

import { chromium } from 'playwright'

interface OpportunityData {
    buyict_reference: string
    buyict_url: string
    title: string
    buyer_entity_raw: string | null
    category: string | null
    description: string | null
    publish_date: string | null
    closing_date: string | null
    opportunity_status: string | null
    contact_text_raw: string | null
    rfq_id: string | null
    target_sector: string | null
    engagement_type: string | null
    estimated_value: string | null
    location: string | null
    experience_level: string | null
    working_arrangement: string | null
    opportunity_type: string | null
    key_duties: string | null
    max_hours: string | null
    security_clearance: string | null
    module: string | null
    criteria: string[]
    attachments: { name: string; url: string; type: string }[]
    rfq_type: string | null
    deadline_for_questions: string | null
    buyer_contact: string | null
    estimated_start_date: string | null
    initial_contract_duration: string | null
    extension_term: string | null
    extension_term_details: string | null
    number_of_extensions: string | null
    industry_briefing: string | null
    requirements: string | null
}

const WEBHOOK_URL = process.env.WEBHOOK_URL
const SPACE_ID = process.env.SPACE_ID
const MAX_OPPORTUNITIES = parseInt(process.env.MAX_OPPORTUNITIES || '100', 10)
const STATUS = (process.env.STATUS || 'live') as 'live' | 'closing_soon' | 'closed'
const BASE_URL = 'https://buyict.gov.au'
const BATCH_SIZE = 20

if (!WEBHOOK_URL) throw new Error('WEBHOOK_URL env var is required')
if (!SPACE_ID) throw new Error('SPACE_ID env var is required')

function getOpportunitiesUrl(): string {
    const baseUrl = `${BASE_URL}/sp?id=opportunities`
    if (STATUS === 'closed') return `${baseUrl}&opportunities_status=Closed`
    if (STATUS === 'closing_soon') return `${baseUrl}&opportunities_status=Closing%20Soon`
    return baseUrl
}

const opportunities: OpportunityData[] = []
const sentIds = new Set<string>()
const seenIds = new Set<string>()

async function sendBatch(batch: OpportunityData[], isFinal = false) {
    if (batch.length === 0) return
    console.log(`📤 Sending batch of ${batch.length} opportunities (${isFinal ? 'final' : 'incremental'})...`)
    try {
        const response = await fetch(WEBHOOK_URL!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spaceId: SPACE_ID,
                opportunities: batch,
                scrapedAt: new Date().toISOString(),
                totalCount: batch.length,
                source: 'github-actions-buyict-scraper',
                isFinal,
            }),
        })
        if (!response.ok) {
            console.error(`Webhook failed: ${response.status} ${await response.text()}`)
        } else {
            const result = await response.json()
            console.log(`✓ Batch saved: ${result.stats?.opportunitiesAdded || 0} added, ${result.stats?.opportunitiesUpdated || 0} updated`)
            batch.forEach(opp => sentIds.add(opp.buyict_reference))
        }
    } catch (error) {
        console.error('Webhook error:', error)
    }
}

async function checkAndSendBatch() {
    const unsent = opportunities.filter(opp => !sentIds.has(opp.buyict_reference))
    if (unsent.length >= BATCH_SIZE) {
        await sendBatch(unsent.slice(0, BATCH_SIZE))
    }
}

async function main() {
    console.log('=== BuyICT Scraper (Standalone) ===')
    console.log(`Status filter: ${STATUS}`)
    console.log(`Max opportunities: ${MAX_OPPORTUNITIES}`)

    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()

    try {
        const startUrl = getOpportunitiesUrl()
        console.log(`Navigating to: ${startUrl}`)
        await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 60000 })
        await page.waitForTimeout(5000)

        // Phase 1: Collect opportunity URLs
        const opportunityUrls: { url: string; id: string; title: string }[] = []
        let pageNum = 1
        let hasMorePages = true

        while (hasMorePages && opportunityUrls.length < MAX_OPPORTUNITIES) {
            console.log(`Collecting from page ${pageNum}...`)

            try {
                await page.waitForSelector('a.opportunities-card__link', { timeout: 15000 })
            } catch {
                console.log(`No cards found on page ${pageNum}`)
                break
            }

            const pageUrls = await page.evaluate(() => {
                const results: { url: string; id: string; title: string }[] = []
                document.querySelectorAll('a.opportunities-card__link').forEach(link => {
                    const href = link.getAttribute('href') || ''
                    const url = href.startsWith('http') ? href : `https://buyict.gov.au/sp${href}`
                    const ariaLabel = link.getAttribute('aria-label') || ''
                    const titleEl = link.querySelector('strong')
                    const title = titleEl?.textContent?.trim() || ''
                    const idEl = link.querySelector('.opportunities-card__number')
                    const idMatch = (idEl?.textContent || '').match(/ID:\s*([A-Z]+-\d+)/i) || ariaLabel.match(/ID:\s*([A-Z]+-\d+)/i)
                    const id = idMatch ? idMatch[1] : ''
                    if (id && url) results.push({ url, id, title })
                })
                return results
            })

            for (const item of pageUrls) {
                if (!seenIds.has(item.id) && opportunityUrls.length < MAX_OPPORTUNITIES) {
                    seenIds.add(item.id)
                    opportunityUrls.push(item)
                }
            }

            console.log(`Page ${pageNum}: Found ${pageUrls.length} items (total: ${opportunityUrls.length})`)

            const nextButton = await page.$('ul.pagination li a:has-text("›")')
            const isDisabled = nextButton ? await nextButton.evaluate((el: any) => el.closest('li')?.classList.contains('disabled')) : true

            if (nextButton && !isDisabled && opportunityUrls.length < MAX_OPPORTUNITIES) {
                await nextButton.click()
                await page.waitForLoadState('networkidle')
                await page.waitForTimeout(3000)
                pageNum++
            } else {
                hasMorePages = false
            }
        }

        console.log(`\n=== Phase 2: Fetching details for ${opportunityUrls.length} opportunities ===`)

        // Phase 2: Visit each detail page
        for (let i = 0; i < opportunityUrls.length; i++) {
            const item = opportunityUrls[i]
            console.log(`[${i + 1}/${opportunityUrls.length}] ${item.id} - ${item.title.substring(0, 50)}...`)

            try {
                await page.goto(item.url, { waitUntil: 'networkidle', timeout: 30000 })
                await page.waitForTimeout(2000)

                const details = await page.evaluate(() => {
                    const pageText = document.body.innerText || ''
                    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
                    const data: Record<string, string> = {}

                    const fieldLabels: Record<string, string> = {
                        'RFQ type': 'rfq_type', 'RFQ ID': 'rfq_id', 'RFQ published date': 'rfq_published_date',
                        'Deadline for asking questions': 'deadline_for_questions', 'RFQ closing date': 'rfq_closing_date',
                        'Buyer': 'buyer', 'Buyer contact': 'buyer_contact',
                        'Estimated start date': 'estimated_start_date', 'Initial contract duration': 'initial_contract_duration',
                        'Extension term': 'extension_term', 'Extension term details': 'extension_term_details',
                        'Number of extensions': 'number_of_extensions', 'Working arrangements': 'working_arrangements',
                        'Working arrangement': 'working_arrangements', 'Industry briefing': 'industry_briefing',
                        'Location': 'location', 'Location of work': 'location',
                        'Experience level': 'experience_level', 'Maximum hours': 'max_hours',
                        'Security clearance': 'security_clearance',
                    }

                    for (let i = 0; i < lines.length - 1; i++) {
                        const fieldKey = fieldLabels[lines[i]]
                        if (fieldKey && !data[fieldKey]) {
                            const nextLine = lines[i + 1]
                            if (!Object.keys(fieldLabels).includes(nextLine) && nextLine.length < 300) {
                                data[fieldKey] = nextLine
                            }
                        }
                    }

                    const emailMatches = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.gov\.au/g)
                    if (emailMatches?.[0]) data['buyer_contact'] = emailMatches[0]

                    const rfqType = (data['rfq_type'] || '').toLowerCase()
                    const opportunityType = rfqType.includes('labour hire') || rfqType.includes('dmp2') ? 'role' : 'service'

                    let requirements = ''
                    const jobIdx = pageText.indexOf('Job details\n')
                    if (jobIdx > -1) {
                        const after = pageText.substring(jobIdx + 12)
                        const end = Math.min(after.indexOf('\nKey duties'), after.indexOf('\nCriteria'), 2000)
                        requirements = after.substring(0, end > 0 ? end : 2000).trim()
                    }
                    if (!requirements) {
                        const reqIdx = pageText.indexOf('Requirements\n')
                        if (reqIdx > -1) {
                            const after = pageText.substring(reqIdx + 12)
                            const end = after.indexOf('\nCriteria')
                            requirements = after.substring(0, end > 0 ? end : 2000).trim()
                        }
                    }

                    let keyDuties = ''
                    const dutiesIdx = pageText.indexOf('Key duties and responsibilities')
                    if (dutiesIdx > -1) {
                        const after = pageText.substring(dutiesIdx + 32)
                        const end = Math.min(after.indexOf('\nCriteria'), after.indexOf('\nCompliance'), 2000)
                        keyDuties = after.substring(0, end > 0 ? end : 2000).trim()
                    }

                    const criteria: string[] = []
                    const criteriaIdx = pageText.indexOf('Essential criteria')
                    if (criteriaIdx > -1) {
                        const section = pageText.substring(criteriaIdx, criteriaIdx + 2000)
                        criteria.push(...section.split('\n').map(l => l.trim()).filter(l => l.length > 30 && !l.startsWith('Essential') && !l.startsWith('Weighting') && !l.match(/^\d+$/)).slice(0, 5))
                    }

                    let title = ''
                    const h1 = document.querySelector('h1')
                    if (h1?.textContent && h1.textContent.trim().length > 5 && h1.textContent.trim() !== 'BuyICT') title = h1.textContent.trim()
                    if (!title) { const h2 = document.querySelector('h2'); if (h2?.textContent && h2.textContent.trim().length > 10) title = h2.textContent.trim() }

                    return { title, rfqType: data['rfq_type'] || '', rfqId: data['rfq_id'] || '', publishDate: data['rfq_published_date'] || '', closingDate: data['rfq_closing_date'] || '', deadlineQuestions: data['deadline_for_questions'] || '', buyer: data['buyer'] || '', buyerContact: data['buyer_contact'] || '', estimatedStartDate: data['estimated_start_date'] || '', contractDuration: data['initial_contract_duration'] || '', extensionTerm: data['extension_term'] || '', extensionTermDetails: data['extension_term_details'] || '', numberOfExtensions: data['number_of_extensions'] || '', workingArrangement: data['working_arrangements'] || '', industryBriefing: data['industry_briefing'] || '', location: data['location'] || '', requirements: requirements.substring(0, 1500), keyDuties: keyDuties.substring(0, 1500), opportunityType, experienceLevel: data['experience_level'] || '', maxHours: data['max_hours'] || '', securityClearance: data['security_clearance'] || '', criteria }
                })

                const finalTitle = (details.title && details.title.length > 5 && !details.title.includes('logged in')) ? details.title : item.title

                opportunities.push({
                    buyict_reference: item.id, buyict_url: item.url, title: finalTitle,
                    buyer_entity_raw: details.buyer || null, category: null,
                    description: details.requirements || details.keyDuties || null,
                    publish_date: details.publishDate || null, closing_date: details.closingDate || null,
                    opportunity_status: STATUS === 'closed' ? 'Closed' : STATUS === 'closing_soon' ? 'Closing Soon' : 'Open',
                    contact_text_raw: details.buyerContact || null, rfq_id: details.rfqId || item.id,
                    target_sector: null, engagement_type: details.rfqType || null, estimated_value: null,
                    location: details.location || null, experience_level: details.experienceLevel || null,
                    working_arrangement: details.workingArrangement || null,
                    opportunity_type: details.opportunityType || null, key_duties: details.keyDuties || null,
                    max_hours: details.maxHours || null, security_clearance: details.securityClearance || null,
                    module: null, criteria: details.criteria || [], attachments: [],
                    rfq_type: details.rfqType || null, deadline_for_questions: details.deadlineQuestions || null,
                    buyer_contact: details.buyerContact || null, estimated_start_date: details.estimatedStartDate || null,
                    initial_contract_duration: details.contractDuration || null,
                    extension_term: details.extensionTerm || null, extension_term_details: details.extensionTermDetails || null,
                    number_of_extensions: details.numberOfExtensions || null,
                    industry_briefing: details.industryBriefing || null, requirements: details.requirements || null,
                })
            } catch (e) {
                console.warn(`Failed to fetch ${item.id}: ${e}`)
                opportunities.push({
                    buyict_reference: item.id, buyict_url: item.url, title: item.title,
                    buyer_entity_raw: null, category: null, description: null, publish_date: null,
                    closing_date: null, opportunity_status: STATUS === 'closed' ? 'Closed' : 'Open',
                    contact_text_raw: null, rfq_id: item.id, target_sector: null, engagement_type: null,
                    estimated_value: null, location: null, experience_level: null, working_arrangement: null,
                    opportunity_type: null, key_duties: null, max_hours: null, security_clearance: null,
                    module: null, criteria: [], attachments: [], rfq_type: null, deadline_for_questions: null,
                    buyer_contact: null, estimated_start_date: null, initial_contract_duration: null,
                    extension_term: null, extension_term_details: null, number_of_extensions: null,
                    industry_briefing: null, requirements: null,
                })
            }

            await checkAndSendBatch()
            await page.waitForTimeout(500)
        }

        // Send remaining
        const unsent = opportunities.filter(opp => !sentIds.has(opp.buyict_reference))
        if (unsent.length > 0) {
            await sendBatch(unsent, true)
        }

        console.log(`\n=== Summary ===`)
        console.log(`Total scraped: ${opportunities.length}`)
        console.log(`Total saved: ${sentIds.size}`)
    } finally {
        await browser.close()
    }
}

main().catch(err => {
    console.error('Scraper failed:', err)
    process.exit(1)
})
