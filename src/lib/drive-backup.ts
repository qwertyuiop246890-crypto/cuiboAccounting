import {collection, doc, getDocs, setDoc, db} from './local-db';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const BACKUP_PREFIX = 'cuibo-drive-backup-';
const LOCAL_CHANGE_KEY = 'cuibo_last_local_change_at';
const CLOUD_BACKUP_KEY = 'cuibo_last_cloud_backup_at';
const DRIVE_TOKEN_KEY = 'cuibo_google_drive_access_token';

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: {access_token?: string; error?: string}) => void;
          }) => {requestAccessToken: (options?: {prompt?: string}) => void};
          revoke?: (token: string, callback?: () => void) => void;
        };
      };
    };
  }
}

export type BackupCounts = {
  paymentAccounts: number;
  receipts: number;
  items: number;
  taxRefunds: number;
  transfers: number;
};

export type BackupPayload = {
  backupId: string;
  version: string;
  deviceId: string;
  exportedAt: string;
  counts: BackupCounts;
  paymentAccounts: any[];
  receipts: Record<string, {data: any; items: any[]}>;
  taxRefunds: any[];
  transfers: any[];
};

export type DriveBackupFile = {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
};

export const getDeviceId = () => {
  const key = 'cuibo_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
};

export const getLastLocalChangeAt = () => localStorage.getItem(LOCAL_CHANGE_KEY) || '';
export const getLastCloudBackupAt = () => localStorage.getItem(CLOUD_BACKUP_KEY) || '';
export const markCloudBackupAt = (value = new Date().toISOString()) => {
  localStorage.setItem(CLOUD_BACKUP_KEY, value);
};
export const getStoredDriveAccessToken = () => localStorage.getItem(DRIVE_TOKEN_KEY) || '';
export const clearStoredDriveAccessToken = () => localStorage.removeItem(DRIVE_TOKEN_KEY);

export const getGoogleProjectLabel = (clientId: string) => {
  const projectNumber = clientId.split('-')[0] || '';
  return {
    clientId,
    projectNumber,
    display: projectNumber ? `${projectNumber} (${clientId})` : clientId
  };
};

export const getBackupTotalCount = (counts: BackupCounts) => {
  return counts.paymentAccounts + counts.receipts + counts.items + counts.taxRefunds + counts.transfers;
};

export const buildBackupPayload = async (uid: string): Promise<BackupPayload> => {
  const paymentAccounts = (await getDocs(collection(db, `users/${uid}/paymentAccounts`))).docs.map((d: any) => ({id: d.id, ...d.data()}));
  const taxRefunds = (await getDocs(collection(db, `users/${uid}/taxRefunds`))).docs.map((d: any) => ({id: d.id, ...d.data()}));
  const transfers = (await getDocs(collection(db, `users/${uid}/transfers`))).docs.map((d: any) => ({id: d.id, ...d.data()}));
  const receiptsSnap = await getDocs(collection(db, `users/${uid}/receipts`));
  const receipts: BackupPayload['receipts'] = {};
  let itemsCount = 0;

  for (const receiptDoc of receiptsSnap.docs) {
    const itemsSnap = await getDocs(collection(db, `users/${uid}/receipts/${receiptDoc.id}/items`));
    const items = itemsSnap.docs.map((d: any) => ({id: d.id, ...d.data()}));
    itemsCount += items.length;
    receipts[receiptDoc.id] = {
      data: receiptDoc.data(),
      items
    };
  }

  return {
    backupId: crypto.randomUUID(),
    version: '3.1-drive',
    deviceId: getDeviceId(),
    exportedAt: new Date().toISOString(),
    counts: {
      paymentAccounts: paymentAccounts.length,
      receipts: receiptsSnap.docs.length,
      items: itemsCount,
      taxRefunds: taxRefunds.length,
      transfers: transfers.length
    },
    paymentAccounts,
    receipts,
    taxRefunds,
    transfers
  };
};

export const importBackupPayload = async (uid: string, data: BackupPayload) => {
  if (Array.isArray(data.paymentAccounts)) {
    for (const account of data.paymentAccounts) {
      await setDoc(doc(db, `users/${uid}/paymentAccounts/${account.id}`), account);
    }
  }

  if (Array.isArray(data.taxRefunds)) {
    for (const refund of data.taxRefunds) {
      const refundRef = refund.id ? doc(db, `users/${uid}/taxRefunds/${refund.id}`) : doc(collection(db, `users/${uid}/taxRefunds`));
      await setDoc(refundRef, refund);
    }
  }

  if (Array.isArray(data.transfers)) {
    for (const transfer of data.transfers) {
      const transferRef = transfer.id ? doc(db, `users/${uid}/transfers/${transfer.id}`) : doc(collection(db, `users/${uid}/transfers`));
      await setDoc(transferRef, transfer);
    }
  }

  if (data.receipts && !Array.isArray(data.receipts)) {
    for (const receiptId in data.receipts) {
      const payload = data.receipts[receiptId];
      if (!payload?.data) continue;
      await setDoc(doc(db, `users/${uid}/receipts/${receiptId}`), payload.data);
      if (Array.isArray(payload.items)) {
        for (const item of payload.items) {
          const itemRef = item.id ? doc(db, `users/${uid}/receipts/${receiptId}/items/${item.id}`) : doc(collection(db, `users/${uid}/receipts/${receiptId}/items`));
          await setDoc(itemRef, item);
        }
      }
    }
  }
};

export const requestDriveAccessToken = (clientId: string, prompt = '') => {
  return new Promise<string>((resolve, reject) => {
    const tokenClient = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: response => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error || 'Google Drive authorization failed.'));
          return;
        }
        localStorage.setItem(DRIVE_TOKEN_KEY, response.access_token);
        resolve(response.access_token);
      }
    });

    if (!tokenClient) {
      reject(new Error('Google Identity Services is not ready.'));
      return;
    }

    tokenClient.requestAccessToken({prompt});
  });
};

export const revokeDriveAccess = async () => {
  const token = getStoredDriveAccessToken();
  clearStoredDriveAccessToken();
  if (!token) return;

  await new Promise<void>((resolve) => {
    if (!window.google?.accounts?.oauth2?.revoke) {
      resolve();
      return;
    }
    window.google.accounts.oauth2.revoke(token, () => resolve());
  });
};

export const listDriveBackups = async (accessToken: string): Promise<DriveBackupFile[]> => {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name contains '${BACKUP_PREFIX}' and trashed=false`,
    fields: 'files(id,name,createdTime,modifiedTime,size)',
    orderBy: 'createdTime desc',
    pageSize: '10'
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: {Authorization: `Bearer ${accessToken}`}
  });

  if (!response.ok) throw new Error(`Google Drive list failed (${response.status})`);
  const payload = await response.json();
  return payload.files || [];
};

export const downloadDriveBackup = async (accessToken: string, fileId: string): Promise<BackupPayload> => {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {Authorization: `Bearer ${accessToken}`}
  });

  if (!response.ok) throw new Error(`Google Drive download failed (${response.status})`);
  return response.json();
};

export const uploadDriveBackup = async (accessToken: string, data: BackupPayload) => {
  const boundary = `cuibo_${crypto.randomUUID()}`;
  const fileName = `${BACKUP_PREFIX}${data.exportedAt.replace(/[:.]/g, '-')}.json`;
  const metadata = {
    name: fileName,
    parents: ['appDataFolder'],
    mimeType: 'application/json',
    appProperties: {
      version: data.version,
      backupId: data.backupId,
      deviceId: data.deviceId,
      exportedAt: data.exportedAt,
      totalCount: String(getBackupTotalCount(data.counts))
    }
  };

  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n`,
    `--${boundary}--`
  ];

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: new Blob(body, {type: `multipart/related; boundary=${boundary}`})
  });

  if (!response.ok) throw new Error(`Google Drive upload failed (${response.status})`);
  return response.json();
};
