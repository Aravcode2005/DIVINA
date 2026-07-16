const { google } = require('googleapis');

function createGmailService(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  const calendar = google.calendar({ version: 'v3', auth });

  async function getUnreadEmails() {
    try {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread in:inbox -in:spam -in:trash -in:sent -from:mailer-daemon -from:no-reply -from:noreply -from:postmaster -from:notifications',
        maxResults: 50,
        labelIds: ['INBOX']
      });
      return res.data.messages || [];
    } catch (err) {
      console.log('getUnreadEmails error:', err.message);
      return [];
    }
  }

  async function getMessage(id) {
    try {
      const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      return res.data;
    } catch (err) {
      console.log('getMessage error:', err.message);
      throw err;
    }
  }

  async function sendEmail(to, subject, body) {
    const from = process.env.EMAIL_USER;
    if (!from) throw new Error('EMAIL_USER is not set');

    const messageParts = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body
    ];

    const encodedMessage = Buffer.from(messageParts.join('\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    try {
      const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
      return res.data;
    } catch (err) {
      console.log('sendEmail error:', err.message);
      throw err;
    }
  }

  async function markAsRead(id) {
    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id,
        requestBody: { removeLabelIds: ['UNREAD'] }
      });
    } catch (err) {
      console.log('markAsRead error:', err.message);
      throw err;
    }
  }

  async function createInterview(candidate) {
    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    const extraAttendees = (process.env.INTERVIEW_ATTENDEES || '')
      .split(',').map(e => e.trim()).filter(Boolean).map(email => ({ email }));

    const response = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Interview - ${candidate.name}`,
        description: `Name: ${candidate.name}\nLocation: ${candidate.location}\nVisa: ${candidate.visaStatus}`,
        attendees: [{ email: candidate.email }, ...extraAttendees],
        start: { dateTime: startTime.toISOString(), timeZone: process.env.CALENDAR_TIMEZONE || 'America/Chicago' },
        end: { dateTime: endTime.toISOString(), timeZone: process.env.CALENDAR_TIMEZONE || 'America/Chicago' },
        conferenceData: { createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } }
      }
    });
    return response.data;
  }

  return { getUnreadEmails, getMessage, sendEmail, markAsRead, createInterview };
}

module.exports = { createGmailService };
