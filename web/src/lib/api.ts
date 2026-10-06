/** Talks to the local Python API (proxied at /api by the dev server). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError('The local engine isn’t running. Start it with npm run dev.', 0);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).detail ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(typeof msg === 'string' ? msg : 'Something went wrong', res.status);
  }
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body: unknown) => call<T>(path, json('POST', body)),
  patch: <T>(path: string, body: unknown) => call<T>(path, json('PATCH', body)),
  del: <T>(path: string) => call<T>(path, { method: 'DELETE' }),
  /** Multipart upload: fields are added as form fields next to the file. */
  upload: <T>(path: string, file: Blob, fields: Record<string, string> = {}, name = 'photo.jpg') => {
    const form = new FormData();
    form.append('file', file, name);
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    return call<T>(path, { method: 'POST', body: form });
  },
};
