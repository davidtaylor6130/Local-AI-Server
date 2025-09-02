// src/components/ui/switch.jsx
import React from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')

export function Switch({ checked = false, onCheckedChange = () => {}, className = '' }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onCheckedChange(!checked)}
            className={cn(
                'inline-flex h-5 w-9 items-center rounded-full border bg-muted transition',
                checked ? 'bg-gray-900' : '',
                className
            )}
        >
      <span
          className={cn(
              'block h-4 w-4 translate-x-0 rounded-full bg-background shadow transition',
              checked ? 'translate-x-4' : 'translate-x-1'
          )}
      />
        </button>
    )
}