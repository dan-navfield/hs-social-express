// Crawl Website - Discover business info and pages from a URL
// For Brand Studio wizard step 1

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DiscoveryResult {
    detected_name: string | null
    detected_linkedin: string | null
    linkedin_confidence: 'high' | 'medium' | 'low' | null
    canonical_domain: string
    pages_found: { url: string; title: string; type: string; selected: boolean }[]
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { url, space_id } = await req.json()

        if (!url || !space_id) {
            return new Response(
                JSON.stringify({ error: 'url and space_id are required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Normalize URL
        let normalizedUrl = url.trim()
        if (!normalizedUrl.startsWith('http')) {
            normalizedUrl = 'https://' + normalizedUrl
        }
        normalizedUrl = normalizedUrl.replace(/\/$/, '') // Remove trailing slash

        const urlObj = new URL(normalizedUrl)
        const canonicalDomain = urlObj.hostname.replace(/^www\./, '')

        // Create a discovery session ID
        const sessionId = crypto.randomUUID()

        // Clear old website source documents for this space before new crawl
        await supabase
            .from('source_documents')
            .delete()
            .eq('space_id', space_id)
            .eq('source_type', 'website')

        // Pages to try to crawl
        const pagePaths = [
            { path: '/', type: 'home' },
            { path: '/about', type: 'about' },
            { path: '/about-us', type: 'about' },
            { path: '/services', type: 'services' },
            { path: '/our-services', type: 'services' },
            { path: '/what-we-do', type: 'services' },
            { path: '/work', type: 'work' },
            { path: '/case-studies', type: 'work' },
            { path: '/portfolio', type: 'work' },
            { path: '/contact', type: 'contact' },
            { path: '/contact-us', type: 'contact' },
        ]

        const pagesFound: DiscoveryResult['pages_found'] = []
        let detectedName: string | null = null
        let detectedLinkedIn: string | null = null
        const seenPaths = new Set<string>()
        const discoveredLinks: string[] = []
        const MAX_PAGES = 30 // Limit total pages to avoid timeout

        // Helper function to crawl a single page
        const crawlPage = async (pageUrl: string, pageType: string): Promise<string[]> => {
            const links: string[] = []
            
            try {
                const response = await fetch(pageUrl, {
                    headers: { 'User-Agent': 'SocialExpress/1.0 (Brand Discovery)' },
                    redirect: 'follow',
                })

                if (!response.ok) return links

                const html = await response.text()

                // Check for redirects/canonicals to avoid duplicates
                const finalUrl = response.url
                const finalPath = new URL(finalUrl).pathname
                if (seenPaths.has(finalPath)) return links
                seenPaths.add(finalPath)

                // Extract title
                const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
                const title = titleMatch?.[1]?.trim() || pageType

                // For homepage, extract business name and LinkedIn
                if (pageType === 'home') {
                    if (titleMatch) {
                        const titleText = titleMatch[1]
                        const nameParts = titleText.split(/[|–—-]/)
                        if (nameParts.length > 0) {
                            detectedName = nameParts[0].trim()
                        }
                    }

                    const ogSiteMatch = html.match(/<meta[^>]*property="og:site_name"[^>]*content="([^"]+)"/i)
                    if (ogSiteMatch) {
                        detectedName = ogSiteMatch[1].trim()
                    }

                    const linkedInMatch = html.match(/href="(https?:\/\/(?:www\.)?linkedin\.com\/company\/[^"]+)"/i)
                    if (linkedInMatch) {
                        detectedLinkedIn = linkedInMatch[1]
                    }
                }

                // Extract internal links for deeper crawling
                const linkRegex = /href="([^"]+)"/gi
                let match
                while ((match = linkRegex.exec(html)) !== null) {
                    const href = match[1]
                    // Only same-domain links, exclude anchors, files, and external
                    if (href.startsWith('/') && !href.includes('#') && !href.match(/\.(pdf|jpg|png|gif|svg|css|js)$/i)) {
                        const fullUrl = `${urlObj.origin}${href}`
                        if (!seenPaths.has(href) && !discoveredLinks.includes(fullUrl)) {
                            links.push(fullUrl)
                        }
                    }
                }

                // Extract text content
                const textContent = html
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 5000)

                // Store as source document
                await supabase.from('source_documents').insert({
                    space_id,
                    source_type: 'website',
                    url: finalUrl,
                    title: title.replace(/\s*[|–—-].*$/, ''),
                    content: textContent,
                    metadata: { page_type: pageType, discovered_at: new Date().toISOString() },
                    is_confirmed: false,
                    discovery_session_id: sessionId,
                })

                pagesFound.push({
                    url: finalUrl,
                    title: title.replace(/\s*[|–—-].*$/, ''),
                    type: pageType,
                    selected: true,
                })

            } catch (pageError) {
                console.log(`Could not fetch ${pageUrl}:`, pageError)
            }
            
            return links
        }

        // First pass: crawl initial pages and collect links
        for (const page of pagePaths) {
            if (pagesFound.length >= MAX_PAGES) break
            const pageUrl = `${urlObj.origin}${page.path}`
            const links = await crawlPage(pageUrl, page.type)
            discoveredLinks.push(...links.slice(0, 20)) // Limit links per page
        }

        // Second pass: crawl discovered links (subpages like case studies)
        for (const link of discoveredLinks) {
            if (pagesFound.length >= MAX_PAGES) break
            const path = new URL(link).pathname
            if (seenPaths.has(path)) continue
            
            // Determine page type from URL
            let pageType = 'page'
            if (path.includes('/work/') || path.includes('/case-stud')) pageType = 'case-study'
            else if (path.includes('/blog/') || path.includes('/post/')) pageType = 'blog'
            else if (path.includes('/service')) pageType = 'service'
            
            await crawlPage(link, pageType)
        }


        // Determine LinkedIn confidence
        let linkedinConfidence: 'high' | 'medium' | 'low' | null = null
        if (detectedLinkedIn) {
            // Check if company name appears in LinkedIn URL
            const nameSlug = detectedName?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
            const linkedInSlug = detectedLinkedIn.toLowerCase()
            if (nameSlug && linkedInSlug.includes(nameSlug)) {
                linkedinConfidence = 'high'
            } else {
                linkedinConfidence = 'medium'
            }
        }

        // Update brand_context_cache with discovery results
        await supabase.from('brand_context_cache').upsert({
            space_id,
            setup_status: 'website_pending',
            detected_name: detectedName,
            detected_linkedin: detectedLinkedIn,
            linkedin_confidence: linkedinConfidence,
            compiled_from: { discovery_session_id: sessionId, discovered_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
        }, { onConflict: 'space_id' })

        const result: DiscoveryResult = {
            detected_name: detectedName,
            detected_linkedin: detectedLinkedIn,
            linkedin_confidence: linkedinConfidence,
            canonical_domain: canonicalDomain,
            pages_found: pagesFound,
        }

        return new Response(
            JSON.stringify({ success: true, discovery: result, session_id: sessionId }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Error in crawl-website:', error)
        return new Response(
            JSON.stringify({ error: 'Failed to crawl website', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
