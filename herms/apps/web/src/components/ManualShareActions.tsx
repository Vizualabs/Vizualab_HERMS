import { useState } from 'react'

import { createWhatsAppWebUrl } from '../whatsapp'

export function WhatsAppShareButton({
  message,
  label = 'Open WhatsApp Web',
}: {
  message: string
  label?: string
}) {
  return (
    <a
      aria-label={label}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-whatsapp bg-whatsapp text-white shadow-sm transition-colors hover:border-whatsapp-hover hover:bg-whatsapp-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp focus-visible:ring-offset-2"
      href={createWhatsAppWebUrl(message)}
      rel="noopener noreferrer"
      target="_blank"
      title={label}
    >
      <WhatsAppIcon />
    </a>
  )
}

export function ManualLinkShare({
  link,
  message,
  label,
}: {
  link: string
  message: string
  label: string
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-primary-soft p-4">
      <div>
        <p className="text-sm font-semibold text-primary-strong">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Copy it or open WhatsApp Web to choose a contact and send it manually.
        </p>
      </div>
      <input
        aria-label={`${label} URL`}
        className="input text-sm"
        onFocus={(event) => event.currentTarget.select()}
        readOnly
        value={link}
      />
      <div className="flex flex-wrap gap-2">
        <a className="button-secondary inline-flex items-center" href={link} rel="noopener noreferrer" target="_blank">
          Open form
        </a>
        <button
          className="button-primary"
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link)
              setCopied(true)
              setCopyError(false)
            } catch {
              setCopyError(true)
            }
          }}
        >
          <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
        </button>
        <WhatsAppShareButton message={message} label={`Share ${label.toLowerCase()} via WhatsApp`} />
      </div>
      {copyError && <p role="alert" className="text-xs text-danger">Copy failed. Select and copy the URL above manually.</p>}
    </div>
  )
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12.04 2a9.84 9.84 0 0 0-8.53 14.75L2 22l5.38-1.41A9.97 9.97 0 0 0 12.04 22 9.96 9.96 0 0 0 22 12.02 9.96 9.96 0 0 0 12.04 2Zm0 18.32a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.19.84.85-3.11-.2-.32a8.17 8.17 0 0 1-1.26-4.39 8.28 8.28 0 1 1 8.28 8.3Zm4.54-6.2c-.25-.13-1.47-.73-1.7-.81-.23-.09-.4-.13-.57.12-.17.25-.64.81-.79.98-.14.17-.29.19-.54.06-.25-.12-1.05-.38-2-1.23a7.5 7.5 0 0 1-1.38-1.71c-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.44.13-.14.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.57-.43h-.48c-.16 0-.43.06-.66.31-.23.25-.87.85-.87 2.08s.89 2.41 1.02 2.58c.12.17 1.75 2.68 4.25 3.76.59.26 1.06.41 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.47-.61 1.68-1.19.21-.58.21-1.08.15-1.19-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  )
}
