import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

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
  return new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

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
