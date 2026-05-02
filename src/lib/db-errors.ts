import { auth } from './local-db';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface DatabaseErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

export function getFriendlyErrorMessage(error: any): string {
  const message = error instanceof Error ? error.message : String(error);

  if (error.name === 'QuotaExceededError' || message.includes('Quota')) {
    return '設備儲存空間已滿。請清理空間後再試。';
  }

  return `發生未預期的本機資料庫錯誤。請稍後再試。`;
}

export function handleDatabaseError(error: unknown, operationType: OperationType, path: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  const isQuota = message.includes('Quota') || (error as any).name === 'QuotaExceededError';

  const errInfo: DatabaseErrorInfo = {
    error: message,
    operationType,
    path
  };
  
  if (isQuota) {
      console.warn("Local DB Quota Exceeded [Non-Fatal]:", getFriendlyErrorMessage(error), JSON.stringify(errInfo));
  } else {
      console.error('Local DB Error:', JSON.stringify(errInfo));
      throw new Error(JSON.stringify({
        ...errInfo,
        friendlyMessage: getFriendlyErrorMessage(error)
      }));
  }
}
