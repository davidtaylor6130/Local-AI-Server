// src/components/ui/tabs.jsx
import React, { createContext, useContext } from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')

const TabsCtx = createContext({ value: undefined, onValueChange: () => {} })

export function Tabs({ value, onValueChange, children }) {
    return <TabsCtx.Provider value={{ value, onValueChange }}>{children}</TabsCtx.Provider>
}

export function TabsList({ className = '', ...props }) {
    return (
        <div
            role="tablist"
            className={cn('inline-flex items-center gap-1 rounded-md border bg-muted p-1', className)}
            {...props}
        />
    )
}

export function TabsTrigger({ value, className = '', children, ...props }) {
    const ctx = useContext(TabsCtx)
    const active = ctx.value === value
    return (
        <button
            role="tab"
            aria-selected={active}
            onClick={() => ctx.onValueChange?.(value)}
            className={cn(
                'px-3 py-1.5 rounded-md text-sm transition',
                active ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground',
                className
            )}
            {...props}
        >
            {children}
        </button>
    )
}

export function TabsContent({ value, className = '', children, ...props }) {
    const ctx = useContext(TabsCtx)
    const hidden = ctx.value !== value
    return (
        <div role="tabpanel" hidden={hidden} className={className} {...props}>
            {!hidden && children}
        </div>
    )
}