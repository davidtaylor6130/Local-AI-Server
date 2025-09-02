// src/components/ui/progress.jsx
import React from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')

export function Progress({ value = 0, className = '' }) {
    const v = Math.max(0, Math.min(100, Number(value)))
    return (
        <div className={cn('relative h-2 w-full overflow-hidden rounded bg-muted', className)}>
            <div
                className="h-full w-full flex-1 bg-gray-900 transition-all"
                style={{ transform: `translateX(${v - 100}%)` }}
            />
        </div>
    )
}