import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Centralize bearer-token injection for existing API calls without rewriting each page.
if (typeof window !== 'undefined' && !window.__pulseSyncFetchWrapped) {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input?.url
    let url
    try { url = new URL(rawUrl, window.location.href) } catch { return nativeFetch(input, init) }
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
    const token = window.localStorage.getItem('pulsesync.apiToken') || ''
    const isApiCall = url.pathname.startsWith('/api/')
    if (isApiCall && token) headers.set('Authorization', `Bearer ${token}`)
    const response = await nativeFetch(input, { ...init, headers })
    if (isApiCall && response.status === 401) window.dispatchEvent(new CustomEvent('pulsesync-auth-required'))
    return response
  }
  window.__pulseSyncFetchWrapped = true
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
