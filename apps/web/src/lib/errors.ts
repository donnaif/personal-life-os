import { ApiError } from '../api/client';

/** Arabic, user-facing message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return err.message;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'حدث خطأ غير متوقع.';
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.isNetwork;
}
