// src/components/ui/separator.jsx
import React from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')

export function Separator({ orientation = 'horizontal', className = '' }) {
    if (orientation === 'vertical') {
        return <div className={cn('w-px h-full bg-border', className)} role="separator" />
    }
    return <div className={cn('h-px w-full bg-border', className)} role="separator" />
}