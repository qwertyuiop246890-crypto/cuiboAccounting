export type AccountRecord = {
  id: string;
  balance?: number;
  openingBalance?: number;
  balanceMode?: string;
};

export type ReceiptRecord = {
  id?: string;
  paymentAccountId?: string;
  totalAmount?: number;
};

export type TaxRefundRecord = {
  id?: string;
  paymentAccountId?: string;
  amount?: number;
};

export type TransferRecord = {
  id?: string;
  fromAccountId?: string;
  toAccountId?: string;
  sourceAmount?: number;
  targetAmount?: number;
  amount?: number;
};

export type AccountBalanceInputs = {
  receipts?: ReceiptRecord[];
  taxRefunds?: TaxRefundRecord[];
  transfers?: TransferRecord[];
};

const toAmount = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const uniqueById = <T extends {id?: string}>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter(row => {
    if (!row.id) return true;
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
};

export const getOpeningBalance = (account: AccountRecord) => {
  return toAmount(account.openingBalance ?? account.balance);
};

export const shouldUseDerivedBalance = (account: AccountRecord) => {
  return account.balanceMode === 'derived' || account.openingBalance !== undefined;
};

export const deriveAccountBalances = (
  accounts: AccountRecord[],
  {receipts = [], taxRefunds = [], transfers = []}: AccountBalanceInputs
) => {
  const balances = new Map<string, number>();

  accounts.forEach(account => {
    balances.set(account.id, getOpeningBalance(account));
  });

  uniqueById(receipts).forEach(receipt => {
    if (!receipt.paymentAccountId || !balances.has(receipt.paymentAccountId)) return;
    balances.set(receipt.paymentAccountId, (balances.get(receipt.paymentAccountId) || 0) - toAmount(receipt.totalAmount));
  });

  uniqueById(taxRefunds).forEach(refund => {
    if (!refund.paymentAccountId || !balances.has(refund.paymentAccountId)) return;
    balances.set(refund.paymentAccountId, (balances.get(refund.paymentAccountId) || 0) + toAmount(refund.amount));
  });

  uniqueById(transfers).forEach(transfer => {
    const sourceAmount = toAmount(transfer.sourceAmount ?? transfer.amount);
    const targetAmount = toAmount(transfer.targetAmount ?? transfer.amount);

    if (transfer.fromAccountId && balances.has(transfer.fromAccountId)) {
      balances.set(transfer.fromAccountId, (balances.get(transfer.fromAccountId) || 0) - sourceAmount);
    }
    if (transfer.toAccountId && balances.has(transfer.toAccountId)) {
      balances.set(transfer.toAccountId, (balances.get(transfer.toAccountId) || 0) + targetAmount);
    }
  });

  return balances;
};

const DISCOUNT_ITEM_PATTERN = /値引|割引|クーポン|coupon|discount|折扣|優惠/i;
const TAX_REFUND_ITEM_PATTERN = /tax\s*free|tax\s*refund|免税|免稅|退税|退稅/i;
const INCLUDED_TAX_INFO_PATTERN = /うち\s*消費税|内\s*消費税|消費税等|內含稅|內含消費稅|內消費稅|included\s*tax/i;

export type ReceiptLineItem = {
  name?: string;
  translatedName?: string;
  source?: string;
  price?: number | string;
  quantity?: number | string;
};

const matchesAdjustment = (item: ReceiptLineItem, pattern: RegExp) => {
  const text = `${item.name || ''} ${item.translatedName || ''} ${item.source || ''}`;
  return pattern.test(text) && toAmount(item.price) < 0;
};

const adjustmentTotal = (items: ReceiptLineItem[], pattern: RegExp) => {
  return items
    .filter(item => matchesAdjustment(item, pattern))
    .reduce((sum, item) => sum + Math.abs(toAmount(item.price) * (Math.abs(toAmount(item.quantity)) || 1)), 0);
};

const isIncludedTaxInfoItem = (item: ReceiptLineItem, hasTaxRefund: boolean) => {
  if (!hasTaxRefund || toAmount(item.price) <= 0) return false;
  const text = `${item.name || ''} ${item.translatedName || ''} ${item.source || ''}`;
  return INCLUDED_TAX_INFO_PATTERN.test(text);
};

const getPayableItems = (items: ReceiptLineItem[], totalTaxRefund = 0) => {
  const hasTaxRefund = toAmount(totalTaxRefund) > 0 || items.some(item => matchesAdjustment(item, TAX_REFUND_ITEM_PATTERN));
  return items.filter(item => !isIncludedTaxInfoItem(item, hasTaxRefund));
};

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

export const calculateReceiptReconciliation = ({
  items,
  totalAmount,
  totalDiscount = 0,
  totalTaxRefund = 0
}: {
  items: ReceiptLineItem[];
  totalAmount: number;
  totalDiscount?: number;
  totalTaxRefund?: number;
}) => {
  const payableItems = getPayableItems(items, totalTaxRefund);
  const itemTotal = payableItems.reduce((sum, item) => sum + toAmount(item.price) * (toAmount(item.quantity) || 1), 0);
  const itemDiscountTotal = adjustmentTotal(payableItems, DISCOUNT_ITEM_PATTERN);
  const itemTaxRefundTotal = adjustmentTotal(payableItems, TAX_REFUND_ITEM_PATTERN);
  const extraDiscount = Math.max(0, toAmount(totalDiscount) - itemDiscountTotal);
  const extraTaxRefund = Math.max(0, toAmount(totalTaxRefund) - itemTaxRefundTotal);
  const calculatedTotal = roundMoney(itemTotal - extraDiscount - extraTaxRefund);
  const paidTotal = roundMoney(totalAmount);

  return {
    itemTotal: roundMoney(itemTotal),
    itemDiscountTotal,
    itemTaxRefundTotal,
    extraDiscount,
    extraTaxRefund,
    calculatedTotal,
    paidTotal,
    difference: roundMoney(paidTotal - calculatedTotal)
  };
};

export const attachDerivedBalances = <T extends AccountRecord>(
  accounts: T[],
  inputs: AccountBalanceInputs
) => {
  const derived = deriveAccountBalances(accounts, inputs);
  return accounts.map(account => {
    if (!shouldUseDerivedBalance(account)) return account;
    const balance = derived.get(account.id) ?? getOpeningBalance(account);
    return {
      ...account,
      balance,
      derivedBalance: balance
    };
  });
};
