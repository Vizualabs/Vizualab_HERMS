import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type SearchableOption = {
  value: string
  label: string
  disabled?: boolean
}

export function SearchableSelect({
  id,
  name,
  label,
  value,
  options,
  placeholder,
  required,
  disabled,
  className,
  onChange,
  'aria-label': ariaLabel,
}: {
  id?: string
  name?: string
  label?: string
  value: string
  options: SearchableOption[]
  placeholder: string
  required?: boolean
  disabled?: boolean
  className?: string
  onChange: (value: string) => void
  'aria-label'?: string
}) {
  const generatedId = useId()
  const comboboxId = id ?? generatedId
  const listboxId = `${comboboxId}-listbox`
  const searchId = `${comboboxId}-search`
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const selected = options.find((option) => option.value === value)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => option.label.toLowerCase().includes(needle))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const selectedIndex = filtered.findIndex((option) => option.value === value && !option.disabled)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : filtered.findIndex((option) => !option.disabled))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const selectOption = (option: SearchableOption) => {
    if (option.disabled) return
    onChange(option.value)
    close()
  }

  const moveActive = (direction: 1 | -1) => {
    if (filtered.length === 0) return
    let next = activeIndex
    for (let step = 0; step < filtered.length; step += 1) {
      next = (next + direction + filtered.length) % filtered.length
      if (!filtered[next]?.disabled) {
        setActiveIndex(next)
        return
      }
    }
  }

  return (
    <div ref={rootRef} className={className}>
      {label && (
        <label className="mb-2 block text-sm font-medium text-[#071c23]" htmlFor={comboboxId}>
          {label}
        </label>
      )}
      <button
        id={comboboxId}
        type="button"
        className="input flex items-center justify-between gap-2 text-left"
        role="combobox"
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          setOpen((current) => {
            if (current) {
              setQuery('')
              return false
            }
            return true
          })
        }}
      >
        <span className={selected ? 'truncate' : 'truncate text-[#60727e]'}>
          {selected?.label ?? placeholder}
        </span>
        <span aria-hidden className="text-[#60727e]">▾</span>
      </button>
      {open && (
        <div className="relative z-[70]">
          <div className="absolute inset-x-0 top-1 overflow-hidden rounded-md border border-[#d6e0e2] bg-white shadow-lg">
            <div className="border-b border-[#d6e0e2] p-2">
              <input
                ref={searchRef}
                id={searchId}
                className="input"
                type="text"
                role="searchbox"
                aria-label="Search options"
                placeholder="Search..."
                autoComplete="off"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value)
                  setActiveIndex(0)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    moveActive(1)
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    moveActive(-1)
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const option = filtered[activeIndex]
                    if (option) selectOption(option)
                  }
                }}
              />
            </div>
            <ul
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel ?? label ?? placeholder}
              className="max-h-56 overflow-auto py-1"
            >
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-[#60727e]">No matches</li>
              )}
              {filtered.map((option, index) => (
                <li key={`${option.value}-${option.label}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled || undefined}
                    disabled={option.disabled}
                    className={`flex w-full px-3 py-2 text-left text-sm ${
                      option.disabled
                        ? 'cursor-not-allowed text-[#9aa8b0]'
                        : index === activeIndex
                          ? 'bg-[#e8f5f5] text-[#071c23]'
                          : 'text-[#071c23] hover:bg-[#edf3f4]'
                    }`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <input
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        required={required}
        value={value}
        onChange={() => undefined}
      />
    </div>
  )
}
