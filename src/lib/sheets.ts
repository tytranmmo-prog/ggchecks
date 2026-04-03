import { createReadStream } from 'fs';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { google } from 'googleapis';
import { getConfig } from './config';
import { createLogger } from './pino-logger';

const log = createLogger('sheets');

const SHEET_NAME = 'Accounts';
const HEADER_ROW = ['email', 'password', 'totpSecret', 'proxy'];

export interface Account {
  rowIndex: number; // 1-based row in sheet (row 1 = header, so data starts at 2)
  email: string;
  password: string;
  totpSecret: string;
  proxy?: string;
}

function getAuth() {
  const jwtOptions: any = {
    email: getConfig('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    key: (getConfig('GOOGLE_PRIVATE_KEY') || '').replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  };

  // If using OAuth delegation (Domain-Wide Delegation), authenticate as this user
  const delegatedSubject = getConfig('GOOGLE_DELEGATED_SUBJECT');
  if (delegatedSubject) {
    jwtOptions.subject = delegatedSubject;
  }

  return new JWT(jwtOptions);
}

// ... getsheet methods ...
async function getSheet() {
  const doc = new GoogleSpreadsheet(getConfig('GOOGLE_SHEET_ID')!, getAuth());
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
      proxy: row.get('proxy') || '',
    }))
    .filter(a => a.email);
}

export async function addAccount(account: {
  email:      string;
  password:   string;
  totpSecret: string;
  proxy?:     string;
}): Promise<void> {
  const sheet = await getSheet();
  await sheet.addRow({
    email:      account.email,
    password:   account.password,
    totpSecret: account.totpSecret,
    proxy:      account.proxy ?? '',
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

  const folderId = getConfig('DRIVE_SCREENSHOT_FOLDER_ID'); // optional

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
      log.warn('Invalid Drive Folder ID — uploading to root instead', { folderId });
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

export async function updateProxy(rowIndex: number, proxy: string): Promise<void> {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const row = rows[rowIndex - 2];
  if (!row) throw new Error(`Row ${rowIndex} not found`);

  row.set('proxy', proxy);
  await row.save();
}

/**
 * Backfill the proxy column for multiple sheet rows in a single API call.
 * Loads only the proxy column for the affected rows, sets values locally,
 * then flushes everything with one `saveUpdatedCells()` call.
 *
 * @param updates  Array of { rowIndex (1-based), proxy } to write.
 */
export async function batchUpdateProxy(
  updates: Array<{ rowIndex: number; proxy: string }>,
): Promise<void> {
  if (updates.length === 0) return;

  const sheet = await getSheet();

  // Find the 0-based column index of the 'proxy' column.
  // The sheet header is in row 0; we need the column letter for loadCells.
  await sheet.loadHeaderRow();
  const proxyColIndex = sheet.headerValues.indexOf('proxy');
  if (proxyColIndex === -1) throw new Error("'proxy' column not found in sheet header");

  // Determine the row range to load (sheet rows are 0-based internally;
  // rowIndex is 1-based where row 1 = header, so data row n → zero-based n-1).
  const minRow = Math.min(...updates.map(u => u.rowIndex)) - 1; // inclusive, 0-based
  const maxRow = Math.max(...updates.map(u => u.rowIndex)) - 1; // inclusive, 0-based

  // Load only the proxy column for the affected rows.
  await sheet.loadCells({
    startRowIndex:    minRow,
    endRowIndex:      maxRow + 1,  // exclusive
    startColumnIndex: proxyColIndex,
    endColumnIndex:   proxyColIndex + 1,
  });

  // Mutate each cell locally — no network call yet.
  for (const { rowIndex, proxy } of updates) {
    const cell = sheet.getCell(rowIndex - 1, proxyColIndex);
    cell.value = proxy;
  }

  // One API call flushes all dirty cells.
  await sheet.saveUpdatedCells();
  log.info('batch proxy backfill done', { count: updates.length });
}

export async function deleteAccount(rowIndex: number): Promise<void> {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const row = rows[rowIndex - 2];
  if (!row) throw new Error(`Row ${rowIndex} not found`);

  await row.delete();
}
