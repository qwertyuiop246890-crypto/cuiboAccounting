import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, collection, deleteDoc, updateDoc, getDocs, onSnapshot, db, auth } from '../lib/local-db';
import { handleDatabaseError, OperationType, getFriendlyErrorMessage } from '../lib/db-errors';
import { Camera, Save, Plus, Trash2, ArrowLeft, Image as ImageIcon, Sparkles, X, ClipboardPaste } from 'lucide-react';
import { format } from 'date-fns';
import { Modal } from '../components/ui/Modal';
import { Autocomplete } from '../components/ui/Autocomplete';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import { OWNER_OPTIONS, DEFAULT_GROUP_OPTIONS, buildSplitSummary, formatCurrencyAmount, normalizeGroupName } from '../lib/expense-groups';
import { useDerivedAccounts } from '../hooks/useDerivedAccounts';

const T = {
  newReceipt: '\u65b0\u589e\u6536\u64da',
  editReceipt: '\u7de8\u8f2f\u6536\u64da',
  aiTitle: 'AI \u6536\u64da\u8fa8\u8b58',
  aiHelp: '\u53ef\u62cd\u591a\u5f35\u6536\u64da\u6216\u5f9e\u526a\u8cbc\u7c3f\u8cbc\u4e0a\u3002AI \u6703\u5148\u62c6\u51fa\u54c1\u9805\uff0c\u4f60\u518d\u88dc\u4e0a\u6bcf\u7b46\u6b78\u5c6c\u3002',
  camera: '\u62cd\u7167',
  gallery: '\u76f8\u7c3f',
  paste: '\u8cbc\u4e0a',
  uploadTip: '\u53ef\u4e00\u6b21\u4e0a\u50b3\u591a\u5f35\uff0c\u4e5f\u53ef\u76f4\u63a5 Ctrl+V / Cmd+V \u8cbc\u4e0a\u5716\u7247\u3002',
  processing: '\u8655\u7406\u4e2d...',
  viewLarge: '\u67e5\u770b\u5927\u5716',
  itemSection: '\u54c1\u9805\u660e\u7d30',
  splitSummary: '\u6b78\u5c6c\u7d71\u8a08',
  splitHint: '\u672a\u6307\u5b9a\u54c1\u9805\u6703\u6b78\u5230\u6536\u64da\u5927\u6b78\u985e',
  itemName: '\u65e5\u6587\u539f\u6587',
  translatedName: '\u4e2d\u6587\u54c1\u540d',
  unitPrice: '\u55ae\u50f9',
  quantity: '\u6578\u91cf',
  owner: '\u6b78\u5c6c\uff08\u53ef\u7a7a\u767d\uff09',
  save: '\u5132\u5b58',
  cancel: '\u53d6\u6d88',
  addItem: '\u65b0\u589e\u54c1\u9805',
  receiptInfo: '\u6536\u64da\u8cc7\u8a0a',
  storeName: '\u5e97\u5bb6\u4e2d\u6587\u540d\u7a31',
  storeOriginalName: '\u5e97\u5bb6\u65e5\u6587\u539f\u6587',
  storePlaceholder: '\u4f8b\uff1a\u4e03\u8457\u4fbf\u5229\u5546\u5e97\u3001\u85e5\u599d\u5e97',
  storeOriginalPlaceholder: '\u4f8b\uff1a\u30bb\u30d6\u30f3-\u30a4\u30ec\u30d6\u30f3',
  dateTime: '\u65e5\u671f\u6642\u9593',
  currency: '\u5e63\u5225',
  totalPaid: '\u5be6\u4ed8\u7e3d\u984d',
  discount: '\u6298\u6263',
  taxRefund: '\u9000\u7a05',
  paymentAccount: '\u4ed8\u6b3e\u5e33\u6236',
  selectAccount: '\u9078\u64c7\u4ed8\u6b3e\u5e33\u6236',
  defaultGroup: '\u6536\u64da\u5927\u6b78\u985e',
  subCategory: '\u5b50\u5206\u985e',
  saveReceipt: '\u5132\u5b58\u6536\u64da',
  updateReceipt: '\u66f4\u65b0\u6536\u64da',
  gross: '\u6bdb\u984d',
  discountShare: '\u5206\u6524\u6298\u6263',
  taxRefundShare: '\u5206\u6524\u9000\u7a05',
  netCost: '\u6700\u7d42\u6210\u672c',
  noItems: '\u5c1a\u672a\u6709\u54c1\u9805',
  apiMode: '\u5f8c\u7aef API \u8fa8\u8b58\u4e2d...',
  apiTestSuccess: '\u5f8c\u7aef API \u8fa8\u8b58\u5b8c\u6210',
  apiTestFailed: '\u5f8c\u7aef API \u8fa8\u8b58\u5931\u6557',
  reconcileTitle: '\u5c0d\u5e33\u8b66\u544a',
  reconcileHelp: '\u660e\u7d30\u3001\u6298\u6263\u3001\u9000\u7a05\u548c\u5be6\u4ed8\u7e3d\u984d\u5c0d\u4e0d\u8d77\u4f86\uff0c\u8acb\u6838\u5c0d OCR \u7d50\u679c\u3002',
  itemTotal: '\u660e\u7d30\u5408\u8a08',
  calculatedTotal: '\u63a8\u7b97\u5be6\u4ed8',
  difference: '\u5dee\u984d'
};

const SUBCATEGORY_OPTIONS = [
  '\u4e00\u822c\u63a1\u8cfc',
  '\u98f2\u98df',
  '\u85e5\u599d',
  '\u670d\u98fe',
  '\u96dc\u8ca8',
  '\u4ea4\u901a',
  '\u5176\u4ed6'
];

const GEMINI_MODEL_OPTIONS = [
  { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
];

const DEFAULT_OCR_MODEL = 'gemini-3-pro-preview';
const OCR_API_URL = (import.meta.env.VITE_OCR_API_URL as string) || '/api/ocr';

const getModelFallbackOrder = (preferredModel: string) => {
  const models = GEMINI_MODEL_OPTIONS.map(model => model.value);
  return [preferredModel, ...models.filter(model => model !== preferredModel)];
};

const DISCOUNT_ITEM_PATTERN = /値引|割引|クーポン|coupon|discount|折扣|優惠/i;
const TAX_REFUND_ITEM_PATTERN = /tax\s*free|tax\s*refund|免税|免稅|退税|退稅/i;

const getAdjustmentAmount = (item: any) => {
  const price = Number(item?.price) || 0;
  const quantity = Math.abs(Number(item?.quantity) || 1);
  return Math.abs(price * quantity);
};

const matchesAdjustment = (item: any, pattern: RegExp) => {
  const text = `${item?.name || ''} ${item?.translatedName || ''} ${item?.source || ''}`;
  return pattern.test(text) && Number(item?.price) < 0;
};

const getAdjustmentTotal = (items: any[], pattern: RegExp) => {
  return items
    .filter(item => matchesAdjustment(item, pattern))
    .reduce((sum, item) => sum + getAdjustmentAmount(item), 0);
};

const roundMoney = (amount: number) => Math.round(amount * 100) / 100;

const isQuotaError = (message: string) => {
  return /429|quota|exhausted|resource_exhausted|rate limit/i.test(message);
};

const isModelFallbackError = (message: string) => {
  return /404|not found|not_found|unsupported|unavailable|permission|denied|invalid model/i.test(message);
};

const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1800;
        const MAX_HEIGHT = 2400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

const normalizeDate = (dateStr: string) => {
  if (!dateStr) return '';
  // Convert slash, dot or space to standardized T format for consistent Date parsing and localeCompare
  let normalized = dateStr.replace(/\//g, '-').replace(/\./g, '-').replace(' ', 'T').trim();
  try {
    const [datePart, timePart] = normalized.split('T');
    const dateParts = datePart.split('-');
    
    if (dateParts.length === 3) {
      let [year, month, day] = dateParts;
      if (year.length === 2) year = `20${year}`;
      month = month.padStart(2, '0');
      day = day.padStart(2, '0');
      
      let finalDate = `${year}-${month}-${day}`;
      
      if (timePart) {
        const timeSegments = timePart.split(':');
        const hour = (timeSegments[0] || '00').padStart(2, '0');
        const min = (timeSegments[1] || '00').padStart(2, '0');
        finalDate += `T${hour}:${min}`;
      } else {
        finalDate += 'T00:00';
      }
      return finalDate;
    }
  } catch (e) {
    console.warn("Date normalization failed", e);
  }
  return normalized;
};

export function ReceiptDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const accounts = useDerivedAccounts();
  const [items, setItems] = useState<any[]>([]);
  const [pendingAiItems, setPendingAiItems] = useState<any[]>([]);
  
  const [receipt, setReceipt] = useState({
    date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    totalAmount: 0,
    paymentAccountId: '',
    category: '?脰疏',
    subCategory: '憌脤?',
    currency: 'JPY',
    notes: '',
    photoUrl: '',
    photoUrls: [] as string[],
    storeName: '',
    translatedStoreName: ''
  });

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemData, setEditItemData] = useState({ name: '', translatedName: '', price: '', quantity: '', tag: '' });
  const [newItem, setNewItem] = useState({ name: '', translatedName: '', price: '', quantity: '1', notes: '', tag: '' });
  const [showFullImage, setShowFullImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isNew) return;
    setReceipt(prev => ({
      ...prev,
      category: DEFAULT_GROUP_OPTIONS.includes(normalizeGroupName(prev.category)) ? normalizeGroupName(prev.category) : '\u5ba2\u4eba',
      subCategory: prev.subCategory && !prev.subCategory.includes('?') ? prev.subCategory : '\u4e00\u822c\u63a1\u8cfc'
    }));
  }, [isNew]);

  // Modal State
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

  useEffect(() => {
    if (isNew || !auth.currentUser || !id) return;

    const fetchReceiptAndItems = async () => {
      try {
        const docRef = doc(db, `users/${auth.currentUser!.uid}/receipts/${id}`);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          let displayDate = '';
          if (data.date) {
              if (data.date.includes('Z')) {
                 displayDate = format(new Date(data.date), "yyyy-MM-dd'T'HH:mm");
              } else {
                 displayDate = data.date.slice(0, 16);
              }
          }
          
          setReceipt({
            date: displayDate,
            totalAmount: data.totalAmount || 0,
            paymentAccountId: data.paymentAccountId || '',
            category: data.category || '?脰疏',
            subCategory: data.subCategory || '憌脤?',
            currency: data.currency || 'JPY',
            notes: data.notes || '',
            photoUrl: data.photoUrl || '',
            photoUrls: data.photoUrls || [],
            storeName: data.storeName || '',
            translatedStoreName: data.translatedStoreName || '',
            totalDiscount: data.totalDiscount || 0,
            totalTaxRefund: data.totalTaxRefund || 0
          });
        }

        const qItems = collection(db, `users/${auth.currentUser!.uid}/receipts/${id}/items`);
        const unsubscribe = onSnapshot(qItems, (itemsSnap: any) => {
          const fetchedItems = itemsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          fetchedItems.sort((a: any, b: any) => {
             const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
             const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
             return tB - tA;
          });
          setItems(fetchedItems);
        });
        return () => unsubscribe();
      } catch (error) {
        handleDatabaseError(error, OperationType.GET, `users/${auth.currentUser?.uid}/receipts/${id}`);
      }
    };

    fetchReceiptAndItems();
  }, [id, isNew]);

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (uploading || !auth.currentUser) return;
      
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        // Create a synthetic event object to reuse handleFileChange logic
        const syntheticEvent = {
          target: { files: imageFiles }
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        
        await handleFileChange(syntheticEvent);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [uploading, auth.currentUser, receipt]); // Dependencies for handlePaste

  const handlePasteFromClipboard = async () => {
    if (uploading || !auth.currentUser) return;
    
    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageFiles: File[] = [];
      for (const clipboardItem of clipboardItems) {
        for (const type of clipboardItem.types) {
          if (type.startsWith('image/')) {
            const blob = await clipboardItem.getType(type);
            const file = new File([blob], "pasted-image.png", { type });
            imageFiles.push(file);
          }
        }
      }
      
      if (imageFiles.length > 0) {
        const syntheticEvent = {
          target: { files: imageFiles }
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        await handleFileChange(syntheticEvent);
      } else {
        setModalConfig({
          isOpen: true,
          title: '\u672a\u627e\u5230\u5716\u7247',
          message: '\u526a\u8cbc\u7c3f\u5167\u6c92\u6709\u53ef\u7528\u5716\u7247\uff0c\u8acb\u5148\u8907\u88fd\u6536\u64da\u7167\u7247\u3002',
          type: 'error'
        });
      }
    } catch (err) {
      console.error("Failed to read clipboard contents: ", err);
      setModalConfig({
        isOpen: true,
        title: '\u7121\u6cd5\u8b80\u53d6\u526a\u8cbc\u7c3f',
        message: '\u8acb\u78ba\u8a8d\u700f\u89bd\u5668\u5141\u8a31\u526a\u8cbc\u7c3f\u6b0a\u9650\uff0c\u6216\u6539\u7528\u76f8\u7c3f\u4e0a\u50b3\u3002',
        type: 'error'
      });
    }
  };

  // Auto-calculate total from items if any exist
  useEffect(() => {
    if (items.length > 0 || pendingAiItems.length > 0) {
      const allItems = [...items, ...pendingAiItems];
      const savedTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const pendingTotal = pendingAiItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
      const itemDiscountTotal = getAdjustmentTotal(allItems, DISCOUNT_ITEM_PATTERN);
      const itemTaxRefundTotal = getAdjustmentTotal(allItems, TAX_REFUND_ITEM_PATTERN);
      
      setReceipt(prev => {
        const discount = Math.max(0, (prev.totalDiscount || 0) - itemDiscountTotal);
        const taxRefund = Math.max(0, (prev.totalTaxRefund || 0) - itemTaxRefundTotal);
        const newTotalAmount = savedTotal + pendingTotal - discount - taxRefund;
        if (prev.totalAmount === newTotalAmount) return prev;
        return { 
          ...prev, 
          totalAmount: newTotalAmount 
        };
      });
    }
  }, [items, pendingAiItems, receipt.totalDiscount, receipt.totalTaxRefund]);

  const currencySymbol = receipt.currency || 'JPY';
  const allReceiptItems = useMemo(() => [...items, ...pendingAiItems], [items, pendingAiItems]);
  const splitSummary = useMemo(() => buildSplitSummary(receipt, allReceiptItems), [receipt, allReceiptItems]);
  const reconciliation = useMemo(() => {
    const itemTotal = allReceiptItems.reduce((sum, item) => {
      return sum + ((Number(item.price) || 0) * (Number(item.quantity) || 1));
    }, 0);
    const itemDiscountTotal = getAdjustmentTotal(allReceiptItems, DISCOUNT_ITEM_PATTERN);
    const itemTaxRefundTotal = getAdjustmentTotal(allReceiptItems, TAX_REFUND_ITEM_PATTERN);
    const extraDiscount = Math.max(0, (Number(receipt.totalDiscount) || 0) - itemDiscountTotal);
    const extraTaxRefund = Math.max(0, (Number(receipt.totalTaxRefund) || 0) - itemTaxRefundTotal);
    const calculatedTotal = roundMoney(itemTotal - extraDiscount - extraTaxRefund);
    const paidTotal = roundMoney(Number(receipt.totalAmount) || 0);
    const difference = roundMoney(paidTotal - calculatedTotal);

    return {
      itemTotal: roundMoney(itemTotal),
      extraDiscount,
      extraTaxRefund,
      calculatedTotal,
      paidTotal,
      difference,
      hasWarning: allReceiptItems.length > 0 && Math.abs(difference) >= 1
    };
  }, [allReceiptItems, receipt.totalAmount, receipt.totalDiscount, receipt.totalTaxRefund]);
  const normalizedReceiptCategory = normalizeGroupName(receipt.category, '\u5ba2\u4eba');
  const displaySubCategory = receipt.subCategory && !receipt.subCategory.includes('?') ? receipt.subCategory : SUBCATEGORY_OPTIONS[0];

  const handleSaveReceipt = async () => {
    if (!auth.currentUser || !receipt.paymentAccountId || !receipt.date) return;
    setLoading(true);

    try {
      const receiptId = isNew ? doc(collection(db, `users/${auth.currentUser.uid}/receipts`)).id : id!;
      const receiptRef = doc(db, `users/${auth.currentUser.uid}/receipts/${receiptId}`);
      
      const receiptData = {
        ...receipt,
        date: normalizeDate(receipt.date),
        category: normalizedReceiptCategory,
        subCategory: displaySubCategory,
        totalAmount: Number(receipt.totalAmount),
        createdAt: isNew ? new Date().toISOString() : ((await getDoc(receiptRef).catch(() => null))?.data()?.createdAt || new Date().toISOString()),
        updatedAt: new Date().toISOString()
      };

      try {
        await setDoc(receiptRef, receiptData);
      } catch (error) {
        handleDatabaseError(error, OperationType.WRITE, `users/${auth.currentUser.uid}/receipts/${receiptId}`);
      }

      // Save pending items
      if (pendingAiItems.length > 0) {
        for (const item of pendingAiItems) {
          const itemRef = doc(collection(db, `users/${auth.currentUser.uid}/receipts/${receiptId}/items`));
          try {
            await setDoc(itemRef, {
              name: item.name || '\u672a\u8fa8\u8b58\u54c1\u9805',
              translatedName: item.translatedName || '',
              price: Number(item.price) || 0,
              quantity: Number(item.quantity) || 1,
              notes: item.notes || '',
              tag: item.tag || '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          } catch (error) {
            handleDatabaseError(error, OperationType.WRITE, `users/${auth.currentUser.uid}/receipts/${receiptId}/items`);
          }
        }
        setPendingAiItems([]);
      }

      toast.success(isNew ? '\u6536\u64da\u5df2\u5132\u5b58' : '\u6536\u64da\u5df2\u66f4\u65b0');
      
      if (isNew) {
        navigate('/', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (error: any) {
      console.error("Error saving receipt:", error);
      const friendlyMsg = getFriendlyErrorMessage(error);
      const isQuota = error.message?.includes('Quota') || error.message?.includes('exhausted') || (error.code === 'resource-exhausted');
      
      setModalConfig({
        isOpen: true,
        title: isQuota ? '\u914d\u984d\u5df2\u7528\u5b8c' : '\u5132\u5b58\u5931\u6557',
        message: isQuota 
          ? '\u8cc7\u6599\u5eab\u914d\u984d\u6682\u6642\u7528\u5b8c\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002'
          : `\u8a73\u7d30\u539f\u56e0\uff1a${friendlyMsg}`,
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !id) return;

    if (isNew) {
      setPendingAiItems(prev => [{
        name: newItem.name,
        translatedName: newItem.translatedName,
        price: Number(newItem.price),
        quantity: Number(newItem.quantity),
        notes: newItem.notes,
        tag: newItem.tag,
        createdAt: new Date().toISOString() // Useful for consistency even if pending
      }, ...prev]);
      setNewItem({ name: '', translatedName: '', price: '', quantity: '1', notes: '', tag: '' });
      return;
    }

    const itemRef = doc(collection(db, `users/${auth.currentUser.uid}/receipts/${id}/items`));
    try {
      await setDoc(itemRef, {
        name: newItem.name,
        translatedName: newItem.translatedName,
        price: Number(newItem.price),
        quantity: Number(newItem.quantity),
        notes: newItem.notes,
        tag: newItem.tag || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      handleDatabaseError(error, OperationType.WRITE, `users/${auth.currentUser.uid}/receipts/${id}/items`);
    }

    setNewItem({ name: '', translatedName: '', price: '', quantity: '1', notes: '', tag: '' });
  };

  const handleUpdateItem = async (itemId: string, isPending: boolean = false, pendingIndex?: number) => {
    if (isPending && pendingIndex !== undefined) {
      setPendingAiItems(prev => {
        const updated = [...prev];
        updated[pendingIndex] = {
          ...updated[pendingIndex],
          name: editItemData.name,
          translatedName: editItemData.translatedName,
          price: Number(editItemData.price),
          quantity: Number(editItemData.quantity),
          tag: editItemData.tag || ''
        };
        return updated;
      });
      setEditingItemId(null);
      return;
    }

    if (!auth.currentUser || !id) return;
    const itemRef = doc(db, `users/${auth.currentUser.uid}/receipts/${id}/items/${itemId}`);
    try {
      await updateDoc(itemRef, {
        name: editItemData.name,
        translatedName: editItemData.translatedName,
        price: Number(editItemData.price),
        quantity: Number(editItemData.quantity),
        tag: editItemData.tag || ''
      });
      toast.success('\u54c1\u9805\u5df2\u66f4\u65b0');
    } catch (error) {
      handleDatabaseError(error, OperationType.UPDATE, `users/${auth.currentUser.uid}/receipts/${id}/items/${itemId}`);
      toast.error('\u54c1\u9805\u66f4\u65b0\u5931\u6557');
    }
    setEditingItemId(null);
  };

  const startEditing = (item: any, isPending: boolean = false, pendingIndex?: number) => {
    setEditingItemId(isPending ? `pending-${pendingIndex}` : item.id);
    setEditItemData({
      name: item.name,
      translatedName: item.translatedName || '',
      price: item.price.toString(),
      quantity: item.quantity.toString(),
      tag: item.tag || ''
    });
  };

  const handleDeleteItem = async (itemId: string, isPending: boolean = false, pendingIndex?: number) => {
    if (isPending && pendingIndex !== undefined) {
       setPendingAiItems(prev => prev.filter((_, i) => i !== pendingIndex));
       return;
    }

    if (!auth.currentUser || !id) return;
    setModalConfig({
      isOpen: true,
      title: '\u78ba\u8a8d\u522a\u9664',
      message: '\u78ba\u5b9a\u8981\u522a\u9664\u9019\u500b\u54c1\u9805\u55ce\uff1f',
      type: 'confirm',
      onConfirm: async () => {
        const itemRef = doc(db, `users/${auth.currentUser!.uid}/receipts/${id}/items/${itemId}`);
        try {
          await deleteDoc(itemRef);
          toast.success('\u54c1\u9805\u5df2\u522a\u9664');
        } catch (error) {
          handleDatabaseError(error, OperationType.DELETE, `users/${auth.currentUser?.uid}/receipts/${id}/items/${itemId}`);
          toast.error('\u522a\u9664\u5931\u6557');
        }
      }
    });
  };

  const handlePhotoUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleGalleryUpload = () => {
    if (galleryInputRef.current) {
      galleryInputRef.current.click();
    }
  };

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !auth.currentUser) return;

    setUploading(true);
    setUploadProgress(10);
    setUploadStatus(`\u6b63\u5728\u58d3\u7e2e ${files.length} \u5f35\u5716\u7247...`);

    const modelFallbackOrder = getModelFallbackOrder(DEFAULT_OCR_MODEL);

    const performBackendOCR = async (): Promise<any> => {
      const compressedDataUrls = await Promise.all(files.map((file: File) => compressImage(file)));
      setUploadProgress(35);
      setUploadStatus(T.apiMode);

      const response = await fetch(OCR_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: compressedDataUrls,
          imageDataUrls: compressedDataUrls,
          model: DEFAULT_OCR_MODEL,
          modelCandidates: modelFallbackOrder,
          locale: 'zh-TW',
          task: 'receipt-ocr'
        })
      });

      const payloadText = await response.text();
      let payload: any = {};
      try {
        payload = payloadText ? JSON.parse(payloadText) : {};
      } catch {
        throw new Error(`OCR API \u56de\u50b3\u683c\u5f0f\u4e0d\u662f JSON\uff08${response.status}\uff09`);
      }

      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || `OCR API \u8acb\u6c42\u5931\u6557\uff08HTTP ${response.status}\uff09`);
      }

      const result = payload.result || payload.data || payload.receipt || payload;
      if (result.date) result.date = normalizeDate(result.date);
      return { result, compressedDataUrls, ocrMeta: payload };
    };

    try {
      const { result, compressedDataUrls, ocrMeta } = await performBackendOCR();
      
      setUploadProgress(90);
      setUploadStatus('\u6b63\u5728\u5957\u7528\u8fa8\u8b58\u7d50\u679c...');

      const rawItems = Array.isArray(result.items) ? result.items : [];
      const discountItems = rawItems.filter((item: any) => matchesAdjustment(item, DISCOUNT_ITEM_PATTERN));
      const taxRefundItems = rawItems.filter((item: any) => matchesAdjustment(item, TAX_REFUND_ITEM_PATTERN));
      const detectedDiscount = discountItems.reduce((sum: number, item: any) => sum + getAdjustmentAmount(item), 0);
      const detectedTaxRefund = taxRefundItems.reduce((sum: number, item: any) => sum + getAdjustmentAmount(item), 0);
      const totalDiscount = Math.abs(Number(result.totalDiscount) || 0) || detectedDiscount;
      const totalTaxRefund = Math.abs(Number(result.totalTaxRefund) || 0) || detectedTaxRefund;

      const newReceiptData = {
        ...receipt,
        photoUrl: compressedDataUrls[0],
        photoUrls: compressedDataUrls,
        storeName: result.storeName || receipt.storeName,
        translatedStoreName: result.translatedStoreName || result.storeTranslatedName || receipt.translatedStoreName,
        totalAmount: result.totalAmount || receipt.totalAmount,
        date: result.date ? normalizeDate(result.date).slice(0, 16) : receipt.date,
        totalDiscount,
        totalTaxRefund,
        ocrRawResult: result,
        ocrModel: ocrMeta?.model || DEFAULT_OCR_MODEL,
        ocrKeyIndex: ocrMeta?.keyIndex || null,
        ocrProcessedAt: new Date().toISOString()
      };

      setReceipt(newReceiptData);

      if (rawItems.length > 0) {
        const newItems = rawItems.map((item: any) => ({
          name: item.name || '\u672a\u8fa8\u8b58\u54c1\u9805',
          translatedName: item.translatedName || '',
          price: Number(item.price) || 0,
          quantity: Number(item.quantity) || 1,
          notes: 'AI OCR'
        }));
        setPendingAiItems(prev => [...newItems, ...prev]);
      }
      
      setModalConfig({
        isOpen: true,
        title: T.apiTestSuccess,
        message: '\u5df2\u8fa8\u8b58\u6536\u64da\u54c1\u9805\u3002\u5132\u5b58\u524d\u8acb\u78ba\u8a8d\u6bcf\u7b46\u54c1\u9805\u7684\u6b78\u5c6c\u3002',
        type: 'success'
      });

    } catch (error: any) {
      console.error('Error processing receipt OCR:', error);
      let errorMessage = error?.message || 'OCR \u8fa8\u8b58\u5931\u6557\uff0c\u8acb\u6aa2\u67e5\u5f8c\u7aef API \u8207\u56de\u50b3\u683c\u5f0f\u3002';
      
      if (error?.message?.includes('429') || error?.message?.includes('Resource has been exhausted') || error?.message?.includes('Quota')) {
        errorMessage = 'OCR \u984d\u5ea6\u5df2\u7528\u5b8c\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u6216\u66f4\u63db\u5f8c\u7aef API \u91d1\u9470\u3002';
      } else if (error?.message?.includes('Safety') || error?.message?.includes('blocked')) {
        errorMessage = 'OCR \u88ab AI \u5b89\u5168\u898f\u5247\u963b\u64cb\uff0c\u8acb\u6539\u7528\u53e6\u4e00\u5f35\u6536\u64da\u5716\u7247\u3002';
      } else if (error?.message?.includes('API key not valid')) {
        errorMessage = '\u5f8c\u7aef Gemini API \u91d1\u9470\u7121\u6548\u3002';
      }

      setModalConfig({
        isOpen: true,
        title: T.apiTestFailed,
        message: errorMessage,
        type: 'error'
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  return (
    <div className="p-4 max-w-md mx-auto pb-24 bg-background min-h-screen">
      <header className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate(-1)} className="p-3 bg-white rounded-2xl shadow-md hover:shadow-lg transition-all active:scale-95 group">
          <ArrowLeft className="w-5 h-5 text-ink group-hover:text-primary-blue transition-colors" />
        </button>
        <div>
          <h1 className="text-2xl font-serif font-black text-ink tracking-tight">{isNew ? T.newReceipt : T.editReceipt}</h1>
          <p className="text-[10px] font-bold text-ink/30 uppercase tracking-[0.2em]">\u6536\u64da\u6210\u672c\u5206\u6524</p>
        </div>
      </header>

      <div className="space-y-6">
        <input type="file" accept="image/*" capture="environment" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />
        <input type="file" accept="image/*" multiple ref={galleryInputRef} onChange={handleFileChange} className="hidden" />

        {isNew && (
          <div className="bg-card-white text-ink text-sm p-6 rounded-[32px] border border-divider shadow-xl shadow-black/[0.02] relative overflow-visible group space-y-4">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary-blue/5 rounded-full -mr-12 -mt-12 group-hover:scale-110 transition-transform duration-700" />
            <div className="flex items-start gap-4 relative z-10">
              <div className="bg-primary-blue p-3 rounded-2xl shadow-lg shadow-primary-blue/20">
                <Sparkles className="w-6 h-6 text-white shrink-0" />
              </div>
              <div className="flex-1">
                <p className="font-serif font-black text-ink text-xl mb-1 tracking-tight">{T.aiTitle}</p>
                <p className="text-ink/60 leading-relaxed font-medium text-xs">{T.aiHelp}</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <button onClick={!uploading ? handlePhotoUpload : undefined} disabled={uploading} className={`w-full h-32 bg-card-white rounded-[28px] border-2 border-transparent flex flex-col items-center justify-center overflow-hidden relative group shadow-lg shadow-black/[0.03] transition-all ${!uploading ? 'cursor-pointer hover:border-primary-blue hover:shadow-primary-blue/10 active:scale-95' : 'opacity-50'}`}>
              <div className="bg-primary-blue/5 p-3 rounded-2xl mb-2 group-hover:bg-primary-blue/10 transition-colors"><Camera className="w-6 h-6 text-primary-blue" /></div>
              <span className="text-xs font-bold text-ink uppercase tracking-widest">{T.camera}</span>
            </button>
            <button onClick={!uploading ? handleGalleryUpload : undefined} disabled={uploading} className={`w-full h-32 bg-card-white rounded-[28px] border-2 border-transparent flex flex-col items-center justify-center overflow-hidden relative group shadow-lg shadow-black/[0.03] transition-all ${!uploading ? 'cursor-pointer hover:border-primary-blue hover:shadow-primary-blue/10 active:scale-95' : 'opacity-50'}`}>
              <div className="bg-primary-blue/5 p-3 rounded-2xl mb-2 group-hover:bg-primary-blue/10 transition-colors"><ImageIcon className="w-6 h-6 text-primary-blue" /></div>
              <span className="text-xs font-bold text-ink uppercase tracking-widest">{T.gallery}</span>
            </button>
            <button onClick={!uploading ? handlePasteFromClipboard : undefined} disabled={uploading} className={`w-full h-32 bg-card-white rounded-[28px] border-2 border-transparent flex flex-col items-center justify-center overflow-hidden relative group shadow-lg shadow-black/[0.03] transition-all ${!uploading ? 'cursor-pointer hover:border-primary-blue hover:shadow-primary-blue/10 active:scale-95' : 'opacity-50'}`}>
              <div className="bg-primary-blue/5 p-3 rounded-2xl mb-2 group-hover:bg-primary-blue/10 transition-colors"><ClipboardPaste className="w-6 h-6 text-primary-blue" /></div>
              <span className="text-xs font-bold text-ink uppercase tracking-widest">{T.paste}</span>
            </button>
          </div>

          {!uploading && <div className="text-center text-[10px] font-bold text-ink/40 uppercase tracking-widest mt-2">{T.uploadTip}</div>}

          {uploading && (
            <div className="w-full h-48 bg-background rounded-3xl border-2 border-dashed border-divider flex flex-col items-center justify-center overflow-hidden relative">
              <div className="flex flex-col items-center justify-center w-full h-full bg-ink/80 text-white z-10 absolute inset-0 px-6">
                <div className="w-16 h-16 border-4 border-white/20 border-t-white rounded-full animate-spin mb-4"></div>
                <span className="font-bold text-sm mb-2 tracking-widest">{uploadStatus || T.processing}</span>
                <div className="w-full max-w-[200px] bg-white/20 rounded-full h-2 overflow-hidden">
                  <div className="bg-primary-blue h-full transition-all duration-300 ease-out" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            </div>
          )}

          {receipt.photoUrls && receipt.photoUrls.length > 0 && !uploading && (
            <div className="flex gap-4 overflow-x-auto pb-2 snap-x">
              {receipt.photoUrls.map((url, idx) => (
                <div key={idx} className="min-w-[80%] h-48 bg-background rounded-3xl border-2 border-dashed border-divider flex-shrink-0 flex flex-col items-center justify-center overflow-hidden relative group cursor-pointer snap-center" onClick={() => setShowFullImage(true)}>
                  <img src={url || undefined} alt={`Receipt ${idx + 1}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  <div className="absolute inset-0 bg-ink/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-white" />
                    <span className="text-white font-bold ml-2">{T.viewLarge}</span>
                  </div>
                  <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full font-bold">{idx + 1} / {receipt.photoUrls.length}</div>
                </div>
              ))}
            </div>
          )}

          {receipt.photoUrl && (!receipt.photoUrls || receipt.photoUrls.length === 0) && !uploading && (
            <div className="w-full h-48 bg-background rounded-3xl border-2 border-dashed border-divider flex flex-col items-center justify-center overflow-hidden relative group cursor-pointer" onClick={() => setShowFullImage(true)}>
              <img src={receipt.photoUrl || undefined} alt="Receipt" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-ink/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-white" />
                <span className="text-white font-bold ml-2">{T.viewLarge}</span>
              </div>
            </div>
          )}
        </div>

        <AnimatePresence>
          {showFullImage && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={() => setShowFullImage(false)}>
              <motion.img initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} src={receipt.photoUrl || undefined} className="max-w-full max-h-full object-contain rounded-xl" alt="Full Receipt" />
              <button className="absolute top-6 right-6 text-white p-2 bg-white/10 rounded-full"><X className="w-6 h-6" /></button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="bg-card-white p-6 rounded-3xl shadow-sm border border-divider space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-serif font-bold text-ink">{T.itemSection}</h2>
              <p className="text-[10px] font-bold text-ink/35 uppercase tracking-widest mt-1">{T.splitHint}</p>
            </div>
            <span className="text-[10px] font-bold text-ink/30 uppercase tracking-widest">\u54c1\u9805</span>
          </div>

          {splitSummary.length > 0 && (
            <div className="bg-background rounded-2xl border border-divider p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">{T.splitSummary}</h3>
                <span className="text-[10px] font-bold text-ink/35">{currencySymbol}</span>
              </div>
              {splitSummary.map(row => (
                <div key={row.owner} className="grid grid-cols-[1fr_auto] gap-3 text-xs items-start">
                  <div>
                    <p className="font-bold text-ink">{row.owner}</p>
                    <p className="text-[10px] text-ink/40 mt-0.5">{T.gross} {formatCurrencyAmount(row.currency, row.gross)} - {T.discountShare} {row.discountShare.toLocaleString()} - {T.taxRefundShare} {row.taxRefundShare.toLocaleString()}</p>
                  </div>
                  <span className="font-serif font-bold text-ink bg-white px-2 py-1 rounded-lg">{formatCurrencyAmount(row.currency, row.net)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {allReceiptItems.length === 0 && <div className="text-center py-8 text-ink/30 text-sm font-medium">{T.noItems}</div>}

            {pendingAiItems.map((item, idx) => {
              const rowId = `pending-${idx}`;
              const itemTotal = (Number(item.price) || 0) * (Number(item.quantity) || 1);
              return (
                <div key={rowId} className="p-4 bg-primary-blue/5 rounded-2xl border border-primary-blue/20">
                  {editingItemId === rowId ? (
                    <div className="space-y-3">
                      <input type="text" value={editItemData.translatedName} onChange={e => setEditItemData({ ...editItemData, translatedName: e.target.value })} className="w-full p-2 bg-white border border-divider rounded-xl outline-none text-ink font-bold" placeholder={T.translatedName} />
                      <input type="text" value={editItemData.name} onChange={e => setEditItemData({ ...editItemData, name: e.target.value })} className="w-full p-2 bg-white border border-divider rounded-xl outline-none text-ink/60 text-xs" placeholder={T.itemName} />
                      <div className="flex gap-2">
                        <input type="number" value={editItemData.price} onChange={e => setEditItemData({ ...editItemData, price: e.target.value })} className="flex-1 p-2 bg-white border border-divider rounded-xl outline-none text-ink font-bold" placeholder={T.unitPrice} />
                        <input type="number" value={editItemData.quantity} onChange={e => setEditItemData({ ...editItemData, quantity: e.target.value })} className="w-20 p-2 bg-white border border-divider rounded-xl outline-none text-ink font-bold text-center" placeholder={T.quantity} />
                      </div>
                      <Autocomplete value={editItemData.tag} onChange={val => setEditItemData({ ...editItemData, tag: val })} options={OWNER_OPTIONS} className="w-full p-2 bg-white border border-divider rounded-xl outline-none text-ink text-sm" placeholder={T.owner} />
                      <div className="flex gap-2"><button onClick={() => handleUpdateItem('', true, idx)} className="flex-1 bg-primary-blue text-white font-bold py-2 rounded-xl text-xs">{T.save}</button><button onClick={() => setEditingItemId(null)} className="flex-1 bg-ink/10 text-ink font-bold py-2 rounded-xl text-xs">{T.cancel}</button></div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center gap-3">
                      <div className="cursor-pointer flex-1 min-w-0" onClick={() => startEditing(item, true, idx)}>
                        <p className="font-bold text-ink flex items-center gap-1 flex-wrap"><Sparkles className="w-3 h-3 text-primary-blue" />{item.translatedName || item.name}{(item.tag || normalizedReceiptCategory) && <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ml-1 ${item.tag ? 'bg-red-100 text-red-600' : 'bg-ink/5 text-ink/35'}`}>{item.tag || normalizedReceiptCategory}</span>}</p>
                        {item.translatedName && item.name && <p className="text-[10px] font-bold text-ink/40 mb-1 ml-4">{item.name}</p>}
                        {item.source && <p className="text-[9px] font-medium text-primary-blue/50 mb-1 ml-4">{item.source}</p>}
                        <p className="text-[10px] font-bold text-primary-blue/70 uppercase tracking-wider">{currencySymbol} {item.price} x {item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-4"><span className="font-serif font-bold text-ink">{formatCurrencyAmount(currencySymbol, itemTotal)}</span><button onClick={() => handleDeleteItem('', true, idx)} className="text-red-400 p-1 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button></div>
                    </div>
                  )}
                </div>
              );
            })}

            {items.map(item => {
              const itemTotal = (Number(item.price) || 0) * (Number(item.quantity) || 1);
              return (
                <div key={item.id} className="p-4 bg-background rounded-2xl border border-divider">
                  {editingItemId === item.id ? (
                    <div className="space-y-3">
                      <input type="text" value={editItemData.translatedName} onChange={e => setEditItemData({ ...editItemData, translatedName: e.target.value })} className="w-full p-2 bg-white border border-divider rounded-xl outline-none text-ink font-bold" placeholder={T.translatedName} />
                      <input type="text" value={editItemData.name} onChange={e => setEditItemData({ ...editItemData, name: e.target.value })} className="w-full p-2 bg-white border border-divider rounded-xl outline-none text-ink/60 text-xs" placeholder={T.itemName} />
                      <div className="flex gap-2"><input type="number" value={editItemData.price} onChange={e => setEditItemData({ ...editItemData, price: e.target.value })} className="flex-1 p-2 bg-white border border-divider rounded-xl outline-none text-ink font-bold" placeholder={T.unitPrice} /><input type="number" value={editItemData.quantity} onChange={e => setEditItemData({ ...editItemData, quantity: e.target.value })} className="w-20 p-2 bg-white border border-divider rounded-xl outline-none text-ink font-bold text-center" placeholder={T.quantity} /></div>
                      <Autocomplete value={editItemData.tag} onChange={val => setEditItemData({ ...editItemData, tag: val })} options={OWNER_OPTIONS} className="w-full p-2 bg-white border border-divider rounded-xl outline-none text-ink text-sm" placeholder={T.owner} />
                      <div className="flex gap-2"><button onClick={() => handleUpdateItem(item.id)} className="flex-1 bg-primary-blue text-white font-bold py-2 rounded-xl text-xs">{T.save}</button><button onClick={() => setEditingItemId(null)} className="flex-1 bg-ink/10 text-ink font-bold py-2 rounded-xl text-xs">{T.cancel}</button></div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center gap-3">
                      <div className="cursor-pointer flex-1 min-w-0" onClick={() => startEditing(item)}>
                        <p className="font-bold text-ink flex items-center gap-2 flex-wrap">{item.translatedName || item.name}{(item.tag || normalizedReceiptCategory) && <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${item.tag ? 'bg-red-100 text-red-600' : 'bg-ink/5 text-ink/35'}`}>{item.tag || normalizedReceiptCategory}</span>}</p>
                        {item.translatedName && item.name && <p className="text-[10px] font-bold text-ink/40 mb-1">{item.name}</p>}
                        {item.source && <p className="text-[9px] font-medium text-ink/30 mb-1">{item.source}</p>}
                        <p className="text-[10px] font-bold text-ink/50 uppercase tracking-wider">{currencySymbol} {item.price} x {item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-4"><span className="font-serif font-bold text-ink">{formatCurrencyAmount(currencySymbol, itemTotal)}</span><button onClick={() => handleDeleteItem(item.id)} className="text-red-400 p-1 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <form onSubmit={handleAddItem} className="pt-6 border-t border-divider space-y-4">
            <div className="space-y-2"><input type="text" placeholder={T.translatedName} value={newItem.translatedName} onChange={e => setNewItem({ ...newItem, translatedName: e.target.value })} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink placeholder:text-ink/30" /><input type="text" placeholder={T.itemName} value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} className="w-full p-3 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none text-sm text-ink/60 placeholder:text-ink/20" required /></div>
            <div className="flex gap-4"><input type="number" placeholder={`${T.unitPrice} (${currencySymbol})`} value={newItem.price} onChange={e => setNewItem({ ...newItem, price: e.target.value })} className="flex-1 p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink placeholder:text-ink/30" required /><input type="number" placeholder={T.quantity} value={newItem.quantity} onChange={e => setNewItem({ ...newItem, quantity: e.target.value })} className="w-24 p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink placeholder:text-ink/30 text-center" required min="1" /></div>
            <Autocomplete value={newItem.tag} onChange={val => setNewItem({ ...newItem, tag: val })} options={OWNER_OPTIONS} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none text-ink font-bold" placeholder={T.owner} />
            <button type="submit" className="w-full bg-ink text-white font-bold p-4 rounded-2xl hover:opacity-90 flex items-center justify-center gap-2 transition-all active:scale-95"><Plus className="w-5 h-5" />{T.addItem}</button>
          </form>
        </div>

        <div className="bg-card-white p-6 rounded-3xl shadow-sm border border-divider space-y-6">
          <h2 className="text-lg font-serif font-bold text-ink">{T.receiptInfo}</h2>
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2"><label className="block text-[10px] font-bold text-ink/40 mb-1.5 uppercase tracking-widest">{T.storeName}</label><input type="text" placeholder={T.storePlaceholder} value={receipt.translatedStoreName || ''} onChange={e => setReceipt({ ...receipt, translatedStoreName: e.target.value })} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink text-base" /><label className="block text-[10px] font-bold text-ink/30 mb-1.5 uppercase tracking-widest">{T.storeOriginalName}</label><input type="text" placeholder={T.storeOriginalPlaceholder} value={receipt.storeName || ''} onChange={e => setReceipt({ ...receipt, storeName: e.target.value })} className="w-full p-3 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink/55 text-xs" /></div>
            <div><label className="block text-[10px] font-bold text-ink/40 mb-1.5 uppercase tracking-widest">{T.dateTime}</label><input type="datetime-local" value={receipt.date} onChange={e => setReceipt({ ...receipt, date: e.target.value })} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink text-xs" /></div>
            <div className="grid grid-cols-3 gap-4"><div className="col-span-1"><label className="block text-[10px] font-bold text-ink/40 mb-1.5 uppercase tracking-widest">{T.currency}</label><select value={receipt.currency || 'JPY'} onChange={e => setReceipt({ ...receipt, currency: e.target.value })} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink appearance-none"><option value="JPY">JPY</option><option value="TWD">TWD</option><option value="KRW">KRW</option><option value="USD">USD</option></select></div><div className="col-span-2"><label className="block text-[10px] font-bold text-ink/40 mb-1.5 uppercase tracking-widest">{T.totalPaid}</label><input type="number" value={receipt.totalAmount} onChange={e => setReceipt({ ...receipt, totalAmount: Number(e.target.value) })} disabled={items.length > 0 || pendingAiItems.length > 0} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none disabled:opacity-50 font-serif font-bold text-ink text-lg" /></div></div>
            <div className="grid grid-cols-2 gap-4"><div><label className="block text-[10px] font-bold text-ink/40 mb-1.5 uppercase tracking-widest">{T.discount}</label><input type="number" value={receipt.totalDiscount || ''} onChange={e => setReceipt({ ...receipt, totalDiscount: Number(e.target.value) })} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-serif font-bold text-green-600 text-sm" placeholder="0" /></div><div><label className="block text-[10px] font-bold text-ink/40 mb-1.5 uppercase tracking-widest">{T.taxRefund}</label><input type="number" value={receipt.totalTaxRefund || ''} onChange={e => setReceipt({ ...receipt, totalTaxRefund: Number(e.target.value) })} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-serif font-bold text-blue-600 text-sm" placeholder="0" /></div></div>
          </div>

          {reconciliation.hasWarning && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black">{T.reconcileTitle}</p>
                  <p className="text-[11px] font-bold leading-relaxed mt-1 text-red-500">{T.reconcileHelp}</p>
                </div>
                <span className="shrink-0 rounded-xl bg-white px-3 py-1 text-xs font-black">
                  {formatCurrencyAmount(currencySymbol, reconciliation.difference)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold">
                <span>{T.itemTotal}</span>
                <span className="text-right">{formatCurrencyAmount(currencySymbol, reconciliation.itemTotal)}</span>
                <span>{T.discount}</span>
                <span className="text-right">-{formatCurrencyAmount(currencySymbol, reconciliation.extraDiscount)}</span>
                <span>{T.taxRefund}</span>
                <span className="text-right">-{formatCurrencyAmount(currencySymbol, reconciliation.extraTaxRefund)}</span>
                <span>{T.calculatedTotal}</span>
                <span className="text-right">{formatCurrencyAmount(currencySymbol, reconciliation.calculatedTotal)}</span>
                <span>{T.totalPaid}</span>
                <span className="text-right">{formatCurrencyAmount(currencySymbol, reconciliation.paidTotal)}</span>
              </div>
            </div>
          )}

          <div><label className="block text-[10px] font-bold text-ink/40 mb-1.5 uppercase tracking-widest">{T.paymentAccount} <span className="text-red-400">*</span></label><select value={receipt.paymentAccountId} onChange={e => setReceipt({ ...receipt, paymentAccountId: e.target.value })} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink appearance-none"><option value="">{T.selectAccount}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency} {a.balance.toLocaleString()})</option>)}</select></div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-[10px] font-bold text-ink/40 mb-1.5 uppercase tracking-widest">{T.defaultGroup}</label><Autocomplete value={normalizedReceiptCategory} onChange={val => setReceipt({ ...receipt, category: val })} options={DEFAULT_GROUP_OPTIONS} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink" placeholder={T.defaultGroup} /></div>
            <div><label className="block text-[10px] font-bold text-ink/40 mb-1.5 uppercase tracking-widest">{T.subCategory}</label><Autocomplete value={displaySubCategory} onChange={val => setReceipt({ ...receipt, subCategory: val })} options={SUBCATEGORY_OPTIONS} className="w-full p-4 bg-background border border-divider rounded-2xl focus:ring-2 focus:ring-primary-blue outline-none font-bold text-ink" placeholder={T.subCategory} /></div>
          </div>

          <button onClick={handleSaveReceipt} disabled={loading || !receipt.paymentAccountId} className="w-full bg-primary-blue text-white font-bold p-5 rounded-3xl shadow-lg shadow-primary-blue/20 hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95"><Save className="w-5 h-5" />{isNew ? T.saveReceipt : T.updateReceipt}</button>
        </div>
      </div>

      <Modal isOpen={modalConfig.isOpen} onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))} onConfirm={modalConfig.onConfirm} title={modalConfig.title} message={modalConfig.message} type={modalConfig.type} />
    </div>
  );
}

