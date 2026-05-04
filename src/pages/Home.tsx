import { useState, useEffect, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { collection, onSnapshot, doc, deleteDoc, getDocs, db, auth } from '../lib/local-db';
import { format } from 'date-fns';
import { Camera, Receipt as ReceiptIcon, CreditCard, Trash2, Landmark, X, ArrowRightLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Modal } from '../components/ui/Modal';
import { normalizeDate } from '../lib/utils';
import { buildSplitSummary, formatCurrencyAmount } from '../lib/expense-groups';
import toast from 'react-hot-toast';

const T = {
  unnamedAccount: '\u672a\u547d\u540d\u5e33\u6236',
  unknownAccount: '\u672a\u6307\u5b9a\u5e33\u6236',
  sourceAccount: '\u4f86\u6e90\u5e33\u6236',
  targetAccount: '\u76ee\u6a19\u5e33\u6236',
  deleteTitle: '\u522a\u9664\u7d00\u9304',
  deleteMessage: '\u522a\u9664\u5f8c\u6703\u540c\u6b65\u56de\u88dc\u6216\u6263\u56de\u5e33\u6236\u9918\u984d\uff0c\u78ba\u5b9a\u8981\u522a\u9664\u9019\u7b46\u7d00\u9304\u55ce\uff1f',
  deleted: '\u5df2\u522a\u9664',
  deleteFailed: '\u522a\u9664\u5931\u6557',
  deleteFailedMessage: '\u8acb\u78ba\u8a8d\u5e33\u6236\u8207\u660e\u7d30\u8cc7\u6599\u662f\u5426\u4ecd\u5b58\u5728\uff0c\u518d\u91cd\u8a66\u4e00\u6b21\u3002',
  appSubtitle: '\u6536\u64da\u6210\u672c\u7d00\u9304',
  accountGlyph: '\u5e33',
  addReceipt: '\u65b0\u589e\u6536\u64da',
  taxRefund: '\u9000\u7a05\u5165\u5e33',
  exchangeRecord: '\u63db\u532f\u7d00\u9304',
  receiptRecords: '\u6536\u64da\u7d00\u9304',
  sort: '\u6392\u5e8f',
  newest: '\u65b0\u5230\u820a',
  oldest: '\u820a\u5230\u65b0',
  date: '\u65e5\u671f',
  loading: '\u8f09\u5165\u4e2d...',
  noRecords: '\u76ee\u524d\u6c92\u6709\u7d00\u9304',
  refund: '\u9000\u7a05',
  exchange: '\u63db\u532f',
  receipt: '\u6536\u64da',
  unnamedReceipt: '\u672a\u547d\u540d\u6536\u64da'
};

export function Home() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>(() => {
    return (localStorage.getItem('cuibo_sort_order') as 'desc' | 'asc') || 'desc';
  });
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'confirm';
    onConfirm?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem('cuibo_sort_order', sortOrder);
  }, [sortOrder]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const fetchData = async () => {
      const uid = auth.currentUser!.uid;
      try {
        const [accountsSnap, receiptsSnap, refundsSnap, transfersSnap] = await Promise.all([
          getDocs(collection(db, `users/${uid}/paymentAccounts`)),
          getDocs(collection(db, `users/${uid}/receipts`)),
          getDocs(collection(db, `users/${uid}/taxRefunds`)),
          getDocs(collection(db, `users/${uid}/transfers`))
        ]);

        const accountNames = new Map<string, string>();
        accountsSnap.docs.forEach((accountDoc: any) => {
          const data = accountDoc.data();
          accountNames.set(accountDoc.id, data.name || T.unnamedAccount);
        });

        const receipts = await Promise.all(receiptsSnap.docs.map(async (receiptDoc: any) => {
          const data = receiptDoc.data();
          let items: any[] = [];
          try {
            const itemSnap = await getDocs(collection(db, `users/${uid}/receipts/${receiptDoc.id}/items`));
            items = itemSnap.docs.map((d: any) => d.data());
          } catch {
            items = [];
          }

          return {
            id: receiptDoc.id,
            _type: 'receipt',
            ...data,
            _items: items,
            paymentName: data.paymentAccountId ? (accountNames.get(data.paymentAccountId) || T.unknownAccount) : T.unknownAccount
          };
        }));

        const refunds = refundsSnap.docs.map((refundDoc: any) => {
          const data = refundDoc.data();
          return {
            id: refundDoc.id,
            _type: 'taxRefund',
            ...data,
            paymentName: data.paymentAccountId ? (accountNames.get(data.paymentAccountId) || T.unknownAccount) : T.unknownAccount
          };
        });

        const transfers = transfersSnap.docs.map((transferDoc: any) => {
          const data = transferDoc.data();
          const fromName = accountNames.get(data.fromAccountId) || T.sourceAccount;
          const toName = accountNames.get(data.toAccountId) || T.targetAccount;
          return {
            id: transferDoc.id,
            _type: 'transfer',
            ...data,
            paymentName: `${fromName} -> ${toName}`
          };
        });

        setRecords([...receipts, ...refunds, ...transfers]);
      } catch (error) {
        console.error('Fetch failed:', error);
      } finally {
        setLoading(false);
      }
    };

    const unsubReceipts = onSnapshot(collection(db, `users/${auth.currentUser.uid}/receipts`), fetchData);
    const unsubRefunds = onSnapshot(collection(db, `users/${auth.currentUser.uid}/taxRefunds`), fetchData);
    const unsubTransfers = onSnapshot(collection(db, `users/${auth.currentUser.uid}/transfers`), fetchData);
    const unsubAccounts = onSnapshot(collection(db, `users/${auth.currentUser.uid}/paymentAccounts`), fetchData);
    const unsubItems = onSnapshot(collection(db, 'items'), fetchData);

    return () => {
      unsubReceipts();
      unsubRefunds();
      unsubTransfers();
      unsubAccounts();
      unsubItems();
    };
  }, []);

  const handleDelete = async (e: MouseEvent, record: any) => {
    e.preventDefault();
    e.stopPropagation();

    if (!auth.currentUser) return;

    setModalConfig({
      isOpen: true,
      title: T.deleteTitle,
      message: T.deleteMessage,
      type: 'confirm',
      onConfirm: async () => {
        const uid = auth.currentUser!.uid;
        try {
          if (record._type === 'taxRefund') {
            await deleteDoc(doc(db, `users/${uid}/taxRefunds/${record.id}`));
          } else if (record._type === 'transfer') {
            await deleteDoc(doc(db, `users/${uid}/transfers/${record.id}`));
          } else {
            const itemsRef = collection(db, `users/${uid}/receipts/${record.id}/items`);
            const itemsSnap = await getDocs(itemsRef).catch(() => ({ docs: [] }));
            for (const itemDoc of itemsSnap.docs) {
              await deleteDoc(doc(db, `users/${uid}/receipts/${record.id}/items/${itemDoc.id}`));
            }
            await deleteDoc(doc(db, `users/${uid}/receipts/${record.id}`));
          }

          setModalConfig(prev => ({ ...prev, isOpen: false }));
          toast.success(T.deleted);
        } catch (error) {
          console.error('Error deleting record:', error);
          toast.error(T.deleteFailed);
          setModalConfig({
            isOpen: true,
            title: T.deleteFailed,
            message: T.deleteFailedMessage,
            type: 'error'
          });
        }
      }
    });
  };

  const filteredRecords = useMemo(() => {
    let result = [...records];
    if (selectedDate) {
      result = result.filter(record => normalizeDate(record.date || '').startsWith(selectedDate));
    }

    return result.sort((a, b) => {
      const dateA = normalizeDate(a.date || '');
      const dateB = normalizeDate(b.date || '');
      const timeA = new Date(dateA).getTime();
      const timeB = new Date(dateB).getTime();

      if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      }

      return sortOrder === 'desc' ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
    });
  }, [records, selectedDate, sortOrder]);

  return (
    <div className="p-4 max-w-md mx-auto pb-24 bg-background min-h-screen">
      <header className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-[28px] overflow-hidden border-[6px] border-white shadow-sm">
            <img src="/logo.png" alt="Cui Bo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div>
            <h1 className="text-[28px] font-serif font-bold text-ink leading-tight">Cui Bo</h1>
            <p className="text-[12px] font-bold text-ink/40 tracking-widest mt-0.5">{T.appSubtitle}</p>
          </div>
        </div>
        <div className="w-12 h-12 rounded-full bg-accent-orange shadow-lg border-[3px] border-white flex items-center justify-center font-black text-white text-lg">
          {T.accountGlyph}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <button
          onClick={() => navigate('/receipt/new')}
          className="col-span-2 bg-button-blue text-white rounded-[32px] p-10 flex flex-col items-center justify-center gap-4 shadow-sm active:scale-[0.98] transition-all"
        >
          <div className="bg-white/30 p-4 rounded-[22px] backdrop-blur-sm shadow-sm">
            <Camera className="w-9 h-9" />
          </div>
          <span className="text-xl font-bold tracking-widest">{T.addReceipt}</span>
        </button>

        <button
          onClick={() => navigate('/tax-refund')}
          className="bg-card-white text-ink rounded-[32px] p-6 flex flex-col items-center justify-center gap-3 shadow-sm border border-divider/40 active:scale-95 transition-all"
        >
          <div className="bg-soft-blue p-4 rounded-full">
            <Landmark className="w-6 h-6 text-primary-blue" />
          </div>
          <span className="text-sm font-bold text-ink/70">{T.taxRefund}</span>
        </button>

        <button
          onClick={() => navigate('/transfer')}
          className="bg-card-white text-ink rounded-[32px] p-6 flex flex-col items-center justify-center gap-3 shadow-sm border border-divider/40 active:scale-95 transition-all"
        >
          <div className="bg-soft-blue p-4 rounded-full">
            <ArrowRightLeft className="w-6 h-6 text-primary-blue" />
          </div>
          <span className="text-sm font-bold text-ink/70">{T.exchangeRecord}</span>
        </button>
      </div>

      <div className="space-y-4">
        <div className="bg-white p-4 rounded-3xl border border-divider/40 shadow-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ReceiptIcon className="w-5 h-5 text-ink/40" />
            <h2 className="text-sm font-bold text-ink tracking-widest whitespace-nowrap">{T.receiptRecords}</h2>
          </div>

          <div className="flex items-center gap-2 flex-1">
            <div className="flex-1 bg-[#F4EDE3] rounded-2xl flex items-center px-4 py-2 relative">
              <span className="text-[10px] font-bold text-ink/30 mr-2 uppercase">{T.sort}</span>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
                className="w-full text-xs font-bold border-none bg-transparent outline-none text-ink/70 cursor-pointer"
              >
                <option value="desc">{T.newest}</option>
                <option value="asc">{T.oldest}</option>
              </select>
            </div>

            <div className="flex-1 bg-[#F4EDE3] rounded-2xl flex items-center px-4 py-2 relative">
              <span className="text-[10px] font-bold text-ink/30 mr-2 uppercase">{T.date}</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full text-xs border-none bg-transparent outline-none font-bold text-ink cursor-pointer"
              />
              {selectedDate && (
                <button onClick={() => setSelectedDate('')} className="absolute right-2 text-ink/30 hover:text-red-500">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-ink/50 animate-pulse font-medium">{T.loading}</div>
        ) : filteredRecords.length === 0 ? (
          <div className="text-center py-16 bg-transparent rounded-[32px] border-2 border-dashed border-ink/10">
            <ReceiptIcon className="w-16 h-16 text-ink/10 mx-auto mb-4" />
            <p className="text-ink text-lg font-bold">{T.noRecords}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRecords.map((record) => (
              <div key={`${record._type}-${record.id}`}>
                <RecordCard record={record} onDelete={handleDelete} />
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={modalConfig.isOpen}
        onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
        onConfirm={modalConfig.onConfirm}
        title={modalConfig.title}
        message={modalConfig.message}
        type={modalConfig.type}
      />
    </div>
  );
}

function RecordCard({ record, onDelete }: { record: any; onDelete: (event: MouseEvent, record: any) => void }) {
  const isTransfer = record._type === 'transfer';
  const isRefund = record._type === 'taxRefund';
  const isReceipt = record._type === 'receipt';
  const linkTo = isTransfer ? '#' : isRefund ? `/tax-refund/${record.id}` : `/receipt/${record.id}`;
  const amount = Number(record.amount ?? record.totalAmount ?? 0);
  const currency = record.currency || 'JPY';
  const splitSummary = isReceipt ? buildSplitSummary(record, record._items || []) : [];
  const normalizedDate = normalizeDate(record.date || '');

  return (
    <Link
      to={linkTo}
      onClick={(e) => { if (isTransfer) e.preventDefault(); }}
      className="block bg-card-white p-4 rounded-3xl shadow-sm border border-divider hover:border-primary-blue/50 transition-all group relative active:scale-[0.98]"
    >
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-4 min-w-0">
          {record.photoUrl ? (
            <img src={record.photoUrl || undefined} alt="\u6536\u64da\u7167\u7247" className="w-14 h-14 rounded-2xl object-cover shadow-sm flex-shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-background flex items-center justify-center flex-shrink-0">
              {isRefund ? (
                <Landmark className="w-6 h-6 text-ink/30" />
              ) : isTransfer ? (
                <ArrowRightLeft className="w-6 h-6 text-ink/30" />
              ) : (
                <ReceiptIcon className="w-6 h-6 text-ink/30" />
              )}
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                isRefund ? 'bg-[#A3B18A]/20 text-[#6B7558]' : isTransfer ? 'bg-primary-blue/20 text-primary-blue' : 'bg-[#E5D3C5] text-[#957E6B]'
              }`}>
                {isRefund ? T.refund : isTransfer ? T.exchange : (record.category || T.receipt)}
              </div>
              <span className="text-[10px] font-bold text-ink/40 uppercase tracking-widest">
                {formatDisplayDate(normalizedDate)}
              </span>
            </div>

            <p className="font-bold text-ink text-sm mb-1 truncate max-w-[180px]">
              {record.translatedStoreName || record.storeName || record.notes || (isRefund ? T.taxRefund : isTransfer ? T.exchangeRecord : T.unnamedReceipt)}
            </p>
            {isReceipt && record.translatedStoreName && record.storeName && (
              <p className="text-[10px] font-bold text-ink/35 mb-1 truncate max-w-[180px]">{record.storeName}</p>
            )}

            <div className="flex items-center gap-1 text-xs text-ink/70 font-medium mb-2">
              <CreditCard className="w-3 h-3 text-ink/30" />
              <span className="truncate max-w-[150px]">{record.paymentName}</span>
            </div>

            {splitSummary.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {splitSummary.slice(0, 3).map(row => (
                  <span key={row.owner} className="text-[10px] font-bold text-ink/55 bg-background px-2 py-1 rounded-full">
                    {row.owner} {formatCurrencyAmount(row.currency, row.net)}
                  </span>
                ))}
                {splitSummary.length > 3 && (
                  <span className="text-[10px] font-bold text-ink/35 bg-background px-2 py-1 rounded-full">+{splitSummary.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`font-serif font-bold text-xl ${isRefund || isTransfer ? 'text-[#6B7558]' : 'text-ink'}`}>
            {isRefund || isTransfer ? '+' : ''}{currency} {amount.toLocaleString()}
          </span>
          <button onClick={(e) => onDelete(e, record)} className="p-2 text-ink/20 hover:text-red-400 transition-colors z-10">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </Link>
  );
}

function formatDisplayDate(value: string) {
  if (!value) return '';
  try {
    return format(new Date(value), 'MM/dd HH:mm');
  } catch {
    return value;
  }
}
