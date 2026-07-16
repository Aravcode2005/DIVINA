const contentInfo = require('../models/contentmodel');
const linkedinInfo = require('../models/linkedinauth');
const adminGoogleAuthSchema = require('../models/AdminGoogleAuth');
const { default: OpenAI } = require('openai');
const { chromium } = require('playwright');
require('dotenv').config();

const client = new OpenAI({ apiKey: process.env.OPEN_AI_API_KEY });
async function getPolishedPosts(content, RESUME_EMAIL) {
    const SAMPLE_POST = `Cybersecurity Analyst | Washington, DC
We're looking for a sharp Cybersecurity Analyst to protect and monitor critical systems!

    Monitor security alerts and respond to incidents in real time
    Conduct vulnerability scans and risk assessments
    Work with SIEM tools to detect and mitigate threats

   Interested? Send your resume to: ${RESUME_EMAIL}
   H1B visa sponsorship available

#CybersecurityAnalyst #Washington #FullTime #Hiring`;

    const STRICT_FORMAT = `[Job Title] | [City, State]

[1 or 2 sentence engaging hook about the role]
     [Responsibility/Requirement 1]
   [Responsibility/Requirement 2]
  [Responsibility/Requirement 3]

 Interested? Send your resume to: ${RESUME_EMAIL}
 H1B visa sponsorship available

#[JobTitle] #[City] #[EmploymentType] #Hiring`;
    try {
        const systemPrompt = `You are an expert LinkedIn copywriter for a recruitment agency.

You will be given one or more job postings. For EACH job posting, generate one professional LinkedIn post.

STRICT RULES — follow every one, no exceptions:
1. Use ONLY information provided. Never invent skills, benefits, or details.
2. Every post MUST include:   Interested? Send your resume to: ${RESUME_EMAIL}
3. Every post MUST include:   H1B visa sponsorship available (if mentioned in the source)
4. Every post MUST end with relevant hashtags: job title, city, employment type, and #Hiring
5. Tone: engaging, professional, concise. No filler phrases.
6. Format EVERY post exactly like this template:

${STRICT_FORMAT}

REFERENCE EXAMPLE (match this quality exactly):

${SAMPLE_POST}

Return a JSON object in this EXACT format:
{
  "posts": ["<full post 1>", "<full post 2>", ...]
}

Return ONLY valid JSON. No markdown, no backticks, no explanation. One post per job.`;
        const response = await client.chat.completions.create({
            model: 'gpt-3.5-turbo',
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: `Generate LinkedIn job posts for the following job postings:\n\n${content}`
                }
            ]
        });

        const text = response.choices[0].message.content;
        const parsed = JSON.parse(text);

        if (!Array.isArray(parsed.posts)) {
            throw new Error('GPT response missing "posts" array');
        }

        return parsed.posts;
    } catch (error) {
        console.error('[getPolishedPosts] Error:', error.message);
        return [];
    }
}
async function fetchandpost(content, credentials) {
    let browser;
    try {
        browser = await chromium.launch({
            headless: true
        });

        const context = await browser.newContext({ storageState: credentials });
        const page = await context.newPage();

        await page.goto('https://www.linkedin.com/feed/');
        await page.waitForTimeout(4000);

        await page.getByText('Start a post').click();

        const textbox = page.locator('[role="textbox"]').last();
        await textbox.waitFor();
        await textbox.click();
        await textbox.fill(content);
        await page.waitForTimeout(2000);

        const postButton = page.getByRole('button', { name: 'Post' }).last();
        const isEnabled = await postButton.isEnabled();
        console.log('[fetchandpost] Post button enabled:', isEnabled);

        if (!isEnabled) {
            throw new Error('Post button was not enabled — content may be empty or invalid');
        }

        await postButton.click();
        await page.waitForTimeout(5000);

        console.log('[fetchandpost] Post submitted successfully');
    } catch (error) {
        console.error('[fetchandpost] Error:', error.message);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

function shuffle(arr = []) {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}


async function postToLinkedin() {
    let contentDoc;
    try {
        contentDoc = await contentInfo.find();
    } catch (err) {
        console.error('[postToLinkedin] Failed to fetch content docs:', err.message);
        return;
    }

    for (const userDoc of contentDoc) {
        try {
            const crx = await linkedinInfo.findOne({ adminId: userDoc.adminId });

            if (!crx || !crx.AdminSessionInfo) {
                console.warn(`[postToLinkedin] No LinkedIn credentials for adminId: ${userDoc.adminId} — skipping`);
                continue;
            }
            const googleDoc = await adminGoogleAuthSchema.findOne({ adminId: userDoc.adminId });
            if (!googleDoc || !googleDoc.email) {
                console.warn(`[postToLinkedin] No Google email for adminId: ${userDoc.adminId} — skipping`);
                continue;
            }
            const email = googleDoc.email;
            const credentials = crx.AdminSessionInfo;
            const record = userDoc.contentSchedule;
            for (const entry of record) {
                const [content, scheduledAt] = entry;

                if (new Date(scheduledAt) > new Date()) {
                    console.log(`[postToLinkedin] Entry not yet due, skipping`);
                    continue;
                }
                const queue = await getPolishedPosts(content, email);
                if (queue.length === 0) {
                    console.warn('[postToLinkedin] GPT returned no posts, skipping entry');
                    continue;
                }
                const shuffledQueue = shuffle(queue);

                for (const post of shuffledQueue) {
                    try {
                        await fetchandpost(post, credentials);
                    } catch (postErr) {
                        console.error('[postToLinkedin] Failed to post one entry, continuing:', postErr.message);
                    }
                }
                await contentInfo.updateOne(
                    { _id: userDoc._id },
                    { $pull: { contentSchedule: entry } }
                );
                console.log(`[postToLinkedin] Completed and cleaned up entry for adminId: ${userDoc.adminId}`);
            }
        } catch (userErr) {
            console.error(`[postToLinkedin] Error processing adminId ${userDoc.adminId}:`, userErr.message);
        }
    }
}

module.exports = { postToLinkedin };