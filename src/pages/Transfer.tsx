import { useState, useEffect, useMemo } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { collection, doc, setDoc, updateDoc, increment, onSnapshot, db, auth } from '../lib/local-db';
import { handleDatabaseError, OperationType } from '../lib/db-errors';
import { ArrowRightLeft, ArrowDown, ArrowUp, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const T = {
  title: '\u63db\u532f\u7d00\u9304',
  subtitle: '\u8a18\u9304\u7528\u54ea\u5f35\u5361\u6216\u54ea\u500b\u5e33\u6236\u63db\u5230\u591a\u5c11\u5916\u5e63',
  paidAmount: '\u4ed8\u6b3e\u91d1\u984d',
  receivedAmount: '\u53d6\u5f97\u91d1\u984d',
  sourceAccount: '\u4ed8\u6b3e\u5e33\u6236',
  targetAccount: '\u53d6\u5f97\u5e33\u6236',
  selectSource: '\u9078\u64c7\u4ed8\u6b3e\u5e33\u6236',
  selectTarget: '\u9078\u64c7\u53d6\u5f97\u5e33\u6236',
  rate: '\u532f\u7387',
  note: '\u5099\u8a3b',
  notePlaceholder: '\u4f8b\uff1a\u7528\u54ea\u5f35\u5361\u3001\u624b\u7e8c\u8cbb\u3001\u63db\u532f\u5730\u9ede',
  save: '\u5132\u5b58\u63db\u532f',
  saved: '\u63db\u532f\u7d00\u9304\u5df2\u5132\u5b58',
  failed: '\u63db\u532f\u5132\u5b58\u5931\u6557',
  needAccounts: '\u8acb\u5148\u5230\u8a2d\u5b9a\u5efa\u7acb\u81f3\u5c11\u5169\u500b\u5e33\u6236'
};

export function Transfer() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [sourceAmount, setSourceAmount] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = collection(db, `users/${auth.currentUser.uid}/paymentAccounts`);
    const unsubscribe = onSnapshot(q, (snapshot: any) => {
      const accountsData = snapshot.docs.map((accountDoc: any) => ({ id: accountDoc.id, ...accountDoc.data() }));
      const sortedAccounts = accountsData.sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
      setAccounts(sortedAccounts);
    });

    return () => unsubscribe();
  }, []);

  const fromAcc = accounts.find(a => a.id === fromAccount);
  const toAcc = accounts.find(a => a.id === toAccount);
  const sourceCurrency = fromAcc?.currency || '';
  const targetCurrency = toAcc?.currency || '';

  const exchangeRate = useMemo(() => {
    const source = Number(sourceAmount);
    const target = Number(targetAmount);
    if (!source || !target) return '';
    return (source / target).toFixed(4);
  }, [sourceAmount, targetAmount]);

  const handleTransfer = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !sourceAmount || !targetAmount || !fromAccount || !toAccount || fromAccount === toAccount) return;

    setLoading(true);
    try {
      const paid = Number(sourceAmount);
      const received = Number(targetAmount);
      const transferRef = doc(collection(db, `users/${auth.currentUser.uid}/transfers`));

      await setDoc(transferRef, {
        date: new Date().toISOString(),
        amount: received,
        sourceAmount: paid,
        targetAmount: received,
        sourceCurrency: sourceCurrency || fromAcc?.currency || 'TWD',
        targetCurrency: targetCurrency || toAcc?.currency || 'JPY',
        currency: targetCurrency || toAcc?.currency || 'JPY',
        exchangeRate: paid && received ? paid / received : null,
        fromAccountId: fromAccount,
        toAccountId: toAccount,
        notes,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await updateDoc(doc(db, `users/${auth.currentUser.uid}/paymentAccounts/${fromAccount}`), {
        balance: increment(-paid),
        updatedAt: new Date().toISOString()
      });
      await updateDoc(doc(db, `users/${auth.currentUser.uid}/paymentAccounts/${toAccount}`), {
        balance: increment(received),
        updatedAt: new Date().toISOString()
      });

      toast.success(T.saved);
      navigate('/');
    } catch (error) {
      console.error('Error saving exchange:', error);
      handleDatabaseError(error, OperationType.WRITE, `users/${auth.currentUser.uid}/transfers`);
      toast.error(T.failed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-md mx-auto bg-background min-h-screen pb-24">
      <header className="mb-8">
        <h1 className="text-2xl font-serif font-bold text-ink flex items-center gap-2 tracking-tight">
          <ArrowRightLeft className="w-6 h-6 text-primary-blue" />
          {T.title}
        </h1>
        <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest mt-2 ml-8">{T.subtitle}</p>
      </header>

      {accounts.length < 2 ? (
        <div className="bg-card-white p-8 rounded-[40px] shadow-sm border border-divider text-center text-ink/50 text-sm font-bold">
          {T.needAccounts}
        </div>
      ) : (
        <form onSubmit={handleTransfer} className="space-y-6">
          <div className="bg-card-white p-8 rounded-[40px] shadow-sm border border-divider space-y-8">
            <div className="grid grid-cols-1 gap-5">
              <AccountSelect
                label={T.sourceAccount}
                icon={<ArrowUp className="w-3 h-3 text-red-400" />}
                value={fromAccount}
                onChange={setFromAccount}
                accounts={accounts}
                disabledAccountId={toAccount}
                placeholder={T.selectSource}
              />

              <AmountInput
                label={T.paidAmount}
                currency={sourceCurrency || '---'}
                value={sourceAmount}
                onChange={setSourceAmount}
              />

              <AccountSelect
                label={T.targetAccount}
                icon={<ArrowDown className="w-3 h-3 text-green-400" />}
                value={toAccount}
                onChange={setToAccount}
                accounts={accounts}
                disabledAccountId={fromAccount}
                placeholder={T.selectTarget}
              />

              <AmountInput
                label={T.receivedAmount}
                currency={targetCurrency || '---'}
                value={targetAmount}
                onChange={setTargetAmount}
              />
            </div>

            <div className="bg-background border border-divider rounded-3xl p-5 flex items-center justify-between">
              <span className="text-[10px] font-bold text-ink/40 uppercase tracking-widest">{T.rate}</span>
              <span className="font-serif font-bold text-ink text-xl">{exchangeRate || '-'}</span>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-ink/40 uppercase tracking-widest ml-4">{T.note}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-5 bg-background border border-divider rounded-[24px] focus:ring-4 focus:ring-primary-blue/10 outline-none text-ink font-medium min-h-[100px] resize-none"
                placeholder={T.notePlaceholder}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !sourceAmount || !targetAmount || !fromAccount || !toAccount || fromAccount === toAccount}
              className="w-full bg-primary-blue text-white font-bold p-5 rounded-3xl shadow-lg shadow-primary-blue/20 hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"
            >
              <Save className="w-5 h-5" />
              {T.save}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function AccountSelect({
  label,
  icon,
  value,
  onChange,
  accounts,
  disabledAccountId,
  placeholder
}: {
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  accounts: any[];
  disabledAccountId?: string;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-bold text-ink/40 uppercase tracking-widest ml-4 flex items-center gap-1">
        {icon} {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full p-5 bg-background border border-divider rounded-[24px] focus:ring-4 focus:ring-primary-blue/10 outline-none appearance-none text-ink font-bold tracking-tight"
          required
        >
          <option value="" disabled>{placeholder}</option>
          {accounts.map(acc => (
            <option key={acc.id} value={acc.id} disabled={acc.id === disabledAccountId}>
              {acc.name} ({acc.currency} {acc.balance.toLocaleString()})
            </option>
          ))}
        </select>
        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-ink/20">
          <ArrowDown className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}

function AmountInput({ label, currency, value, onChange }: { label: string; currency: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-bold text-ink/40 uppercase tracking-widest ml-4">{label} ({currency})</label>
      <div className="relative">
        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-ink/20 font-serif text-2xl">{currency}</span>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-20 pr-6 py-6 bg-background border border-divider rounded-[24px] text-4xl font-serif font-bold text-ink focus:ring-4 focus:ring-primary-blue/10 outline-none transition-all"
          placeholder="0"
          required
        />
      </div>
    </div>
  );
}
