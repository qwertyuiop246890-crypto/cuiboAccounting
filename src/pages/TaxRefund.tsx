import { useState, useEffect, useRef } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { collection, doc, setDoc, updateDoc, getDoc, db, auth } from '../lib/local-db';
import { handleDatabaseError, OperationType } from '../lib/db-errors';
import { ArrowLeft, Landmark, Save, Camera, Image as ImageIcon } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { normalizeDate } from '../lib/utils';
import { useDerivedAccounts } from '../hooks/useDerivedAccounts';

const T = {
  newTitle: '\u9000\u7a05\u5165\u5e33',
  editTitle: '\u7de8\u8f2f\u9000\u7a05',
  subtitle: '\u8a18\u9304\u9000\u7a05\u56de\u5230\u54ea\u500b\u5e33\u6236',
  amount: '\u9000\u7a05\u91d1\u984d',
  account: '\u5165\u5e33\u5e33\u6236',
  selectAccount: '\u9078\u64c7\u5165\u5e33\u5e33\u6236',
  dateTime: '\u65e5\u671f\u6642\u9593',
  note: '\u5099\u8a3b',
  notePlaceholder: '\u4f8b\uff1a\u9000\u7a05\u6ac3\u53f0\u3001\u6a5f\u5834\u9000\u7a05',
  camera: '\u62cd\u7167',
  gallery: '\u76f8\u7c3f',
  save: '\u5132\u5b58\u9000\u7a05',
  update: '\u66f4\u65b0\u9000\u7a05',
  saved: '\u9000\u7a05\u5df2\u5132\u5b58',
  failed: '\u9000\u7a05\u5132\u5b58\u5931\u6557'
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
        const max = 1200;
        let { width, height } = img;
        if (width > height && width > max) {
          height *= max / width;
          width = max;
        } else if (height > max) {
          width *= max / height;
          height = max;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

export function TaxRefund() {
  const { id } = useParams();
  const isEdit = !!id;
  const accounts = useDerivedAccounts();
  const [amount, setAmount] = useState('');
  const [targetAccount, setTargetAccount] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [loading, setLoading] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isEdit && !targetAccount && accounts.length > 0) setTargetAccount(accounts[0].id);
  }, [accounts, isEdit, targetAccount]);

  useEffect(() => {
    if (!auth.currentUser || !isEdit || !id) return;

    const fetchRefund = async () => {
      try {
        const snap = await getDoc(doc(db, `users/${auth.currentUser!.uid}/taxRefunds/${id}`));
        if (!snap.exists()) return;
        const data = snap.data();
        setAmount(data.amount?.toString() || '');
        setTargetAccount(data.paymentAccountId || '');
        setNotes(data.notes || '');
        setDate(data.date ? normalizeDate(data.date).substring(0, 16) : format(new Date(), "yyyy-MM-dd'T'HH:mm"));
        setPhotoUrls(data.photoUrls || (data.photoUrl ? [data.photoUrl] : []));
      } catch (error) {
        console.error(error);
      }
    };

    fetchRefund();
  }, [id, isEdit]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    try {
      const next: string[] = [];
      for (let i = 0; i < files.length; i++) {
        next.push(await compressImage(files[i]));
      }
      setPhotoUrls(prev => [...prev, ...next]);
    } catch (error) {
      console.error('Error processing refund photo:', error);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !amount || !targetAccount) return;

    setLoading(true);
    try {
      const refundAmount = Number(amount);
      const acc = accounts.find(a => a.id === targetAccount);
      const refundRef = isEdit
        ? doc(db, `users/${auth.currentUser.uid}/taxRefunds/${id}`)
        : doc(collection(db, `users/${auth.currentUser.uid}/taxRefunds`));

      const payload = {
        date: normalizeDate(date),
        amount: refundAmount,
        paymentAccountId: targetAccount,
        currency: acc?.currency || 'JPY',
        notes,
        photoUrl: photoUrls[0] || '',
        photoUrls,
        updatedAt: new Date().toISOString(),
        ...(isEdit ? {} : { createdAt: new Date().toISOString() })
      };

      if (isEdit) {
        await updateDoc(refundRef, payload);
      } else {
        await setDoc(refundRef, payload);
      }

      toast.success(T.saved);
      navigate('/');
    } catch (error) {
      console.error('Error saving tax refund:', error);
      handleDatabaseError(error, OperationType.WRITE, `users/${auth.currentUser.uid}/taxRefunds`);
      toast.error(T.failed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-md mx-auto bg-background min-h-screen pb-24">
      <header className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate(-1)} className="p-2 bg-card-white rounded-full shadow-sm border border-divider hover:bg-divider transition-colors">
          <ArrowLeft className="w-5 h-5 text-ink" />
        </button>
        <div>
          <h1 className="text-2xl font-serif font-bold text-ink flex items-center gap-2 tracking-tight">
            <Landmark className="w-6 h-6 text-primary-blue" />
            {isEdit ? T.editTitle : T.newTitle}
          </h1>
          <p className="text-[10px] font-bold text-ink/40 uppercase tracking-widest mt-1">{T.subtitle}</p>
        </div>
      </header>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-card-white p-8 rounded-[40px] shadow-sm border border-divider space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="bg-background border border-divider rounded-3xl p-5 flex flex-col items-center gap-2 text-ink/70 font-bold">
              <Camera className="w-6 h-6 text-primary-blue" />
              {T.camera}
            </button>
            <button type="button" onClick={() => galleryInputRef.current?.click()} className="bg-background border border-divider rounded-3xl p-5 flex flex-col items-center gap-2 text-ink/70 font-bold">
              <ImageIcon className="w-6 h-6 text-primary-blue" />
              {T.gallery}
            </button>
          </div>
          <input type="file" accept="image/*" capture="environment" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" />
          <input type="file" accept="image/*" multiple ref={galleryInputRef} onChange={handleFileChange} className="hidden" />

          {photoUrls.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {photoUrls.map((url, index) => (
                <img key={index} src={url} alt={`\u9000\u7a05\u7167\u7247 ${index + 1}`} className="w-28 h-28 rounded-2xl object-cover border border-divider" />
              ))}
            </div>
          )}

          <Field label={T.amount}>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full p-5 bg-background border border-divider rounded-[24px] text-3xl font-serif font-bold text-ink focus:ring-4 focus:ring-primary-blue/10 outline-none" placeholder="0" required />
          </Field>

          <Field label={T.account}>
            <select value={targetAccount} onChange={(e) => setTargetAccount(e.target.value)} className="w-full p-5 bg-background border border-divider rounded-[24px] focus:ring-4 focus:ring-primary-blue/10 outline-none appearance-none text-ink font-bold" required>
              <option value="" disabled>{T.selectAccount}</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({acc.currency} {acc.balance.toLocaleString()})</option>)}
            </select>
          </Field>

          <Field label={T.dateTime}>
            <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className="w-full p-5 bg-background border border-divider rounded-[24px] focus:ring-4 focus:ring-primary-blue/10 outline-none text-ink font-bold" />
          </Field>

          <Field label={T.note}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full p-5 bg-background border border-divider rounded-[24px] focus:ring-4 focus:ring-primary-blue/10 outline-none text-ink font-medium min-h-[100px] resize-none" placeholder={T.notePlaceholder} />
          </Field>

          <button type="submit" disabled={loading || !amount || !targetAccount} className="w-full bg-primary-blue text-white font-bold p-5 rounded-3xl shadow-lg shadow-primary-blue/20 hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95">
            <Save className="w-5 h-5" />
            {isEdit ? T.update : T.save}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-bold text-ink/40 uppercase tracking-widest ml-4">{label}</label>
      {children}
    </div>
  );
}
