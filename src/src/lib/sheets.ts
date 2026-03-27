import { google } from 'googleapis';

const SHEET_NAME = 'Accounts';
const HEADER_ROW = ['email', 'password', 'totpSecret', 'monthlyCredits', 'additionalCredits', 'additionalCreditsExpiry', 'memberActivities', 'lastChecked', 'status'];

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
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

function cellToAccount(row: string[], rowIndex: number): Account {
  return {
    rowIndex,
    email: row[0] || '',
    password: row[1] || '',
    totpSecret: row[2] || '',
    monthlyCredits: row[3] || '',
    additionalCredits: row[4] || '',
    additionalCreditsExpiry: row[5] || '',
    memberActivities: row[6] || '',
    lastChecked: row[7] || '',
    status: row[8] || '',
  };
}

export async function ensureSheetExists(): Promise<void> {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID!;

  // Check if sheet exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets?.some(s => s.properties?.title === SHEET_NAME);

  if (!exists) {
    // Create the sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
  }

  // Check if header row exists
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1:I1`,
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1:I1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER_ROW] },
    });
  }
}

export async function getAccounts(): Promise<Account[]> {
  const sheets = getSheetsClient();
  await ensureSheetExists();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: `${SHEET_NAME}!A2:I`,
  });

  const rows = res.data.values || [];
  return rows
    .map((row, idx) => cellToAccount(row as string[], idx + 2))
    .filter(a => a.email); // skip empty rows
}

export async function addAccount(account: { email: string; password: string; totpSecret: string }): Promise<void> {
  const sheets = getSheetsClient();
  await ensureSheetExists();

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: `${SHEET_NAME}!A:I`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[account.email, account.password, account.totpSecret, '', '', '', '', '', 'pending']],
    },
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
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: `${SHEET_NAME}!D${rowIndex}:I${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        data.monthlyCredits,
        data.additionalCredits,
        data.additionalCreditsExpiry,
        data.memberActivities,
        data.lastChecked,
        data.status,
      ]],
    },
  });
}

export async function update2FASecret(rowIndex: number, totpSecret: string): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: `${SHEET_NAME}!C${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[totpSecret]] },
  });
}

export async function deleteAccount(rowIndex: number): Promise<void> {
  const sheets = getSheetsClient();
  const sheetId = process.env.GOOGLE_SHEET_ID!;

  // Get the sheet's gid
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === SHEET_NAME);
  const gid = sheet?.properties?.sheetId ?? 0;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: gid,
            dimension: 'ROWS',
            startIndex: rowIndex - 1, // 0-based
            endIndex: rowIndex,       // exclusive
          },
        },
      }],
    },
  });
}
