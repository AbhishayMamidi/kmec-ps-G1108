const DEFAULT_TIMEOUT_MS = 60_000

export function getBackendBaseUrl() {
  const baseUrl = process.env.NEUROSENTINEL_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL

  if (!baseUrl) {
    throw new Error('NEUROSENTINEL_BACKEND_URL or NEXT_PUBLIC_API_URL must be configured.')
  }

  return baseUrl.replace(/\/+$/, '')
}

export async function fetchBackend(path: string, init: RequestInit & { accessToken?: string; timeoutMs?: number } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const headers = new Headers(init.headers)
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json')
    }
    if (init.accessToken) {
      headers.set('Authorization', `Bearer ${init.accessToken}`)
    }

    return await fetch(`${getBackendBaseUrl()}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}
