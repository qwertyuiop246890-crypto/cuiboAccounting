const label = (value: string) => value;

export const OWNER_OPTIONS = [
  label('\u81ea\u7528'),
  label('\u79c1\u4eba\u7528\u9014'),
  label('\u5ba2\u4eba'),
  label('\u89aa\u53cb'),
  label('\u5bb6\u4eba'),
  label('\u670b\u53cb'),
  label('\u9032\u8ca8/\u5099\u8ca8'),
  label('\u672a\u5206\u985e')
];

export const DEFAULT_GROUP_OPTIONS = [
  label('\u5ba2\u4eba'),
  label('\u89aa\u53cb'),
  label('\u79c1\u4eba\u7528\u9014'),
  label('\u81ea\u7528'),
  label('\u9032\u8ca8/\u5099\u8ca8'),
  label('\u672a\u5206\u985e')
];

const legacyGroupMap: Record<string, string> = {
  Business: label('\u5ba2\u4eba'),
  Personal: label('\u79c1\u4eba\u7528\u9014'),
  '\u9032\u8ca8': label('\u5ba2\u4eba'),
  '\u4ee3\u8cfc': label('\u5ba2\u4eba'),
  '?脰疏': label('\u5ba2\u4eba'),
  '蝘犖': label('\u79c1\u4eba\u7528\u9014'),
  '憌脤?': label('\u4e00\u822c\u63a1\u8cfc'),
  '?嗡?': label('\u672a\u5206\u985e')
};

export interface SplitItem {
  name?: string;
  translatedName?: string;
  price?: number | string;
  quantity?: number | string;
  source?: string;
  tag?: string;
}

export interface SplitReceipt {
  category?: string;
  subCategory?: string;
  currency?: string;
  totalAmount?: number;
  totalDiscount?: number;
  totalTaxRefund?: number;
}

export interface SplitSummaryRow {
  owner: string;
  currency: string;
  gross: number;
  discountShare: number;
  taxRefundShare: number;
  net: number;
}

const toAmount = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

const DISCOUNT_ITEM_PATTERN = /値引|割引|クーポン|coupon|discount|折扣|優惠/i;
const TAX_REFUND_ITEM_PATTERN = /tax\s*free|tax\s*refund|免税|免稅|退税|退稅/i;

const matchesAdjustment = (item: SplitItem, pattern: RegExp) => {
  const text = `${item.name || ''} ${item.translatedName || ''} ${item.source || ''}`;
  return pattern.test(text) && toAmount(item.price) < 0;
};

const getAdjustmentTotal = (items: SplitItem[], pattern: RegExp) => {
  return items
    .filter(item => matchesAdjustment(item, pattern))
    .reduce((sum, item) => sum + Math.abs(toAmount(item.price) * (Math.abs(toAmount(item.quantity)) || 1)), 0);
};

export const normalizeGroupName = (value?: string, fallback = label('\u672a\u5206\u985e')) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return fallback;
  return legacyGroupMap[trimmed] || trimmed;
};

export const getDefaultOwner = (receipt: SplitReceipt) => {
  return normalizeGroupName(receipt.category || receipt.subCategory, label('\u672a\u5206\u985e'));
};

export function buildSplitSummary(receipt: SplitReceipt, items: SplitItem[] = []): SplitSummaryRow[] {
  const currency = receipt.currency || 'JPY';
  const defaultOwner = getDefaultOwner(receipt);

  if (!items.length) {
    const amount = toAmount(receipt.totalAmount);
    return amount
      ? [{ owner: defaultOwner, currency, gross: amount, discountShare: 0, taxRefundShare: 0, net: amount }]
      : [];
  }

  const rows = new Map<string, SplitSummaryRow & { allocationBase: number }>();

  items.forEach((item) => {
    const owner = normalizeGroupName(item.tag, defaultOwner);
    const amount = toAmount(item.price) * (toAmount(item.quantity) || 1);
    const row = rows.get(owner) || {
      owner,
      currency,
      gross: 0,
      discountShare: 0,
      taxRefundShare: 0,
      net: 0,
      allocationBase: 0
    };

    row.gross += amount;
    row.allocationBase += Math.max(0, amount);
    rows.set(owner, row);
  });

  const totalBase = Array.from(rows.values()).reduce((sum, row) => sum + row.allocationBase, 0);
  const itemDiscountTotal = getAdjustmentTotal(items, DISCOUNT_ITEM_PATTERN);
  const itemTaxRefundTotal = getAdjustmentTotal(items, TAX_REFUND_ITEM_PATTERN);
  const totalDiscount = Math.max(0, toAmount(receipt.totalDiscount) - itemDiscountTotal);
  const totalTaxRefund = Math.max(0, toAmount(receipt.totalTaxRefund) - itemTaxRefundTotal);

  const summary = Array.from(rows.values()).map((row) => {
    const ratio = totalBase > 0 ? row.allocationBase / totalBase : 0;
    const discountShare = roundMoney(totalDiscount * ratio);
    const taxRefundShare = roundMoney(totalTaxRefund * ratio);
    return {
      owner: row.owner,
      currency: row.currency,
      gross: roundMoney(row.gross),
      discountShare,
      taxRefundShare,
      net: roundMoney(row.gross - discountShare - taxRefundShare)
    };
  });

  const expectedTotal = toAmount(receipt.totalAmount);
  if (summary.length && expectedTotal) {
    const currentTotal = summary.reduce((sum, row) => sum + row.net, 0);
    const residual = roundMoney(expectedTotal - currentTotal);
    if (residual !== 0) {
      const largest = summary.reduce((best, row) => (Math.abs(row.net) > Math.abs(best.net) ? row : best), summary[0]);
      largest.net = roundMoney(largest.net + residual);
    }
  }

  return summary.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

export const formatCurrencyAmount = (currency: string, amount: number) => {
  return `${currency || 'JPY'} ${roundMoney(amount).toLocaleString()}`;
};
