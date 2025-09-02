// src/components/ui/input.jsx
import React, { forwardRef } from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')

export const Input = forwardRef(function Input({ className = '', ...props }, ref) {
    return (
        <input
            ref={ref}
            className={cn(
                'flex h-9 w-full rounded-md border bg-background px-3 py-2 text-sm',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-gray-300',
                className
            )}
            {...props}
        />
    )
})