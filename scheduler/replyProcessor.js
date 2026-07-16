const cron = require('node-cron');
const Candidate = require('../models/Candidate');
const ProcessedEmail = require('../models/ProcessedEmail');
const AdminGoogleAuth = require('../models/AdminGoogleAuth');
const { createOAuth2Client } = require('../config/google');
const { createGmailService } = require('../services/gmailService');
const parseCandidateReply = require('../services/aiService');
const qualifies = require('../services/qualificationService');

const SYSTEM_SENDER_PATTERNS = [
  'no-reply', 'noreply', 'mailer-daemon', 'postmaster',
  'google', 'pinterest', 'groww', 'linkedin', 'naukri',
  'codingninjas', 'wps', 'notifications'
];

const SCREENING_REPLY_KEYWORDS = [
  'visa', 'opt', 'cpt', 'stem', 'f1', 'h1b', 'h-1b',
  'green card', 'citizen', 'location', 'state', 'city',
  'marketing', 'arrival', 'came to', 'full name', 'name:',
  'looking for'
];

let isRunning = false;

function decodeBodyData(data) {
  if (!data) return '';

  return Buffer.from(
    data.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8');
}

function extractBody(payload) {
  if (!payload) return '';

  if (payload.body?.data) {
    return decodeBodyData(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain') {
        const text = extractBody(part);
        if (text) return text;
      }
    }

    for (const part of payload.parts) {
      const text = extractBody(part);
      if (text) return text;
    }
  }

  return '';
}

async function markEmailProcessed(svc, adminId, messageId) {
  await svc.markAsRead(messageId);

  await ProcessedEmail.create({
    adminId,
    messageId,
    processedAt: new Date()
  });
}

async function processAdminReplies(adminAuth) {
  const { adminId, tokens } = adminAuth;
  const auth = createOAuth2Client(tokens);

  auth.on('tokens', async (newTokens) => {
    const merged = { ...tokens, ...newTokens };

    await AdminGoogleAuth.updateOne(
      { adminId },
      { $set: { tokens: merged } }
    );
  });

  const svc = createGmailService(auth);
  const emails = await svc.getUnreadEmails();

  console.log(`[replyProcessor] Admin ${adminId}: ${emails.length} unread emails`);

  for (const email of emails) {
    if (!email?.id) continue;

    const alreadyProcessed = await ProcessedEmail.exists({
      adminId,
      messageId: email.id
    });

    if (alreadyProcessed) continue;

    try {
      const msg = await svc.getMessage(email.id);
      const headers = msg.payload?.headers || [];
      const rawFrom = headers.find(h => h.name === 'From')?.value;

      if (!rawFrom) {
        await markEmailProcessed(svc, adminId, email.id);
        continue;
      }

      const emailMatch = rawFrom.match(/<(.+?)>/);
      const from = emailMatch ? emailMatch[1].trim() : rawFrom.trim();
      const lowerFrom = from.toLowerCase();

      const isSystemMail =
        SYSTEM_SENDER_PATTERNS.some(pattern => lowerFrom.includes(pattern)) ||
        lowerFrom === String(adminAuth.email || '').toLowerCase();

      if (isSystemMail) {
        await markEmailProcessed(svc, adminId, email.id);
        continue;
      }

      const existingCandidate = await Candidate.findOne({
        adminId,
        email: from,
        stage: 'SCREENING_SENT'
      });

      if (!existingCandidate) {
        await markEmailProcessed(svc, adminId, email.id);
        continue;
      }

      const body = extractBody(msg.payload) || msg.snippet || '';
      const lowerBody = body.toLowerCase();

      const looksLikeScreeningReply = SCREENING_REPLY_KEYWORDS.some(keyword =>
        lowerBody.includes(keyword)
      );

      if (!looksLikeScreeningReply) {
        await markEmailProcessed(svc, adminId, email.id);
        continue;
      }

      const parsed = await parseCandidateReply(body);

      console.log(`[replyProcessor] Parsed admin ${adminId}:`, parsed);

      if (!parsed.location || !parsed.visa_status) {
        existingCandidate.stage = 'NEEDS_REVIEW';
        await existingCandidate.save();
        await markEmailProcessed(svc, adminId, email.id);
        continue;
      }

      const qualified = qualifies(parsed);

      existingCandidate.name = parsed.full_name || existingCandidate.name;
      existingCandidate.location = parsed.location;
      existingCandidate.visaStatus = parsed.visa_status;
      existingCandidate.usArrivalDate = parsed.arrival_date;

      if (qualified) {
        await svc.sendEmail(
          from,
          'Interview Booking',
          `Thanks for your details.

Kindly book your slot so we can discuss further opportunities.

${process.env.BOOKING_LINK}
`
        );

        existingCandidate.qualified = true;
        existingCandidate.stage = 'BOOKING_SENT';

        console.log(`[replyProcessor] Booking sent to ${from} admin ${adminId}`);
      } else {
        existingCandidate.qualified = false;
        existingCandidate.stage = 'REJECTED';

        console.log(`[replyProcessor] Rejected ${from} admin ${adminId}`);
      }

      await existingCandidate.save();
      await markEmailProcessed(svc, adminId, email.id);
    } catch (err) {
      console.log('[replyProcessor] Item failed:', err.message);

      try {
        await svc.markAsRead(email.id);
      } catch {}
    }
  }
}

cron.schedule('*/2 * * * *', async () => {
  if (isRunning) {
    console.log('[replyProcessor] Already running, skipping');
    return;
  }

  isRunning = true;

  try {
    const admins = await AdminGoogleAuth.find();

    if (!admins.length) {
      console.log('[replyProcessor] No admins have connected Gmail yet');
      return;
    }

    for (const adminAuth of admins) {
      try {
        await processAdminReplies(adminAuth);
      } catch (err) {
        console.log(
          `[replyProcessor] Failed for admin ${adminAuth.adminId}:`,
          err.message
        );
      }
    }
  } catch (err) {
    console.log('[replyProcessor] Cron failed:', err.message);
  } finally {
    isRunning = false;
  }
});