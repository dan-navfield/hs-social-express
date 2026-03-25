import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { prompt, slide_count = 4 } = await req.json()

        if (!prompt?.trim()) {
            return new Response(
                JSON.stringify({ error: 'prompt is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
        if (!geminiApiKey) {
            return new Response(
                JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`

        const splitPrompt = `You are helping create a carousel of ${slide_count} images that tell a visual story.

Given this description: "${prompt.trim()}"

Split it into ${slide_count} sequential moments that would make a compelling carousel. Each slide should:
- Represent a distinct moment in the sequence
- Work as a standalone image
- Progress the story naturally
- Maintain consistent style, lighting, and subjects across all slides

Return ONLY a JSON array of strings, each being a detailed image generation prompt for that slide. No other text.

Example format: ["Slide 1 detailed prompt...", "Slide 2 detailed prompt...", "Slide 3 detailed prompt...", "Slide 4 detailed prompt..."]`

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: splitPrompt }] }],
                generationConfig: { responseMimeType: 'application/json' },
            }),
        })

        if (!res.ok) {
            const errorBody = await res.text()
            console.error('[split-prompt] Gemini error:', res.status, errorBody)
            return new Response(
                JSON.stringify({ error: 'Failed to split prompt' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const data = await res.json()
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text

        const slides = JSON.parse(text)
        if (!Array.isArray(slides)) throw new Error('Not an array')

        return new Response(
            JSON.stringify({ success: true, slides: slides.map(String) }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        console.error('[split-prompt] Error:', error)
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to parse slide prompts' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
