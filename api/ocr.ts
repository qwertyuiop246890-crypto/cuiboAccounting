import {GoogleGenAI, ThinkingLevel, Type} from '@google/genai';

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  on?: (event: string, callback: (chunk?: Buffer) => void) => void;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: () => void;
};

const MODEL_FALLBACK_ORDER = [
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash'
];

const isQuotaError = (message: string) => {
  return /429|quota|exhausted|resource_exhausted|rate limit/i.test(message);
};

const isModelFallbackError = (message: string) => {
  return /404|not found|not_found|unsupported|unavailable|permission|denied|invalid model/i.test(message);
};

const getGeminiKeys = () => {
  return [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5
  ].filter((key): key is string => Boolean(key && key.trim().length > 20));
};

const getModelFallbackOrder = (preferred?: string, candidates?: unknown) => {
  const requested = Array.isArray(candidates)
    ? candidates.filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
    : [];
  const ordered = [preferred, ...requested, ...MODEL_FALLBACK_ORDER]
    .filter((model): model is string => typeof model === 'string' && model.trim().length > 0);

  return Array.from(new Set(ordered));
};

const parseDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2]
  };
};

const normalizeBody = async (req: VercelRequest): Promise<any> => {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  if (!req.on) return {};

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on?.('data', chunk => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on?.('end', () => resolve());
    req.on?.('error', () => reject(new Error('Failed to read request body')));
  });

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const buildPrompt = () => `
你是代購帳務管理用的收據 OCR。請只輸出符合 schema 的 JSON，不要輸出 Markdown、說明文字或額外欄位。

辨識目標：
1. 讀取店家名稱、日期時間、實付總額、折扣、退稅、每一筆商品明細。
2. 商品名稱保持收據原文，translatedName 使用繁體中文補充用途或商品意思。
3. 不要自行推測客人歸屬，所有品項先不填 owner，前端會讓使用者補。

金額規則：
1. totalAmount 必須是實際付款金額，優先讀「合計」「クレジット支払」「現金」「お預り」「領収金額」等實付欄位。
2. 不可以把「小計（税抜）」「商品代金」「税率対象」「消費税等」當成 totalAmount。
3. 如果收據有 7-11 常見欄位：商品代金 4,178、値引額 -12、小計（税抜 8%）4,166、消費税等 333、合計 4,499，totalAmount 必須是 4499，不是 4156、4166 或 4178。
4. 如果同一張收據同時印出「合計 ¥4,499」與「クレジット支払 ¥4,499」，totalAmount 必須直接抄 4499，不要因為 items 裡有折扣列又有 totalDiscount 而自行改算成 4487。
5. 折扣與退稅要填入收據層級欄位；若收據上有獨立列，也可以保留在 items 方便使用者核對。

明細規則：
1. items[].price 是單價，quantity 是數量；如果收據寫「@118 x 4 *472」，price=118，quantity=4。
2. 如果只有一個金額，quantity=1。
3. 折扣列例如「値引額 -12」「割引」「クーポン」「優惠」「折扣」請把絕對值加總到 totalDiscount；例如「値引額 -12」輸出 totalDiscount=12。若也放入 items，price 請保留負數。
4. 退稅列例如「Tax Free」「免税」「免稅」「退税」「退稅」請把絕對值加總到 totalTaxRefund。若也放入 items，price 請保留負數。
5. 如果有一般消費稅列，因為 schema 沒有 tax 欄位，請加入一筆稅金 item：name 使用收據稅金文字，translatedName="消費稅"，price=稅額，quantity=1。
6. totalTaxRefund 只用於 Tax Free 或免稅退稅金額；一般日本 8% 或 10% 消費稅不算退稅。

日期規則：
1. date 輸出 YYYY-MM-DDTHH:mm。
2. 例如 2025年07月28日 22:14，輸出 "2025-07-28T22:14"。

檢查規則：
1. totalAmount 優先相信收據印出的合計/支付金額，不要用推導公式覆蓋。
2. 若 items 已包含負數折扣列，totalDiscount 仍要填正數給前端顯示，但檢查公式時不要重複扣同一筆折扣。
3. 若收據有合計與刷卡支付金額，以實付合計為準，不要為了省略稅金或重複折扣而讓總額錯誤。
4. 所有數字只輸出 number，不要包含 ¥、JPY、逗號或空白。
`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    storeName: {type: Type.STRING},
    date: {
      type: Type.STRING,
      description: 'Standardized date string: YYYY-MM-DDTHH:mm'
    },
    totalAmount: {type: Type.NUMBER},
    totalDiscount: {type: Type.NUMBER},
    totalTaxRefund: {type: Type.NUMBER},
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: {type: Type.STRING},
          translatedName: {type: Type.STRING},
          price: {type: Type.NUMBER},
          quantity: {type: Type.NUMBER},
          source: {type: Type.STRING}
        }
      }
    }
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({error: 'Method not allowed'});
    return;
  }

  try {
    const keys = getGeminiKeys();
    if (keys.length === 0) {
      res.status(500).json({error: 'Gemini API keys are not configured on the server.'});
      return;
    }

    const body = await normalizeBody(req);
    const imageDataUrls = Array.isArray(body.images) ? body.images : body.imageDataUrls;
    if (!Array.isArray(imageDataUrls) || imageDataUrls.length === 0) {
      res.status(400).json({error: 'No receipt images were provided.'});
      return;
    }

    const imageParts = imageDataUrls
      .filter((value: unknown): value is string => typeof value === 'string')
      .map(parseDataUrl)
      .filter((value): value is {mimeType: string; data: string} => Boolean(value))
      .map(image => ({
        inlineData: {
          mimeType: image.mimeType,
          data: image.data
        }
      }));

    if (imageParts.length === 0) {
      res.status(400).json({error: 'Receipt images must be data URLs.'});
      return;
    }

    const prompt = buildPrompt();
    const models = getModelFallbackOrder(body.model, body.modelCandidates);
    const startKeyIndex = Date.now() % keys.length;
    const errors: string[] = [];

    for (const model of models) {
      for (let offset = 0; offset < keys.length; offset++) {
        const keyIndex = (startKeyIndex + offset) % keys.length;
        const ai = new GoogleGenAI({apiKey: keys[keyIndex]});

        try {
          const response = await ai.models.generateContent({
            model,
            contents: [{parts: [...imageParts, {text: prompt}]}],
            config: {
              ...(model.startsWith('gemini-3') ? {thinkingConfig: {thinkingLevel: ThinkingLevel.HIGH}} : {}),
              responseMimeType: 'application/json',
              responseSchema
            }
          });

          const result = JSON.parse(response.text || '{}');
          res.status(200).json({
            result,
            model,
            keyIndex: keyIndex + 1
          });
          return;
        } catch (error: any) {
          const message = error?.message || String(error);
          errors.push(`${model} key ${keyIndex + 1}: ${message}`);

          if (isQuotaError(message)) continue;
          if (isModelFallbackError(message)) break;
          if (offset < keys.length - 1) continue;
          break;
        }
      }
    }

    res.status(502).json({
      error: 'All Gemini models/API keys failed.',
      details: errors.slice(-5)
    });
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || 'OCR API failed.'
    });
  }
}
