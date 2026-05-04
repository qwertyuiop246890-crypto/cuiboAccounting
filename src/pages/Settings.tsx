import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { collection, doc, setDoc, deleteDoc, updateDoc, getDocs, db, auth } from '../lib/local-db';
import { handleDatabaseError, OperationType } from '../lib/db-errors';
import { Plus, Trash2, CreditCard, ArrowUp, ArrowDown, Edit2, Check, X as CloseIcon, Download, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  buildBackupPayload,
  downloadDriveBackup,
  getBackupTotalCount,
  getLastCloudBackupAt,
  getLastLocalChangeAt,
  importBackupPayload,
  listDriveBackups,
  markCloudBackupAt,
  requestDriveAccessToken,
  uploadDriveBackup,
  type BackupPayload
} from '../lib/drive-backup';
import {
  clearStoredDriveAccessToken,
  getGoogleProjectLabel,
  getStoredDriveAccessToken,
  revokeDriveAccess
} from '../lib/drive-backup';
import { useDerivedAccounts } from '../hooks/useDerivedAccounts';

const T = {
  settings: '\u8a2d\u5b9a',
  backup: '\u8cc7\u6599\u5099\u4efd',
  backupHelp: '\u5099\u4efd\u5230 Google Drive \u7684 App \u5c08\u7528\u96b1\u85cf\u8cc7\u6599\u593e\uff0c\u6bcf\u6b21\u4e0a\u50b3\u90fd\u4fdd\u7559\u4e00\u4efd\u65b0\u7248\u672c\u3002',
  uploadCloud: '\u4e0a\u50b3\u5099\u4efd',
  downloadCloud: '\u4e0b\u8f09\u5099\u4efd',
  loginDrive: '\u767b\u5165 Google Drive',
  logoutDrive: '\u767b\u51fa Google Drive',
  driveProject: '\u7d81\u5b9a\u5c08\u6848',
  connected: '\u5df2\u9023\u7dda',
  disconnected: '\u672a\u9023\u7dda',
  exportJson: '\u624b\u52d5\u532f\u51fa',
  importJson: '\u624b\u52d5\u532f\u5165',
  importDone: '\u532f\u5165\u5b8c\u6210\uff0c\u9801\u9762\u5c07\u91cd\u65b0\u8f09\u5165\u3002',
  importFailed: '\u532f\u5165\u5931\u6557',
  exportFailed: '\u532f\u51fa\u5931\u6557',
  cloudMissingClient: '\u5c1a\u672a\u8a2d\u5b9a Google OAuth Client ID\u3002\u8acb\u5728 Vercel \u52a0\u5165 VITE_GOOGLE_CLIENT_ID\u3002',
  cloudUploadDone: '\u5df2\u4e0a\u50b3\u5230 Google Drive',
  cloudDownloadDone: '\u5df2\u5f9e Google Drive \u532f\u5165\u5099\u4efd',
  cloudFailed: 'Google Drive \u5099\u4efd\u5931\u6557',
  noCloudBackup: '\u627e\u4e0d\u5230 Google Drive \u5099\u4efd',
  backupPreview: '\u5099\u4efd\u5dee\u7570\u9810\u89bd',
  localData: '\u672c\u6a5f\u8cc7\u6599',
  cloudData: '\u96f2\u7aef\u5099\u4efd',
  confirmImport: '\u78ba\u8a8d\u532f\u5165',
  closePreview: '\u53d6\u6d88',
  receipts: '\u6536\u64da',
  items: '\u54c1\u9805',
  refunds: '\u9000\u7a05',
  transfersLabel: '\u63db\u532f',
  backupTime: '\u5099\u4efd\u6642\u9593',
  localChangeTime: '\u672c\u6a5f\u6700\u5f8c\u8b8a\u66f4',
  accounts: '\u5e33\u6236\u7ba1\u7406',
  accountName: '\u5e33\u6236\u540d\u7a31',
  accountNamePlaceholder: '\u4f8b\uff1aJCB \u4fe1\u7528\u5361\u3001\u65e5\u5e63\u73fe\u91d1',
  type: '\u985e\u578b',
  currency: '\u5e63\u5225',
  balance: '\u9918\u984d',
  addAccount: '\u65b0\u589e\u5e33\u6236',
  currentAccounts: '\u73fe\u6709\u5e33\u6236',
  noAccounts: '\u76ee\u524d\u9084\u6c92\u6709\u5e33\u6236',
  save: '\u5132\u5b58',
  cancel: '\u53d6\u6d88',
  added: '\u5e33\u6236\u5df2\u65b0\u589e',
  updated: '\u5e33\u6236\u5df2\u66f4\u65b0',
  deleted: '\u5e33\u6236\u5df2\u522a\u9664',
  failed: '\u64cd\u4f5c\u5931\u6557',
  confirmDelete: '\u78ba\u5b9a\u8981\u522a\u9664\u9019\u500b\u5e33\u6236\u55ce\uff1f\u5df2\u6709\u6536\u64da\u5f15\u7528\u7684\u5e33\u6236\u522a\u9664\u5f8c\u53ef\u80fd\u6703\u5f71\u97ff\u5c0d\u5e33\u3002',
  cashJpy: '\u65e5\u5e63\u73fe\u91d1',
  creditCard: '\u4fe1\u7528\u5361',
  icCard: '\u96fb\u5b50\u7968\u8b49',
  bank: '\u9280\u884c\u5e33\u6236'
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-TW');
};

const countRows = (data: BackupPayload) => [
  {label: T.accounts, value: data.counts.paymentAccounts},
  {label: T.receipts, value: data.counts.receipts},
  {label: T.items, value: data.counts.items},
  {label: T.refunds, value: data.counts.taxRefunds},
  {label: T.transfersLabel, value: data.counts.transfers}
];

export function Settings() {
  const accounts = useDerivedAccounts();
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState(T.cashJpy);
  const [newAccountCurrency, setNewAccountCurrency] = useState('JPY');
  const [newAccountBalance, setNewAccountBalance] = useState('');
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editAccountData, setEditAccountData] = useState({ name: '', type: '', currency: '', balance: '' });
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupPreview, setBackupPreview] = useState<{local: BackupPayload; cloud: BackupPayload; fileName: string} | null>(null);
  const [driveConnected, setDriveConnected] = useState(() => !!getStoredDriveAccessToken());
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || '';
  const googleProject = getGoogleProjectLabel(googleClientId);

  const existingTypes = Array.from(new Set([...accounts.map(a => a.type).filter(Boolean), T.cashJpy, T.creditCard, T.icCard, T.bank]));
  const existingCurrencies = Array.from(new Set([...accounts.map(a => a.currency).filter(Boolean), 'JPY', 'TWD', 'USD', 'KRW']));

  const buildCurrentBackup = async (): Promise<BackupPayload | null> => {
    if (!auth.currentUser) return;
    return buildBackupPayload(auth.currentUser.uid);
  };

  const handleExportData = async () => {
    if (!auth.currentUser) return;
    try {
      const data = await buildCurrentBackup();
      if (!data) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cui_bo_local_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Local data export failed', error);
      toast.error(T.exportFailed);
    }
  };

  const handleCloudUpload = async () => {
    if (!auth.currentUser || backupBusy) return;
    if (!googleClientId) {
      toast.error(T.cloudMissingClient);
      return;
    }

    setBackupBusy(true);
    try {
      const accessToken = await requestDriveAccessToken(googleClientId);
      setDriveConnected(true);
      const currentBackup = await buildBackupPayload(auth.currentUser.uid);
      const localCount = getBackupTotalCount(currentBackup.counts);
      const cloudFiles = await listDriveBackups(accessToken);

      if (localCount === 0 && cloudFiles.length > 0) {
        const latestCloud = await downloadDriveBackup(accessToken, cloudFiles[0].id);
        if (getBackupTotalCount(latestCloud.counts) > 0) {
          toast.error('\u672c\u6a5f\u662f\u7a7a\u767d\u8cc7\u6599\uff0c\u5df2\u963b\u64cb\u8986\u84cb Google Drive \u5099\u4efd\u3002');
          return;
        }
      }

      await uploadDriveBackup(accessToken, currentBackup);
      markCloudBackupAt(currentBackup.exportedAt);
      toast.success(T.cloudUploadDone);
    } catch (error) {
      console.error('Google Drive upload failed', error);
      toast.error(T.cloudFailed);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleCloudDownload = async () => {
    if (!auth.currentUser || backupBusy) return;
    if (!googleClientId) {
      toast.error(T.cloudMissingClient);
      return;
    }

    const lastLocalChange = getLastLocalChangeAt();
    const lastCloudBackup = getLastCloudBackupAt();
    if (lastLocalChange && (!lastCloudBackup || lastLocalChange > lastCloudBackup)) {
      const ok = window.confirm('\u672c\u6a5f\u6709\u5c1a\u672a\u4e0a\u50b3\u7684\u8b8a\u66f4\u3002\u76f4\u63a5\u4e0b\u8f09\u6703\u532f\u5165\u96f2\u7aef\u5099\u4efd\uff0c\u5efa\u8b70\u5148\u4e0a\u50b3\u3002\u4ecd\u8981\u7e7c\u7e8c\u55ce\uff1f');
      if (!ok) return;
    }

    setBackupBusy(true);
    try {
      const accessToken = await requestDriveAccessToken(googleClientId);
      setDriveConnected(true);
      const cloudFiles = await listDriveBackups(accessToken);
      if (cloudFiles.length === 0) {
        toast.error(T.noCloudBackup);
        return;
      }

      const latestBackup = await downloadDriveBackup(accessToken, cloudFiles[0].id);
      if (getBackupTotalCount(latestBackup.counts) === 0) {
        const ok = window.confirm('\u6700\u65b0 Google Drive \u5099\u4efd\u662f\u7a7a\u767d\u8cc7\u6599\u3002\u4ecd\u8981\u532f\u5165\u55ce\uff1f');
        if (!ok) return;
      }

      const localBackup = await buildBackupPayload(auth.currentUser.uid);
      setBackupPreview({
        local: localBackup,
        cloud: latestBackup,
        fileName: cloudFiles[0].name
      });
    } catch (error) {
      console.error('Google Drive download failed', error);
      toast.error(T.cloudFailed);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleConfirmCloudImport = async () => {
    if (!auth.currentUser || !backupPreview || backupBusy) return;

    setBackupBusy(true);
    try {
      await importBackupPayload(auth.currentUser.uid, backupPreview.cloud);
      markCloudBackupAt(backupPreview.cloud.exportedAt);
      toast.success(T.cloudDownloadDone);
      window.location.reload();
    } catch (error) {
      console.error('Google Drive import failed', error);
      toast.error(T.importFailed);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleDriveLogin = async () => {
    if (!googleClientId) {
      toast.error(T.cloudMissingClient);
      return;
    }

    try {
      await requestDriveAccessToken(googleClientId, 'consent');
      setDriveConnected(true);
      toast.success(T.connected);
    } catch (error) {
      console.error('Google Drive login failed', error);
      toast.error(T.cloudFailed);
    }
  };

  const handleDriveLogout = async () => {
    try {
      await revokeDriveAccess();
      clearStoredDriveAccessToken();
      setDriveConnected(false);
      toast.success(T.disconnected);
    } catch (error) {
      console.error('Google Drive logout failed', error);
      clearStoredDriveAccessToken();
      setDriveConnected(false);
    }
  };

  const handleImportData = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;
    const uid = auth.currentUser.uid;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);

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

        toast.success(T.importDone);
        window.location.reload();
      } catch (error) {
        console.error('Import failed', error);
        toast.error(T.importFailed);
      }
    };
    reader.readAsText(file);
  };

  const handleAddAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!newAccountName.trim() || !newAccountBalance || !auth.currentUser) return;

    const accountRef = doc(collection(db, `users/${auth.currentUser.uid}/paymentAccounts`));
    const maxOrder = accounts.length > 0 ? Math.max(...accounts.map(a => a.order || 0)) : -1;

    try {
      await setDoc(accountRef, {
        name: newAccountName.trim(),
        type: newAccountType.trim() || T.cashJpy,
        balance: Number(newAccountBalance),
        openingBalance: Number(newAccountBalance),
        balanceMode: 'derived',
        currency: newAccountCurrency.trim() || 'JPY',
        order: maxOrder + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      toast.success(T.added);
      setNewAccountName('');
      setNewAccountBalance('');
    } catch (error) {
      handleDatabaseError(error, OperationType.WRITE, `users/${auth.currentUser.uid}/paymentAccounts`);
      toast.error(T.failed);
    }
  };

  const handleStartEdit = (account: any) => {
    setEditingAccountId(account.id);
    setEditAccountData({
      name: account.name,
      type: account.type,
      currency: account.currency,
      balance: account.balance.toString()
    });
  };

  const handleSaveEdit = async () => {
    if (!auth.currentUser || !editingAccountId) return;
    try {
      await updateDoc(doc(db, `users/${auth.currentUser.uid}/paymentAccounts/${editingAccountId}`), {
        name: editAccountData.name,
        type: editAccountData.type,
        currency: editAccountData.currency,
        balance: Number(editAccountData.balance),
        openingBalance: Number(editAccountData.balance),
        balanceMode: 'derived',
        updatedAt: new Date().toISOString()
      });
      setEditingAccountId(null);
      toast.success(T.updated);
    } catch (error) {
      handleDatabaseError(error, OperationType.UPDATE, `users/${auth.currentUser.uid}/paymentAccounts/${editingAccountId}`);
      toast.error(T.failed);
    }
  };

  const handleMoveAccount = async (index: number, direction: 'up' | 'down') => {
    if (!auth.currentUser) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= accounts.length) return;

    const currentAccount = accounts[index];
    const targetAccount = accounts[targetIndex];
    try {
      await updateDoc(doc(db, `users/${auth.currentUser.uid}/paymentAccounts/${currentAccount.id}`), { order: targetAccount.order ?? targetIndex });
      await updateDoc(doc(db, `users/${auth.currentUser.uid}/paymentAccounts/${targetAccount.id}`), { order: currentAccount.order ?? index });
    } catch (error) {
      handleDatabaseError(error, OperationType.UPDATE, `users/${auth.currentUser.uid}/paymentAccounts`);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!auth.currentUser) return;
    if (!window.confirm(T.confirmDelete)) return;
    try {
      await deleteDoc(doc(db, `users/${auth.currentUser.uid}/paymentAccounts/${id}`));
      toast.success(T.deleted);
    } catch (error) {
      handleDatabaseError(error, OperationType.DELETE, `users/${auth.currentUser.uid}/paymentAccounts/${id}`);
      toast.error(T.failed);
    }
  };

  return (
    <div className="p-4 max-w-md mx-auto space-y-8 bg-background min-h-screen pb-24">
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-serif font-bold text-ink tracking-tight">{T.settings}</h1>
      </header>

      <section className="bg-card-white p-8 rounded-[40px] shadow-sm border border-divider">
        <h2 className="text-lg font-serif font-bold text-ink flex items-center gap-2 mb-6 uppercase tracking-widest">
          <Download className="w-5 h-5 text-primary-blue" />
          {T.backup}
        </h2>
        <p className="px-2 text-[12px] font-medium text-ink/60 leading-relaxed mb-4">{T.backupHelp}</p>
        <div className="mb-4 rounded-2xl border border-divider bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest">{T.driveProject}</p>
              <p className="mt-1 break-all text-xs font-bold text-ink">{googleProject.display || '-'}</p>
              <p className={`mt-2 text-[10px] font-black ${driveConnected ? 'text-green-600' : 'text-red-400'}`}>
                {driveConnected ? T.connected : T.disconnected}
              </p>
            </div>
            <button
              onClick={driveConnected ? handleDriveLogout : handleDriveLogin}
              className="shrink-0 rounded-xl bg-white px-3 py-2 text-[10px] font-black text-ink border border-divider"
            >
              {driveConnected ? T.logoutDrive : T.loginDrive}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <button onClick={handleCloudUpload} disabled={backupBusy} className="bg-primary-blue text-white p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all border border-primary-blue disabled:opacity-50">
            <Upload className="w-4 h-4" /> {T.uploadCloud}
          </button>
          <button onClick={handleCloudDownload} disabled={backupBusy} className="bg-ink text-white p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all border border-ink disabled:opacity-50">
            <Download className="w-4 h-4" /> {T.downloadCloud}
          </button>
        </div>
        {!googleClientId && <p className="px-2 text-[11px] font-bold text-red-400 leading-relaxed mb-4">{T.cloudMissingClient}</p>}
        {backupPreview && (
          <div className="mb-4 rounded-3xl border border-primary-blue/20 bg-primary-blue/5 p-4">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-sm font-black text-ink">{T.backupPreview}</p>
                <p className="text-[10px] font-bold text-ink/40 mt-1 break-all">{backupPreview.fileName}</p>
              </div>
              <button onClick={() => setBackupPreview(null)} className="text-[10px] font-bold text-ink/40 hover:text-ink">{T.closePreview}</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <BackupCountPanel title={T.localData} timeLabel={T.localChangeTime} time={getLastLocalChangeAt()} data={backupPreview.local} />
              <BackupCountPanel title={T.cloudData} timeLabel={T.backupTime} time={backupPreview.cloud.exportedAt} data={backupPreview.cloud} />
            </div>
            <button onClick={handleConfirmCloudImport} disabled={backupBusy} className="mt-4 w-full bg-ink text-white p-3 rounded-2xl font-bold disabled:opacity-50">
              {T.confirmImport}
            </button>
          </div>
        )}
        <div className="flex gap-4">
          <button onClick={handleExportData} className="flex-1 bg-background text-ink p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-divider transition-all border border-divider">
            <Download className="w-4 h-4" /> {T.exportJson}
          </button>
          <label className="flex-1 bg-background text-ink p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-divider transition-all cursor-pointer border border-divider">
            <Upload className="w-4 h-4" /> {T.importJson}
            <input type="file" accept=".json" onChange={handleImportData} className="hidden" />
          </label>
        </div>
      </section>

      <section className="bg-card-white p-8 rounded-[40px] shadow-sm border border-divider">
        <h2 className="text-lg font-serif font-bold text-ink flex items-center gap-2 mb-8 uppercase tracking-widest">
          <CreditCard className="w-5 h-5 text-primary-blue" />
          {T.accounts}
        </h2>

        <form onSubmit={handleAddAccount} className="space-y-4 mb-8">
          <TextInput label={T.accountName} value={newAccountName} onChange={setNewAccountName} placeholder={T.accountNamePlaceholder} required />

          <div className="grid grid-cols-2 gap-4">
            <TextInput label={T.type} value={newAccountType} onChange={setNewAccountType} list="account-types" />
            <TextInput label={T.currency} value={newAccountCurrency} onChange={setNewAccountCurrency} list="account-currencies" />
          </div>

          <datalist id="account-types">{existingTypes.map(type => <option key={type} value={type} />)}</datalist>
          <datalist id="account-currencies">{existingCurrencies.map(curr => <option key={curr} value={curr} />)}</datalist>

          <TextInput label={T.balance} value={newAccountBalance} onChange={setNewAccountBalance} type="number" placeholder="0" required />

          <button type="submit" className="w-full bg-primary-blue text-white font-bold p-4 rounded-2xl shadow-lg shadow-primary-blue/20 hover:bg-primary-blue/90 flex items-center justify-center gap-2 transition-all active:scale-95 uppercase tracking-widest text-xs">
            <Plus className="w-5 h-5" />
            {T.addAccount}
          </button>
        </form>

        <div className="space-y-4">
          <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest ml-4 mb-2">{T.currentAccounts}</p>
          {accounts.map((account, index) => (
            <div key={account.id} className="p-5 bg-background rounded-3xl border border-divider group transition-all hover:shadow-md">
              {editingAccountId === account.id ? (
                <div className="space-y-4">
                  <TextInput label={T.accountName} value={editAccountData.name} onChange={(value) => setEditAccountData({ ...editAccountData, name: value })} />
                  <div className="grid grid-cols-2 gap-3">
                    <TextInput label={T.type} value={editAccountData.type} onChange={(value) => setEditAccountData({ ...editAccountData, type: value })} list="account-types" />
                    <TextInput label={T.currency} value={editAccountData.currency} onChange={(value) => setEditAccountData({ ...editAccountData, currency: value })} list="account-currencies" />
                  </div>
                  <TextInput label={T.balance} value={editAccountData.balance} onChange={(value) => setEditAccountData({ ...editAccountData, balance: value })} type="number" />
                  <div className="flex gap-2 pt-2">
                    <button onClick={handleSaveEdit} className="flex-1 bg-primary-blue text-white font-bold py-2 rounded-xl flex items-center justify-center gap-1 text-xs">
                      <Check className="w-4 h-4" /> {T.save}
                    </button>
                    <button onClick={() => setEditingAccountId(null)} className="flex-1 bg-divider text-ink/60 font-bold py-2 rounded-xl flex items-center justify-center gap-1 text-xs">
                      <CloseIcon className="w-4 h-4" /> {T.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col gap-1">
                      <button onClick={() => handleMoveAccount(index, 'up')} disabled={index === 0} className="p-1 text-ink/20 hover:text-primary-blue disabled:opacity-0 transition-all"><ArrowUp className="w-4 h-4" /></button>
                      <button onClick={() => handleMoveAccount(index, 'down')} disabled={index === accounts.length - 1} className="p-1 text-ink/20 hover:text-primary-blue disabled:opacity-0 transition-all"><ArrowDown className="w-4 h-4" /></button>
                    </div>
                    <div>
                      <p className="font-serif font-bold text-ink text-lg">{account.name}</p>
                      <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-ink/40 mt-1">
                        <span className="bg-divider px-2 py-0.5 rounded-full text-ink/60">{account.type}</span>
                        <span className="text-primary-blue">{account.currency || 'JPY'} {account.balance.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleStartEdit(account)} className="p-2 text-ink/20 hover:text-primary-blue hover:bg-primary-blue/5 rounded-xl transition-all"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleDeleteAccount(account.id)} className="p-2 text-ink/20 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {accounts.length === 0 && <div className="text-center py-8 text-ink/30 text-sm font-medium">{T.noAccounts}</div>}
        </div>
      </section>
    </div>
  );
}

function BackupCountPanel({
  title,
  timeLabel,
  time,
  data
}: {
  title: string;
  timeLabel: string;
  time?: string;
  data: BackupPayload;
}) {
  return (
    <div className="rounded-2xl bg-white/80 p-3 border border-divider">
      <p className="text-xs font-black text-ink">{title}</p>
      <p className="text-[9px] font-bold text-ink/35 mt-1">{timeLabel}</p>
      <p className="text-[10px] font-bold text-primary-blue mb-3">{formatDateTime(time)}</p>
      <div className="space-y-1">
        {countRows(data).map(row => (
          <div key={row.label} className="flex justify-between text-[10px] font-bold text-ink/60">
            <span>{row.label}</span>
            <span>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  list
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  list?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold text-ink/40 uppercase tracking-widest ml-4">{label}</label>
      <input
        type={type}
        list={list}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue/20 outline-none text-ink font-medium"
      />
    </div>
  );
}
