import {useEffect, useMemo, useState} from 'react';
import {collection, getDocs, onSnapshot, db, auth} from '../lib/local-db';
import {attachDerivedBalances} from '../lib/accounting';

export function useDerivedAccounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [taxRefunds, setTaxRefunds] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);

  useEffect(() => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;

    const unsubscribers = [
      onSnapshot(collection(db, `users/${uid}/paymentAccounts`), (snapshot: any) => {
        const rows = snapshot.docs.map((accountDoc: any) => ({id: accountDoc.id, ...accountDoc.data()}));
        setAccounts(rows.sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)));
      }),
      onSnapshot(collection(db, `users/${uid}/taxRefunds`), (snapshot: any) => {
        setTaxRefunds(snapshot.docs.map((refundDoc: any) => ({id: refundDoc.id, ...refundDoc.data()})));
      }),
      onSnapshot(collection(db, `users/${uid}/transfers`), (snapshot: any) => {
        setTransfers(snapshot.docs.map((transferDoc: any) => ({id: transferDoc.id, ...transferDoc.data()})));
      }),
      onSnapshot(collection(db, `users/${uid}/receipts`), async (snapshot: any) => {
        const rows = await Promise.all(snapshot.docs.map(async (receiptDoc: any) => {
          const itemsSnap = await getDocs(collection(db, `users/${uid}/receipts/${receiptDoc.id}/items`));
          return {
            id: receiptDoc.id,
            ...receiptDoc.data(),
            _items: itemsSnap.docs.map((itemDoc: any) => ({id: itemDoc.id, ...itemDoc.data()}))
          };
        }));
        setReceipts(rows);
      })
    ];

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, []);

  return useMemo(() => {
    return attachDerivedBalances(accounts, {receipts, taxRefunds, transfers});
  }, [accounts, receipts, taxRefunds, transfers]);
}
