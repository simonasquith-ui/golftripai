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
      console.log('ERROR: GROQ_API_KEY not set')
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'GROQ_API_KEY environment variable is not set' })
      }
    }

    const body = JSON.parse(event.body)
    const { prompt } = body

    console.log('Prompt received:', prompt ? 'yes' : 'no')
    console.log('Prompt length (chars):', prompt ? prompt.length : 'undefined')

    if (!prompt) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'No prompt provided' })
      }
    }

    console.log('Calling Groq API...')

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

    console.log('Groq response status:', response.status)

    const data = await response.json()

    if (!response.ok) {
      console.log('Groq error response:', JSON.stringify(data))
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'Groq API error ' + response.status + ': ' + (data.error?.message || JSON.stringify(data))
        })
      }
    }

    if (!data.choices || !data.choices[0]) {
      console.log('No choices in response:', JSON.stringify(data))
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'No response from Groq: ' + JSON.stringify(data)
        })
      }
    }

    console.log('Groq response received, finish_reason:', data.choices[0].finish_reason)
    console.log('Response length (chars):', data.choices[0].message.content.length)

    let result = data.choices[0].message.content

    // Strip markdown code fences if present
    result = result.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()

    // Fix common JSON issues
    result = result
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')

    // Remove trailing commas before } or ]
    result = result.replace(/,\s*([}\]])/g, '$1')

    // Validate JSON
    try {
      JSON.parse(result)
      console.log('JSON validation passed')
    } catch(parseErr) {
      console.log('JSON parse error:', parseErr.message)
      console.log('Raw result start:', result.slice(0, 300))

      const firstBrace = result.indexOf('{')
      if (firstBrace > -1) {
        let cleaned = result.slice(firstBrace)
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
          cleaned = cleaned.replace(/,\s*$/, '')
          let opens = (cleaned.match(/\{/g) || []).length
          let closes = (cleaned.match(/\}/g) || []).length
          let arrOpens = (cleaned.match(/\[/g) || []).length
          let arrCloses = (cleaned.match(/\]/g) || []).length
          for (let i = 0; i < arrOpens - arrCloses; i++) cleaned += ']'
          for (let i = 0; i < opens - closes; i++) cleaned += '}'
          result = cleaned
        }
      }

      // Final validation
      try {
        JSON.parse(result)
        console.log('JSON repair succeeded')
      } catch(e) {
        console.log('JSON repair failed:', e.message)
        return {
          statusCode: 500,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            error: 'AI returned invalid JSON that could not be repaired. Please try again.',
            raw: result.slice(0, 200)
          })
        }
      }
    }

    console.log('Returning successful result')

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ result })
    }

  } catch (err) {
    console.log('Caught exception:', err.message)
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    }
  }
}
