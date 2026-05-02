import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { collection, onSnapshot, getDocs, db, auth } from '../lib/local-db';
import { handleDatabaseError, OperationType } from '../lib/db-errors';
import { format, subDays, isWithinInterval, startOfDay, endOfDay, parseISO } from 'date-fns';
import { Calendar, Filter, PieChart as PieChartIcon, AlignLeft, Users, WalletCards } from 'lucide-react';
import { normalizeDate } from '../lib/utils';
import { buildSplitSummary, formatCurrencyAmount, normalizeGroupName } from '../lib/expense-groups';

const T = {
  all: '\u5168\u90e8',
  statsTitle: '\u6210\u672c\u7d71\u8a08',
  dateRange: '\u65e5\u671f\u7bc4\u570d',
  allDates: '\u5168\u90e8\u65e5\u671f',
  to: '\u5230',
  paidCost: '\u6536\u64da\u5be6\u4ed8\u6210\u672c',
  receiptUnit: '\u5f35\u6536\u64da',
  discount: '\u6298\u6263',
  receiptTaxRefund: '\u6536\u64da\u9000\u7a05',
  byOwner: '\u4f9d\u6700\u7d42\u6b78\u5c6c',
  byDefaultGroup: '\u4f9d\u6536\u64da\u5927\u6b78\u985e',
  byAccount: '\u4f9d\u4ed8\u6b3e\u5e33\u6236',
  refundRecords: '\u9000\u7a05\u5165\u5e33\u7d00\u9304',
  refundIncome: '\u9000\u7a05\u5165\u5e33',
  noData: '\u76ee\u524d\u6c92\u6709\u8cc7\u6599',
  unknownAccount: '\u672a\u6307\u5b9a\u5e33\u6236'
};

interface ListRow {
  name: string;
  values: { curr: string; val: number }[];
}

export function Dashboard() {
  const [records, setRecords] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [startDate, setStartDate] = useState<string>(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [showAllDates, setShowAllDates] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string>(T.all);
  const [itemsMap, setItemsMap] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (!auth.currentUser) return;

    try {
      const unsubReceipts = onSnapshot(collection(db, `users/${auth.currentUser.uid}/receipts`), (snap: any) => {
        const data = snap.docs.map((d: any) => ({ id: d.id, _type: 'receipt', ...d.data() }));
        setRecords(prev => [...prev.filter(r => r._type !== 'receipt'), ...data]);
      });

      const unsubRefunds = onSnapshot(collection(db, `users/${auth.currentUser.uid}/taxRefunds`), (snap: any) => {
        const data = snap.docs.map((d: any) => ({ id: d.id, _type: 'taxRefund', ...d.data() }));
        setRecords(prev => [...prev.filter(r => r._type !== 'taxRefund'), ...data]);
      });

      const unsubAccounts = onSnapshot(collection(db, `users/${auth.currentUser.uid}/paymentAccounts`), (snap: any) => {
        setAccounts(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      });

      return () => {
        unsubReceipts();
        unsubRefunds();
        unsubAccounts();
      };
    } catch (error) {
      handleDatabaseError(error, OperationType.GET, `users/${auth.currentUser.uid}/dashboard`);
    }
  }, []);

  const filteredRecords = useMemo(() => {
    if (showAllDates) return records;

    const start = startOfDay(new Date(startDate));
    const end = endOfDay(new Date(endDate));
    return records.filter(record => {
      if (!record.date) return false;
      try {
        return isWithinInterval(parseISO(normalizeDate(record.date)), { start, end });
      } catch {
        return false;
      }
    });
  }, [records, startDate, endDate, showAllDates]);

  const recordKey = useMemo(() => filteredRecords.map(r => `${r._type}:${r.id}`).join('|'), [filteredRecords]);

  useEffect(() => {
    if (!auth.currentUser) return;
    const receiptIds = filteredRecords.filter(r => r._type === 'receipt').map(r => r.id);
    if (receiptIds.length === 0) {
      setItemsMap({});
      return;
    }

    let cancelled = false;
    const fetchItems = async () => {
      const next: Record<string, any[]> = {};
      for (const receiptId of receiptIds) {
        try {
          const snap = await getDocs(collection(db, `users/${auth.currentUser!.uid}/receipts/${receiptId}/items`));
          next[receiptId] = snap.docs.map((d: any) => d.data());
        } catch {
          next[receiptId] = [];
        }
      }
      if (!cancelled) setItemsMap(next);
    };

    fetchItems();
    const unsubscribe = onSnapshot(collection(db, 'items'), fetchItems);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [recordKey]);

  const stats = useMemo(() => {
    const curStats: Record<string, {
      receiptCount: number;
      totalCost: number;
      totalDiscount: number;
      receiptTaxRefund: number;
      refundIncome: number;
      ownerTotals: Record<string, number>;
      defaultTotals: Record<string, number>;
      paymentUsage: Record<string, number>;
    }> = {};

    const ensure = (currency: string) => {
      if (!curStats[currency]) {
        curStats[currency] = {
          receiptCount: 0,
          totalCost: 0,
          totalDiscount: 0,
          receiptTaxRefund: 0,
          refundIncome: 0,
          ownerTotals: {},
          defaultTotals: {},
          paymentUsage: {}
        };
      }
      return curStats[currency];
    };

    filteredRecords.forEach(record => {
      const currency = record.currency || 'JPY';
      const st = ensure(currency);

      if (record._type === 'taxRefund') {
        st.refundIncome += Number(record.amount) || 0;
        return;
      }

      if (record._type !== 'receipt') return;

      st.receiptCount += 1;
      st.totalCost += Number(record.totalAmount) || 0;
      st.totalDiscount += Number(record.totalDiscount) || 0;
      st.receiptTaxRefund += Number(record.totalTaxRefund) || 0;

      buildSplitSummary(record, itemsMap[record.id] || []).forEach(row => {
        st.ownerTotals[row.owner] = (st.ownerTotals[row.owner] || 0) + row.net;
      });

      const defaultGroup = normalizeGroupName(record.category || record.subCategory);
      st.defaultTotals[defaultGroup] = (st.defaultTotals[defaultGroup] || 0) + (Number(record.totalAmount) || 0);

      const acc = accounts.find(a => a.id === record.paymentAccountId);
      const accName = acc?.name || T.unknownAccount;
      st.paymentUsage[accName] = (st.paymentUsage[accName] || 0) + (Number(record.totalAmount) || 0);
    });

    return curStats;
  }, [filteredRecords, accounts, itemsMap]);

  const availableCurrencies = useMemo(() => Object.keys(stats), [stats]);

  useEffect(() => {
    if (selectedCurrency !== T.all && availableCurrencies.length > 0 && !availableCurrencies.includes(selectedCurrency)) {
      setSelectedCurrency(T.all);
    }
  }, [availableCurrencies, selectedCurrency]);

  const currenciesToDisplay = selectedCurrency === T.all ? availableCurrencies : [selectedCurrency];

  const buildListData = (key: 'ownerTotals' | 'defaultTotals' | 'paymentUsage'): ListRow[] => {
    const names = new Set<string>();
    currenciesToDisplay.forEach(currency => {
      const st = stats[currency];
      if (st) Object.keys(st[key]).forEach(name => names.add(name));
    });

    return Array.from(names).map(name => {
      const values = currenciesToDisplay
        .map(curr => ({ curr, val: stats[curr]?.[key][name] || 0 }))
        .filter(item => item.val !== 0);
      return { name, values };
    }).filter(item => item.values.length > 0)
      .sort((a, b) => b.values.reduce((sum, v) => sum + Math.abs(v.val), 0) - a.values.reduce((sum, v) => sum + Math.abs(v.val), 0));
  };

  const totalByCurrency = currenciesToDisplay.map(currency => ({
    currency,
    total: stats[currency]?.totalCost || 0,
    receiptCount: stats[currency]?.receiptCount || 0,
    discount: stats[currency]?.totalDiscount || 0,
    taxRefund: stats[currency]?.receiptTaxRefund || 0,
    refundIncome: stats[currency]?.refundIncome || 0
  }));

  return (
    <div className="p-4 max-w-md mx-auto space-y-6 bg-background min-h-screen pb-24">
      <header className="flex flex-col gap-4 mb-6">
        <h1 className="text-2xl font-serif font-bold text-ink tracking-tight">{T.statsTitle}</h1>

        <div className="flex flex-col gap-3 bg-card-white p-4 rounded-3xl shadow-sm border border-divider">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-ink/40 flex-shrink-0" />
              <span className="text-[10px] font-bold text-ink/40 uppercase tracking-widest">{T.dateRange}</span>
            </div>
            <button
              onClick={() => setShowAllDates(!showAllDates)}
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all ${showAllDates ? 'bg-primary-blue text-white' : 'bg-background text-ink/40 border border-divider'}`}
            >
              {T.allDates}
            </button>
          </div>

          {!showAllDates && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-ink/40 uppercase tracking-widest whitespace-nowrap overflow-x-auto pb-1">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-background rounded-lg p-1.5 px-2 outline-none focus:ring-2 focus:ring-primary-blue font-bold text-ink"
              />
              <span>{T.to}</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-background rounded-lg p-1.5 px-2 outline-none focus:ring-2 focus:ring-primary-blue font-bold text-ink"
              />
            </div>
          )}
        </div>

        {availableCurrencies.length > 0 && (
          <div className="flex items-center gap-2 bg-card-white p-4 rounded-3xl shadow-sm border border-divider overflow-x-auto">
            <Filter className="w-4 h-4 text-ink/40 flex-shrink-0" />
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedCurrency(T.all)}
                className={`flex-shrink-0 px-4 py-2 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${selectedCurrency === T.all ? 'bg-ink text-white' : 'bg-background text-ink/40 border border-divider'}`}
              >
                {T.all}
              </button>
              {availableCurrencies.map(curr => (
                <button
                  key={curr}
                  onClick={() => setSelectedCurrency(curr)}
                  className={`flex-shrink-0 px-4 py-2 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${selectedCurrency === curr ? 'bg-ink text-white' : 'bg-background text-ink/40 border border-divider'}`}
                >
                  {curr}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <section className="bg-primary-blue p-8 rounded-[40px] shadow-xl shadow-primary-blue/20 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-12 -mt-12" />
        <p className="text-white/70 text-xs font-bold uppercase tracking-[0.2em] mb-4 relative z-10">{T.paidCost}</p>
        <div className="space-y-4 relative z-10">
          {totalByCurrency.length > 0 ? totalByCurrency.map(row => (
            <div key={row.currency}>
              <p className="text-4xl font-serif font-bold tracking-tight">{formatCurrencyAmount(row.currency, row.total)}</p>
              <p className="text-xs text-white/70 mt-1">
                {row.receiptCount} {T.receiptUnit} · {T.discount} {formatCurrencyAmount(row.currency, row.discount)} · {T.receiptTaxRefund} {formatCurrencyAmount(row.currency, row.taxRefund)}
              </p>
            </div>
          )) : (
            <p className="text-4xl font-serif font-bold tracking-tight">0</p>
          )}
        </div>
      </section>

      <ListSection title={T.byOwner} icon={<Users className="w-4 h-4 text-primary-blue" />} data={buildListData('ownerTotals')} />
      <ListSection title={T.byDefaultGroup} icon={<PieChartIcon className="w-4 h-4 text-primary-blue" />} data={buildListData('defaultTotals')} />
      <ListSection title={T.byAccount} icon={<WalletCards className="w-4 h-4 text-primary-blue" />} data={buildListData('paymentUsage')} />

      {totalByCurrency.some(row => row.refundIncome > 0) && (
        <ListSection
          title={T.refundRecords}
          icon={<AlignLeft className="w-4 h-4 text-primary-blue" />}
          data={totalByCurrency
            .filter(row => row.refundIncome > 0)
            .map(row => ({ name: T.refundIncome, values: [{ curr: row.currency, val: row.refundIncome }] }))}
        />
      )}
    </div>
  );
}

function ListSection({ title, icon, data }: { title: string; icon: ReactNode; data: ListRow[] }) {
  if (data.length === 0) {
    return (
      <div className="bg-card-white p-6 rounded-[32px] shadow-sm border border-divider">
        <h2 className="text-sm font-serif font-bold text-ink flex items-center gap-2 uppercase tracking-widest mb-6">
          {icon}
          {title}
        </h2>
        <div className="flex items-center justify-center text-ink/30 text-xs font-medium pb-2">
          {T.noData}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card-white p-6 rounded-[32px] shadow-sm border border-divider">
      <h2 className="text-sm font-serif font-bold text-ink flex items-center gap-2 uppercase tracking-widest mb-6 border-b border-divider/50 pb-4">
        {icon}
        {title}
      </h2>
      <div className="space-y-4">
        {data.map((item) => (
          <div key={item.name} className="flex justify-between items-start gap-4">
            <span className="text-sm font-bold text-ink/70 mt-0.5">{item.name}</span>
            <div className="flex flex-col items-end gap-1.5">
              {item.values.map(v => (
                <span key={`${item.name}-${v.curr}`} className="text-sm font-serif font-bold text-ink bg-background px-2 py-1 rounded-lg">
                  <span className="text-[10px] text-ink/40 mr-1.5">{v.curr}</span>
                  {v.val.toLocaleString()}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
