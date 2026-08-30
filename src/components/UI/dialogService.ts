export type DialogApi = {
  confirm: (opts: { title: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }) => Promise<boolean>;
  alert: (opts: { title: string; message: string; actionLabel?: string }) => Promise<void>;
  prompt: (opts: { title: string; message?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string; validate?: (v: string) => string | null }) => Promise<string | null>;
};

let api: DialogApi | null = null;

export const setDialogApi = (next: DialogApi | null) => { api = next; };

export const getDialogApi = (): DialogApi | null => api;

export const dialogConfirm = async (opts: Parameters<DialogApi['confirm']>[0]): Promise<boolean> => {
  if (api) return api.confirm(opts);
  // Fallback before provider mounts — default to safe cancel, never show native dialog
  console.warn('[dialogService] confirm called before DialogProvider mounted', opts);
  return false;
};

export const dialogAlert = async (opts: Parameters<DialogApi['alert']>[0]): Promise<void> => {
  if (api) return api.alert(opts);
  console.warn('[dialogService] alert called before DialogProvider mounted', opts);
};

export const dialogPrompt = async (opts: Parameters<DialogApi['prompt']>[0]): Promise<string | null> => {
  if (api) return api.prompt(opts);
  console.warn('[dialogService] prompt called before DialogProvider mounted', opts);
  return null;
};
