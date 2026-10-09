export class ApiError extends Error {
  constructor(message: string, public status: number) {super(message);}
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options, credentials: 'same-origin',
    headers: {...(options.body ? {'Content-Type': 'application/json'} : {}), ...options.headers},
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || 'Request failed.', response.status);
  return data;
}
export const post = <T>(path: string, body: unknown = {}) => api<T>(path, {method: 'POST', body: JSON.stringify(body)});
export const put = <T>(path: string, body: unknown, method = 'PUT') => api<T>(path, {method, body: JSON.stringify(body)});
export const upload = <T>(path: string, data: BlobPart, type: string, method = 'POST') => api<T>(path, {method, body: data as BodyInit, headers: {'Content-Type': type}});
