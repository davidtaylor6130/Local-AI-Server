// src/components/ui/badge.jsx
import React from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')

export function Badge({ variant = 'default', className = '', ...props }) {
    const styles = {
        default: 'bg-gray-900 text-white',
        secondary: 'bg-muted text-foreground',
        outline: 'border',
        destructive: 'bg-destructive text-white',
    }
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                styles[variant] || styles.default,
                className
            )}
            {...props}
        />
    )
}