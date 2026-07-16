const cron = require('node-cron');
const Candidate = require('../models/Candidate');
const ProcessedEmail = require('../models/ProcessedEmail');
const AdminGoogleAuth = require('../models/AdminGoogleAuth');
const { createOAuth2Client } = require('../config/google');
const { createGmailService } = require('../services/gmailService');

const SCREENING_MESSAGE = `
Please share the below details:
 1. Full Name:
 2. Current Location:
 3. Visa Status:
 4. When did you come to the US?:
 5. Are you looking for marketing services?:
`;

const SYSTEM_SENDER_PATTERNS = [
  'no-reply',
  'noreply',
  'mailer-daemon',
  'postmaster',
  'google',
  'pinterest',
  'groww',
  'unstop',
  'naukri',
  'linkedin',
  'notifications'
];

const APPLICATION_KEYWORDS = [
  'resume',
  'application',
  'applying',
  'apply',
  'job',
  'developer',
  'engineer',
  'experience',
  'internship',
  'portfolio',
  'cv',
  'position',
  'opportunity',
  'candidate',
  'skills'
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

async function scanAdminInbox(adminAuth) {
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

  console.log(`[emailScanner] Admin ${adminId}: ${emails.length} unread emails`);

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
      const subject = headers.find(h => h.name === 'Subject')?.value || '';

      if (!rawFrom) {
        await markEmailProcessed(svc, adminId, email.id);
        continue;
      }

      const emailMatch = rawFrom.match(/<(.+?)>/);
      const from = emailMatch ? emailMatch[1].trim() : rawFrom.trim();

      const lowerFrom = from.toLowerCase();

      const isSystemSender =
        SYSTEM_SENDER_PATTERNS.some(pattern => lowerFrom.includes(pattern)) ||
        lowerFrom === String(adminAuth.email || '').toLowerCase();

      if (isSystemSender) {
        await markEmailProcessed(svc, adminId, email.id);
        continue;
      }
      const pendingCandidate = await Candidate.findOne({
        adminId,
        email: from,
        stage: 'SCREENING_SENT'
      });
      if (pendingCandidate) {
        continue;
      }

      const body = extractBody(msg.payload) || msg.snippet || '';
      const lowerSubject = subject.toLowerCase();
      const lowerBody = body.toLowerCase();

      const looksLikeApplication = APPLICATION_KEYWORDS.some(
        keyword =>
          lowerSubject.includes(keyword) ||
          lowerBody.includes(keyword)
      );

      if (!looksLikeApplication) {
        await markEmailProcessed(svc, adminId, email.id);
        continue;
      }

      const existing = await Candidate.findOne({
        adminId,
        threadId: msg.threadId
      });

      if (existing) {
        await markEmailProcessed(svc, adminId, email.id);
        continue;
      }

      await svc.sendEmail(from, 'Candidate Screening', SCREENING_MESSAGE);

      await Candidate.create({
        adminId,
        email: from,
        stage: 'SCREENING_SENT',
        threadId: msg.threadId
      });

      await markEmailProcessed(svc, adminId, email.id);

      console.log(`[emailScanner] Screening sent to ${from} admin ${adminId}`);
    } catch (error) {
      console.log('[emailScanner] Item failed:', error.message);
    }
  }
}

cron.schedule('*/2 * * * *', async () => {
  if (isRunning) {
    console.log('[emailScanner] Already running, skipping');
    return;
  }

  isRunning = true;

  try {
    const admins = await AdminGoogleAuth.find();

    if (!admins.length) {
      console.log('[emailScanner] No admins have connected Gmail yet');
      return;
    }

    for (const adminAuth of admins) {
      try {
        await scanAdminInbox(adminAuth);
      } catch (err) {
        console.log(
          `[emailScanner] Failed for admin ${adminAuth.adminId}:`,
          err.message
        );
      }
    }
  } catch (err) {
    console.log('[emailScanner] Cron failed:', err.message);
  } finally {
    isRunning = false;
  }
});