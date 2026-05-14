/**
 * src/hooks/usePWA.ts
 * ─────────────────────────────────────────────────────────────
 * 偵測 SW 更新，提示使用者重新整理取得最新版本。
 * vite-plugin-pwa 會自動注入 virtual:pwa-register/react
 */
import { useRegisterSW } from 'virtual:pwa-register/react'

export function usePWA() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // 可選：每小時檢查一次更新
      if (r) {
        setInterval(() => r.update(), 60 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.warn('SW 註冊失敗', error)
    },
  })

  const dismiss = () => setNeedRefresh(false)
  const update  = () => updateServiceWorker(true)

  return { needRefresh, update, dismiss }
}

// ─────────────────────────────────────────────────────────────
/**
 * src/components/UpdateToast.tsx
 * 有新版本時在畫面底部顯示更新提示 Toast
 */
export function UpdateToast({ show, onUpdate, onDismiss }:any) {
  if (!show) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-zinc-900 text-white rounded-2xl px-4 py-3 flex items-center justify-between shadow-xl gap-3">
        <div>
          <div className="text-sm font-semibold">有新版本了 🎉</div>
          <div className="text-xs text-zinc-400 mt-0.5">點「更新」取得最新版本</div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors">
            稍後
          </button>
          <button
            onClick={onUpdate}
            className="px-3 py-1.5 rounded-lg bg-white text-zinc-900 text-xs font-semibold hover:bg-zinc-100 transition-colors">
            更新
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
/**
 * 在 App.tsx 使用方式：
 *
 * import { usePWA }       from './hooks/usePWA'
 * import { UpdateToast }  from './components/UpdateToast'
 *
 * export default function App() {
 *   const { needRefresh, update, dismiss } = usePWA()
 *
 *   return (
 *     <>
 *       ...你現有的 UI...
 *       <UpdateToast show={needRefresh} onUpdate={update} onDismiss={dismiss} />
 *     </>
 *   )
 * }
 */
