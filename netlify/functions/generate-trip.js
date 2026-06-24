exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  try {
    const apiKey = process.env.GROQ_API_KEY

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'GROQ_API_KEY environment variable is not set' })
      }
    }

    const { prompt } = JSON.parse(event.body)

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'You are an expert golf travel consultant specialising in holidays for UK golfers. Always respond with valid JSON only. No markdown, no backticks, no explanation before or after the JSON. Never use smart quotes or apostrophes inside JSON string values — use standard ASCII only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.5,
          max_tokens: 4000
        })
      }
    )

    const data = await response.json()

    if (!response.ok) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'Groq API error ' + response.status + ': ' + (data.error?.message || JSON.stringify(data))
        })
      }
    }

    if (!data.choices || !data.choices[0]) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'No response from Groq: ' + JSON.stringify(data)
        })
      }
    }

    let result = data.choices[0].message.content

    // Strip markdown code fences if present
    result = result.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()

    // Fix common JSON issues the AI produces:

    // 1. Replace smart/curly quotes with standard quotes
    result = result
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')

    // 2. Remove trailing commas before } or ] (common AI mistake)
    result = result.replace(/,\s*([}\]])/g, '$1')

    // 3. If the JSON is truncated (max_tokens hit), try to close it gracefully
    // Find the last complete field and close the structure
    try {
      JSON.parse(result)
    } catch(parseErr) {
      // Try to find and extract valid JSON
      const firstBrace = result.indexOf('{')
      if (firstBrace > -1) {
        let cleaned = result.slice(firstBrace)
        
        // Count open/close braces and brackets to find where it breaks
        let depth = 0
        let lastValid = 0
        for (let i = 0; i < cleaned.length; i++) {
          if (cleaned[i] === '{' || cleaned[i] === '[') depth++
          if (cleaned[i] === '}' || cleaned[i] === ']') depth--
          if (depth === 0) { lastValid = i; break }
        }

        if (lastValid > 0) {
          result = cleaned.slice(0, lastValid + 1)
        } else {
          // JSON was truncated - close all open structures
          cleaned = cleaned.replace(/,\s*$/, '') // remove trailing comma
          // Count unclosed braces
          let opens = (cleaned.match(/\{/g) || []).length
          let closes = (cleaned.match(/\}/g) || []).length
          let arrOpens = (cleaned.match(/\[/g) || []).length
          let arrCloses = (cleaned.match(/\]/g) || []).length
          
          // Close any open string first
          const lastQuote = cleaned.lastIndexOf('"')
          const secondLastQuote = cleaned.lastIndexOf('"', lastQuote - 1)
          if (lastQuote > -1) {
            const between = cleaned.slice(secondLastQuote + 1, lastQuote)
            if (between.length > 0 && !between.includes('"')) {
              cleaned = cleaned.slice(0, secondLastQuote) + '"truncated"'
              opens = (cleaned.match(/\{/g) || []).length
              closes = (cleaned.match(/\}/g) || []).length
              arrOpens = (cleaned.match(/\[/g) || []).length
              arrCloses = (cleaned.match(/\]/g) || []).length
            }
          }

          // Remove trailing comma
          cleaned = cleaned.replace(/,\s*$/, '')
          
          // Close open arrays then objects
          for (let i = 0; i < arrOpens - arrCloses; i++) cleaned += ']'
          for (let i = 0; i < opens - closes; i++) cleaned += '}'
          
          result = cleaned
        }
      }
    }

    // Final validation - if still invalid, return a helpful error
    try {
      JSON.parse(result)
    } catch(e) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ 
          error: 'AI returned invalid JSON that could not be repaired. Please try again.',
          raw: result.slice(0, 200)
        })
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ result })
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
