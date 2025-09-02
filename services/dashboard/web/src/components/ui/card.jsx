// src/components/ui/card.jsx
import React from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')

export function Card({ className = '', ...props }) {
    return (
        <div
            className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)}
            {...props}
        />
    )
}
export function CardHeader({ className = '', ...props }) {
    return <div className={cn('p-4 border-b', className)} {...props} />
}
export function CardTitle({ className = '', ...props }) {
    return <h3 className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
}
export function CardContent({ className = '', ...props }) {
    return <div className={cn('p-4', className)} {...props} />
}