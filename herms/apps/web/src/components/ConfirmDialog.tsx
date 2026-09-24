import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ConfirmOptions = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  hideCancel?: boolean
  tone?: 'primary' | 'danger'
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)
  const [request, setRequest] = useState<ConfirmOptions | null>(null)
  const titleId = useId()
  const messageId = useId()

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setRequest(null)
  }, [])

  const confirm = useCallback<ConfirmFn>((options) => {
    resolverRef.current?.(false)
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setRequest(options)
    })
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (request) {
      if (!dialog.open) dialog.showModal()
      const focusTarget = request.tone === 'danger' && !request.hideCancel
        ? dialog.querySelector<HTMLButtonElement>('.button-secondary')
        : dialog.querySelector<HTMLButtonElement>('[data-confirm-action]')
      focusTarget?.focus()
      return
    }
    if (dialog.open) dialog.close()
  }, [request])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={messageId}
        role="alertdialog"
        className="confirm-dialog m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-foreground/35"
        onClose={() => {
          if (resolverRef.current) settle(false)
        }}
      >
        {request && (
          <div className="p-5">
            <h2 id={titleId} className="text-base font-semibold">
              {request.title}
            </h2>
            <p id={messageId} className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
              {request.message}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {!request.hideCancel && (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => settle(false)}
                >
                  {request.cancelLabel ?? 'Cancel'}
                </button>
              )}
              <button
                type="button"
                data-confirm-action
                className={request.tone === 'danger'
                  ? 'min-h-10 rounded-md border border-danger bg-danger px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger'
                  : 'button-primary'}
                onClick={() => settle(true)}
              >
                {request.confirmLabel ?? (request.hideCancel ? 'OK' : 'Confirm')}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) {
    throw new Error('useConfirm must be used inside ConfirmProvider')
  }
  return confirm
}
