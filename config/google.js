const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/admin/google/callback';

let clientId, clientSecret;

try {
  const credPath = path.resolve(process.cwd(), 'credentials.json');
  const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const c = credentials.installed || credentials.web || {};
  clientId = c.client_id || process.env.CLIENT_ID;
  clientSecret = c.client_secret || process.env.CLIENT_SECRET;
} catch (err) {
  clientId = process.env.CLIENT_ID;
  clientSecret = process.env.CLIENT_SECRET;
}

function createOAuth2Client(tokens) {
  const client = new google.auth.OAuth2(clientId, clientSecret, CALLBACK_URL);
  if (tokens) client.setCredentials(tokens);
  return client;
}

module.exports = { createOAuth2Client, CALLBACK_URL };
