const OpenAI = require('openai');

function normalizeReplyText(text) {
  if (!text) return '';

  let normalized = String(text).replace(/\r\n/g, '\n').trim();

  const separators = [
    '\nOn ',
    '\nFrom:',
    '\n-----Original Message-----',
    '\n---\n',
    '\n________________________________'
  ];

  let cutoff = normalized.length;
  for (const sep of separators) {
    const index = normalized.indexOf(sep);
    if (index !== -1 && index < cutoff) {
      cutoff = index;
    }
  }

  normalized = normalized.slice(0, cutoff).trim();

  normalized = normalized
    .split('\n')
    .filter(line => !line.trim().startsWith('>'))
    .join('\n')
    .trim();

  return normalized;
}

function truncateForOpenAI(text, maxChars = 12000) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  console.log(`OpenAI input too long (${text.length} chars); truncating to ${maxChars} chars`);
  return text.slice(-maxChars);
}

async function callOpenAI(text) {
  const apiKey = process.env.OPEN_AI_API_KEY;
  if (!apiKey) return null;

  const client = new OpenAI({ apiKey });
  const safeText = truncateForOpenAI(normalizeReplyText(text));

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `Extract candidate information from the email.

Return ONLY valid JSON.

Schema:
{
  "full_name": "",
  "location": "",
  "visa_status": "",
  "arrival_date": "",
  "marketing_services": ""
}

Rules:
- If information is missing, use null
- Do not explain anything
- Do not add markdown
- Do not use triple backticks
- Output raw JSON only
- Normalize visa statuses when possible
- Convert variations like:
  "stem opt" -> "STEM-OPT"
  "f1 opt" -> "F1-OPT"
  "initial opt" -> "INITIAL-OPT"
  "cpt" -> "CPT"`
        },
        { role: 'user', content: safeText }
      ]
    });

    const raw = response.choices?.[0]?.message?.content;
    if (!raw) return null;

    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.log('OpenAI request failed:', err.message);
    return null;
  }
}

function heuristicParseCandidateReply(text) {
  const normalized = text.replace(/\r\n/g, '\n').trim();

  const extractValue = (labels) => {
    for (const label of labels) {
      const pattern = new RegExp(
        `${label}[:\\s]*([\\s\\S]{1,200}?)(?=$|\\n\\w[\\w ]*:|\\n{2})`,
        'i'
      );
      const match = normalized.match(pattern);
      if (match) {
        return match[1].trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
      }
    }
    return null;
  };

  const lower = normalized.toLowerCase();

  const visaPatterns = [
    'stem opt',
    'f1 opt',
    'initial opt',
    'cpt',
    'opt',
    'f1',
    'h1b',
    'green card',
    'citizen'
  ];

  const visaStatus = visaPatterns.find(status => lower.includes(status));

  const marketingMatch = normalized.match(
    /marketing.*?(yes|no|not interested|nope|never|looking)/i
  );

  return {
    full_name: extractValue(['full name', 'name', 'candidate name']) || null,
    location: extractValue(['current location', 'location', 'based in']) || null,
    visa_status: visaStatus ? visaStatus.toUpperCase().replace(/ /g, '-') : null,
    arrival_date: extractValue(['when did you come to the us', 'arrival date', 'came to the us', 'arrival']) || null,
    marketing_services: marketingMatch
      ? marketingMatch[1].toLowerCase().startsWith('y') || marketingMatch[1].toLowerCase() === 'looking'
        ? 'yes'
        : 'no'
      : null
  };
}

async function parseCandidateReply(text) {
  const cleanedText = normalizeReplyText(text);

  if (!cleanedText) {
    return {
      full_name: null,
      location: null,
      visa_status: null,
      arrival_date: null,
      marketing_services: null
    };
  }

  const aiResult = await callOpenAI(cleanedText);
  if (aiResult && typeof aiResult === 'object') {
    return {
      full_name: aiResult.full_name || null,
      location: aiResult.location || null,
      visa_status: aiResult.visa_status || null,
      arrival_date: aiResult.arrival_date || null,
      marketing_services: aiResult.marketing_services || null
    };
  }

  console.log('OpenAI not configured or not available. Using fallback heuristic parser.');
  return heuristicParseCandidateReply(cleanedText);
}

module.exports = parseCandidateReply;
