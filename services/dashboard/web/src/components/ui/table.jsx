// src/components/ui/table.jsx
import React from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')

export function Table({ className = '', ...props }) {
    return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
}
export function TableHeader({ className = '', ...props }) {
    return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}
export function TableBody({ className = '', ...props }) {
    return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}
export function TableRow({ className = '', ...props }) {
    return <tr className={cn('border-b transition-colors', className)} {...props} />
}
export function TableHead({ className = '', ...props }) {
    return (
        <th
            className={cn('h-10 px-4 text-left align-middle font-medium text-muted-foreground', className)}
            {...props}
        />
    )
}
export function TableCell({ className = '', ...props }) {
    return <td className={cn('p-4 align-middle', className)} {...props} />
}
export function TableCaption({ className = '', ...props }) {
    return <caption className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
}