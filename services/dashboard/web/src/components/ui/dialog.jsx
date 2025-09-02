// src/components/ui/dialog.jsx
import React, { createContext, useContext, useEffect } from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')
const Ctx = createContext({ open: false, onOpenChange: () => {} })

export function Dialog({ open = false, onOpenChange = () => {}, children }) {
    return <Ctx.Provider value={{ open, onOpenChange }}>{children}</Ctx.Provider>
}

export function DialogContent({ className = '', children }) {
    const { open, onOpenChange } = useContext(Ctx)
    useEffect(() => {
        function onKey(e) { if (e.key === 'Escape') onOpenChange(false) }
        if (open) window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onOpenChange])

    if (!open) return null
    return (
        <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
            <div className={cn(
                'relative z-10 mx-auto mt-24 w-[92%] max-w-lg rounded-lg border bg-background p-4 shadow-lg',
                className
            )}>
                {children}
            </div>
        </div>
    )
}

export function DialogHeader({ className = '', ...props }) {
    return <div className={cn('mb-2', className)} {...props} />
}
export function DialogTitle({ className = '', ...props }) {
    return <h3 className={cn('text-lg font-semibold', className)} {...props} />
}
export function DialogDescription({ className = '', ...props }) {
    return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}