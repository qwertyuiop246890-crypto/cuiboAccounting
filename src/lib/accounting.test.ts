import assert from 'node:assert/strict';
import {calculateReceiptReconciliation, deriveAccountBalances} from './accounting';

const sevenElevenItems = [
  {name: '商品代金', price: 4178, quantity: 1},
  {name: '値引額', price: -12, quantity: 1},
  {name: '消費税等 8%', price: 333, quantity: 1}
];

const sevenEleven = calculateReceiptReconciliation({
  items: sevenElevenItems,
  totalAmount: 4499,
  totalDiscount: 12
});

assert.equal(sevenEleven.itemTotal, 4499, '4499 receipt should include discount line and tax line in item total');
assert.equal(sevenEleven.extraDiscount, 0, 'discount -12 in items should not be deducted twice');
assert.equal(sevenEleven.calculatedTotal, 4499, 'receipt calculated total should stay 4499');
assert.equal(sevenEleven.difference, 0, 'receipt reconciliation should balance');

const plazaTaxFree = calculateReceiptReconciliation({
  items: [
    {name: 'P5P4*PRL2Pヘアアクセウォー9NVVH', price: 1980, quantity: 2},
    {name: '4529128681961', price: 1650, quantity: 1},
    {name: '粉色梅洛3P', price: 1340, quantity: 1},
    {name: 'うち消費税等', translatedName: '消費稅', price: 631, quantity: 1},
    {name: '免税額', translatedName: '免稅額', price: -631, quantity: 1}
  ],
  totalAmount: 6319,
  totalTaxRefund: 631
});

assert.equal(plazaTaxFree.itemTotal, 6319, 'included tax info line should not be counted on tax-free receipts');
assert.equal(plazaTaxFree.extraTaxRefund, 0, 'tax-free line in items should not be deducted twice');
assert.equal(plazaTaxFree.calculatedTotal, 6319, 'PLAZA tax-free receipt should stay 6319');
assert.equal(plazaTaxFree.difference, 0, 'PLAZA tax-free receipt should balance');

const taxRefund = calculateReceiptReconciliation({
  items: [
    {name: '商品', price: 1000, quantity: 1},
    {name: 'Tax Free refund', price: -80, quantity: 1}
  ],
  totalAmount: 920,
  totalTaxRefund: 80
});

assert.equal(taxRefund.extraTaxRefund, 0, 'tax refund in items should not be deducted twice');
assert.equal(taxRefund.calculatedTotal, 920, 'tax refund receipt should balance');

const balances = deriveAccountBalances(
  [{id: 'cash', openingBalance: 10000, balanceMode: 'derived'}],
  {
    receipts: [
      {id: 'r1', paymentAccountId: 'cash', totalAmount: 4499},
      {id: 'r1', paymentAccountId: 'cash', totalAmount: 4499}
    ],
    taxRefunds: [
      {id: 't1', paymentAccountId: 'cash', amount: 80},
      {id: 't1', paymentAccountId: 'cash', amount: 80}
    ],
    transfers: []
  }
);

assert.equal(balances.get('cash'), 5581, 'duplicate imported records with same id should not be counted twice');

console.log('accounting tests passed');
