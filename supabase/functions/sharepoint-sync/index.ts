import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Token estimation: ~4 chars per token on average
const CHARS_PER_TOKEN = 4
const GPT4O_MINI_INPUT_COST = 0.00015 // per 1K tokens
const GPT4O_MINI_OUTPUT_COST = 0.0006 // per 1K tokens

interface ScanResult {
  total_files: number
  supported_files: number
  skipped_files: number
  estimated_tokens: number
  estimated_cost: number
  estimated_time_minutes: number
  files: { name: string; size: number; type: string; supported: boolean }[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, space_id, site_id, drive_id, folder_id } = await req.json()
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get SharePoint connection
    const { data: connection, error: connError } = await supabase
      .from('sharepoint_connections')
      .select('access_token, refresh_token, token_expires_at')
      .eq('space_id', space_id)
      .single()

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: 'SharePoint not connected' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if token needs refresh
    let accessToken = connection.access_token
    if (new Date(connection.token_expires_at) < new Date()) {
      accessToken = await refreshToken(supabase, space_id, connection.refresh_token)
    }

    if (action === 'scan') {
      // Scan folder and estimate cost/time
      const scanResult = await scanFolder(accessToken, drive_id, folder_id)
      
      return new Response(
        JSON.stringify(scanResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'start_sync') {
      // Create sync progress record
      const { data: syncJob, error: syncError } = await supabase
        .from('sync_progress')
        .insert({
          space_id,
          source_type: 'sharepoint',
          source_path: `${site_id}/${drive_id}/${folder_id || 'root'}`,
          status: 'processing',
          started_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (syncError) throw syncError

      // Start processing in background (fire and forget for demo)
      // In production, this would be a proper queue/worker
      processDocuments(supabase, accessToken, space_id, drive_id, folder_id, syncJob.id)
        .catch(err => console.error('Background processing error:', err))

      return new Response(
        JSON.stringify({ sync_id: syncJob.id, status: 'started' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'check_progress') {
      const { sync_id } = await req.json()
      
      const { data: progress } = await supabase
        .from('sync_progress')
        .select('*')
        .eq('id', sync_id)
        .single()

      return new Response(
        JSON.stringify(progress),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function refreshToken(supabase: any, spaceId: string, refreshToken: string): Promise<string> {
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID')!
  const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')!

  const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/.default offline_access',
    }),
  })

  const tokens = await tokenResponse.json()
  
  await supabase.from('sharepoint_connections').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || refreshToken,
    token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  }).eq('space_id', spaceId)

  return tokens.access_token
}

async function scanFolder(accessToken: string, driveId: string, folderId?: string, maxDepth: number = 10): Promise<ScanResult> {
  const supportedExtensions = ['.docx', '.doc', '.pdf', '.pptx', '.ppt', '.txt', '.md']
  const allFiles: ScanResult['files'] = []
  
  // Recursive function to scan folders
  async function scanRecursive(currentFolderId: string | undefined, depth: number) {
    if (depth > maxDepth) return // Prevent infinite recursion
    
    const endpoint = currentFolderId 
      ? `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${currentFolderId}/children`
      : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`

    const response = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })

    const data = await response.json()
    const items = data.value || []

    for (const item of items) {
      if (item.folder) {
        // Recursively scan subfolders
        console.log(`Scanning subfolder: ${item.name} (depth: ${depth})`)
        await scanRecursive(item.id, depth + 1)
      } else {
        // It's a file
        const ext = (item.name.match(/\.[^.]+$/) || [''])[0].toLowerCase()
        const supported = supportedExtensions.includes(ext)
        
        allFiles.push({
          name: item.name,
          size: item.size || 0,
          type: ext,
          supported,
        })
      }
    }
  }

  // Start recursive scan
  await scanRecursive(folderId, 0)

  let totalSize = 0
  for (const file of allFiles) {
    if (file.supported) {
      totalSize += file.size
    }
  }

  const supportedFiles = allFiles.filter(f => f.supported)
  const estimatedTokens = Math.ceil(totalSize / CHARS_PER_TOKEN)
  
  // Cost = input tokens for reading + output tokens for generating training examples
  // Assume output is ~30% of input (training examples are summaries)
  const inputCost = (estimatedTokens / 1000) * GPT4O_MINI_INPUT_COST
  const outputCost = (estimatedTokens * 0.3 / 1000) * GPT4O_MINI_OUTPUT_COST
  const estimatedCost = inputCost + outputCost

  // Time: roughly 5 docs per minute with API calls
  const estimatedTime = Math.ceil(supportedFiles.length / 5)

  console.log(`Scan complete: ${allFiles.length} total files, ${supportedFiles.length} supported`)

  return {
    total_files: allFiles.length,
    supported_files: supportedFiles.length,
    skipped_files: allFiles.length - supportedFiles.length,
    estimated_tokens: estimatedTokens,
    estimated_cost: Math.round(estimatedCost * 100) / 100,
    estimated_time_minutes: Math.max(1, estimatedTime),
    files: allFiles,
  }
}

async function processDocuments(
  supabase: any,
  accessToken: string,
  spaceId: string,
  driveId: string,
  folderId: string | undefined,
  syncId: string
) {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')!
  
  try {
    // Get all files
    const scanResult = await scanFolder(accessToken, driveId, folderId)
    const supportedFiles = scanResult.files.filter(f => f.supported)
    
    await supabase.from('sync_progress').update({
      total_documents: supportedFiles.length,
      estimated_tokens: scanResult.estimated_tokens,
      estimated_cost: scanResult.estimated_cost,
    }).eq('id', syncId)

    let processedCount = 0
    let totalTokens = 0
    const errors: any[] = []

    // Get brand profile for context
    const { data: brandProfile } = await supabase
      .from('brand_profile')
      .select('*')
      .eq('space_id', spaceId)
      .single()

    const brandName = brandProfile?.who_we_are?.split(' ').slice(0, 5).join(' ') || 'this brand'

    for (const file of supportedFiles) {
      try {
        // Download file content
        const content = await downloadFile(accessToken, driveId, file.name)
        
        if (!content || content.length < 100) {
          errors.push({ file: file.name, error: 'Content too short or empty' })
          continue
        }

        // Generate training examples from this document
        const trainingExamples = await generateTrainingExamples(
          openaiKey,
          brandName,
          file.name,
          content
        )

        // Save training examples
        for (const example of trainingExamples) {
          await supabase.from('training_examples').insert({
            space_id: spaceId,
            system_prompt: example.system,
            user_prompt: example.user,
            assistant_response: example.assistant,
            source_document: file.name,
            category: example.category,
          })
        }

        // Extract knowledge items
        const knowledgeItems = await extractKnowledge(openaiKey, content)
        
        // Merge knowledge into brand_knowledge table
        for (const [category, items] of Object.entries(knowledgeItems)) {
          if (!items || (items as any[]).length === 0) continue
          
          const { data: existing } = await supabase
            .from('brand_knowledge')
            .select('items')
            .eq('space_id', spaceId)
            .eq('category', category)
            .single()

          const existingItems = existing?.items || []
          const mergedItems = [...new Set([...existingItems, ...(items as any[])])]

          await supabase.from('brand_knowledge').upsert({
            space_id: spaceId,
            category,
            items: mergedItems,
            last_synced_at: new Date().toISOString(),
          }, { onConflict: 'space_id,category' })
        }

        processedCount++
        totalTokens += Math.ceil(content.length / CHARS_PER_TOKEN)

        // Update progress
        await supabase.from('sync_progress').update({
          processed_documents: processedCount,
          actual_tokens: totalTokens,
        }).eq('id', syncId)

      } catch (fileError: any) {
        errors.push({ file: file.name, error: fileError.message })
      }
    }

    // Mark complete
    await supabase.from('sync_progress').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      actual_cost: (totalTokens / 1000) * GPT4O_MINI_INPUT_COST,
      error_log: errors,
    }).eq('id', syncId)

    // Update training examples count
    const { count } = await supabase
      .from('training_examples')
      .select('*', { count: 'exact', head: true })
      .eq('space_id', spaceId)

    await supabase.from('brand_profile').update({
      training_examples_count: count || 0,
    }).eq('space_id', spaceId)

  } catch (error: any) {
    await supabase.from('sync_progress').update({
      status: 'failed',
      error_log: [{ error: error.message }],
    }).eq('id', syncId)
  }
}

async function downloadFile(accessToken: string, driveId: string, fileName: string): Promise<string> {
  // For demo, we'll just get text content
  // In production, you'd use proper document conversion (pdf-parse, mammoth for docx, etc.)
  
  // Search for the file
  const searchUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/search(q='${encodeURIComponent(fileName)}')`
  const searchResponse = await fetch(searchUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  })
  const searchData = await searchResponse.json()
  const file = searchData.value?.[0]
  
  if (!file) return ''

  // Get download URL
  const downloadUrl = file['@microsoft.graph.downloadUrl']
  if (!downloadUrl) return ''

  const contentResponse = await fetch(downloadUrl)
  const arrayBuffer = await contentResponse.arrayBuffer()
  
  // For now, just convert to string (works for txt/md)
  // TODO: Add proper docx/pdf parsing
  const decoder = new TextDecoder('utf-8')
  return decoder.decode(arrayBuffer)
}

async function generateTrainingExamples(
  apiKey: string,
  brandName: string,
  fileName: string,
  content: string
): Promise<{ system: string; user: string; assistant: string; category: string }[]> {
  
  const truncatedContent = content.slice(0, 12000) // Limit content size

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are creating training examples for fine-tuning a GPT model to write like ${brandName}. 
          
Generate 3-5 training examples from this document. Each example should be a realistic request someone might make, paired with a response that demonstrates the brand's voice, knowledge, and style.

Return JSON array: [{"category": "linkedin_post|project_summary|brand_voice|client_work", "user": "user request", "assistant": "ideal response in brand voice"}]`
        },
        {
          role: 'user',
          content: `Document: ${fileName}\n\nContent:\n${truncatedContent}`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
  })

  const data = await response.json()
  const parsed = JSON.parse(data.choices[0].message.content)
  
  const systemPrompt = `You are the brand voice of ${brandName}. Write in their style, using their terminology and approach.`
  
  return (parsed.examples || parsed).map((ex: any) => ({
    system: systemPrompt,
    user: ex.user,
    assistant: ex.assistant,
    category: ex.category,
  }))
}

async function extractKnowledge(apiKey: string, content: string): Promise<Record<string, string[]>> {
  const truncatedContent = content.slice(0, 12000)

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extract structured knowledge from this document. Return JSON with these categories:
          
{
  "clients": ["client names mentioned"],
  "projects": ["project names or descriptions"],
  "technologies": ["tech, platforms, tools mentioned"],
  "methodologies": ["approaches, frameworks, processes"],
  "achievements": ["awards, metrics, accomplishments"],
  "key_phrases": ["distinctive phrases, terminology"],
  "team_members": ["people names and roles if mentioned"],
  "industries": ["verticals, sectors mentioned"]
}

Only include items that are clearly extractable. Empty arrays are fine.`
        },
        {
          role: 'user',
          content: truncatedContent
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  })

  const data = await response.json()
  return JSON.parse(data.choices[0].message.content)
}
