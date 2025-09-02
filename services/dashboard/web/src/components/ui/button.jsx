// src/components/ui/button.jsx
import React, { forwardRef } from 'react'

const cn = (...xs) => xs.filter(Boolean).join(' ')

const variants = {
    default: 'bg-gray-900 text-white hover:bg-gray-800',
    secondary: 'bg-muted text-foreground hover:bg-muted/80',
    destructive: 'bg-destructive text-white hover:bg-destructive/90',
    outline: 'border bg-transparent hover:bg-muted',
    ghost: 'hover:bg-muted',
}

const sizes = {
    default: 'h-9 px-4 py-2',
    sm: 'h-8 px-3',
    lg: 'h-10 px-5',
    icon: 'h-9 w-9 p-0',
}

export const Button = forwardRef(function Button(
    { className = '', variant = 'default', size = 'default', asChild = false, ...props },
    ref
) {
    const Comp = asChild ? 'span' : 'button'
    return (
        <Comp
            ref={ref}
            className={cn(
                'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300',
                variants[variant] || variants.default,
                sizes[size] || sizes.default,
                className
            )}
            {...props}
        />
    )
})