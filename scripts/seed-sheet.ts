import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local before anything else
config({ path: resolve(process.cwd(), '.env.local') });

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import accounts from '../accounts.json';

const SHEET_NAME = 'Accounts';
const HEADER_ROW = ['email', 'password', 'totpSecret', 'monthlyCredits', 'additionalCredits', 'additionalCreditsExpiry', 'memberActivities', 'lastChecked', 'status'];

async function seed() {
  const auth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID!, auth);
  await doc.loadInfo();
  console.log(`📄 Connected to: ${doc.title}`);

  // Get or create sheet
  let sheet = doc.sheetsByTitle[SHEET_NAME];
  if (!sheet) {
    sheet = await doc.addSheet({ title: SHEET_NAME, headerValues: HEADER_ROW });
    console.log(`✅ Created sheet: ${SHEET_NAME}`);
  } else {
    // Ensure headers are set
    await sheet.setHeaderRow(HEADER_ROW);
    console.log(`✅ Found existing sheet: ${SHEET_NAME}`);
  }

  // Clear existing data rows (keep header)
  const existingRows = await sheet.getRows();
  if (existingRows.length > 0) {
    console.log(`🗑  Clearing ${existingRows.length} existing row(s)...`);
    await Promise.all(existingRows.map(r => r.delete()));
  }

  // Insert accounts
  for (const account of accounts) {
    await sheet.addRow({
      email: account.email,
      password: account.password,
      totpSecret: account.totpSecret,
      status: 'pending',
    });
    console.log(`➕ Added: ${account.email}`);
  }

  console.log(`\n🎉 Done! Seeded ${accounts.length} account(s) into "${SHEET_NAME}".`);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
