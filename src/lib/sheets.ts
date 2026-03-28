import { createReadStream } from 'fs';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { google } from 'googleapis';

const SHEET_NAME = 'Accounts';
const HEADER_ROW = ['email', 'password', 'totpSecret', 'monthlyCredits', 'additionalCredits', 'additionalCreditsExpiry', 'memberActivities', 'lastChecked', 'status', 'screenshot'];

export interface Account {
  rowIndex: number; // 1-based row in sheet (row 1 = header, so data starts at 2)
  email: string;
  password: string;
  totpSecret: string;
  monthlyCredits?: string;
  additionalCredits?: string;
  additionalCreditsExpiry?: string;
  memberActivities?: string;
  lastChecked?: string;
  status?: string;
}

function getAuth() {
  const jwtOptions: any = {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  };

  // If using OAuth delegation (Domain-Wide Delegation), authenticate as this user
  if (process.env.GOOGLE_DELEGATED_SUBJECT) {
    jwtOptions.subject = process.env.GOOGLE_DELEGATED_SUBJECT;
  }

  return new JWT(jwtOptions);
}

// ... getsheet methods ...
async function getSheet() {
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID!, getAuth());
  await doc.loadInfo();

  let sheet = doc.sheetsByTitle[SHEET_NAME];
  if (!sheet) {
    sheet = await doc.addSheet({ title: SHEET_NAME, headerValues: HEADER_ROW });
  }

  return sheet;
}

export async function ensureSheetExists(): Promise<void> {
  await getSheet(); // creates sheet + headers if missing
}

export async function getAccounts(): Promise<Account[]> {
  const sheet = await getSheet();
  const rows = await sheet.getRows();

  return rows
    .map((row, idx) => ({
      rowIndex: idx + 2, // row 1 = header
      email: row.get('email') || '',
      password: row.get('password') || '',
      totpSecret: row.get('totpSecret') || '',
      monthlyCredits: row.get('monthlyCredits') || '',
      additionalCredits: row.get('additionalCredits') || '',
      additionalCreditsExpiry: row.get('additionalCreditsExpiry') || '',
      memberActivities: row.get('memberActivities') || '',
      lastChecked: row.get('lastChecked') || '',
      status: row.get('status') || '',
    }))
    .filter(a => a.email);
}

export async function addAccount(account: { email: string; password: string; totpSecret: string }): Promise<void> {
  const sheet = await getSheet();
  await sheet.addRow({
    email: account.email,
    password: account.password,
    totpSecret: account.totpSecret,
    status: 'pending',
  });
}

export async function updateCreditResult(
  rowIndex: number,
  data: {
    monthlyCredits: string;
    additionalCredits: string;
    additionalCreditsExpiry: string;
    memberActivities: string;
    lastChecked: string;
    status: string;
  }
): Promise<void> {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const row = rows[rowIndex - 2]; // rowIndex is 1-based, row 1 = header
  if (!row) throw new Error(`Row ${rowIndex} not found`);

  row.set('monthlyCredits', data.monthlyCredits);
  row.set('additionalCredits', data.additionalCredits);
  row.set('additionalCreditsExpiry', data.additionalCreditsExpiry);
  row.set('memberActivities', data.memberActivities);
  row.set('lastChecked', data.lastChecked);
  row.set('status', data.status);
  await row.save();
}

/**
 * Upload a local PNG to Google Drive (in SCREENSHOT_FOLDER_ID if set, else root),
 * make it publicly readable, and return a direct image URL.
 */
export async function uploadScreenshotToDrive(localPath: string): Promise<string> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const folderId = process.env.DRIVE_SCREENSHOT_FOLDER_ID; // optional

  let file;
  try {
    file = await drive.files.create({
      requestBody: {
        name: localPath.split('/').pop(),
        mimeType: 'image/png',
        ...(folderId && folderId.length > 10 ? { parents: [folderId] } : {}), // simple length check to ignore 'ggchecks'
      },
      media: {
        mimeType: 'image/png',
        body: createReadStream(localPath),
      },
      fields: 'id',
      supportsAllDrives: true,
    });
  } catch (err: any) {
    if (folderId && err.message?.toLowerCase().includes('not found')) {
      console.warn(`⚠️ Invalid Drive Folder ID (${folderId}). Uploading to root instead.`);
      file = await drive.files.create({
        requestBody: { name: localPath.split('/').pop(), mimeType: 'image/png' },
        media: { mimeType: 'image/png', body: createReadStream(localPath) },
        fields: 'id',
        supportsAllDrives: true,
      });
    } else {
      throw err;
    }
  }

  const fileId = file.data.id!;

  // Make the file publicly readable so the IMAGE() formula can fetch it
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  });

  // Use the thumbnail URL — directly embeddable without login
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

/**
 * Write an =IMAGE() formula into the 'screenshot' column for a given row.
 * Adds the column header automatically if the sheet was created before this feature.
 */
export async function updateErrorScreenshot(
  rowIndex: number,
  imageUrl: string,
): Promise<void> {
  const sheet = await getSheet();
  const rows  = await sheet.getRows();
  const row   = rows[rowIndex - 2];
  if (!row) throw new Error(`Row ${rowIndex} not found`);

  row.set('screenshot', `=IMAGE("${imageUrl}")`);
  await row.save();
}

export async function update2FASecret(rowIndex: number, totpSecret: string): Promise<void> {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const row = rows[rowIndex - 2];
  if (!row) throw new Error(`Row ${rowIndex} not found`);

  row.set('totpSecret', totpSecret);
  await row.save();
}

export async function deleteAccount(rowIndex: number): Promise<void> {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const row = rows[rowIndex - 2];
  if (!row) throw new Error(`Row ${rowIndex} not found`);

  await row.delete();
}
