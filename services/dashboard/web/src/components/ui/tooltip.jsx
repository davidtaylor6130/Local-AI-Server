// src/components/ui/tooltip.jsx
import React, { createContext, useContext, useEffect, useState } from 'react'

const Ctx = createContext({ content: '', setContent: () => {} })

export function TooltipProvider({ children }) {
    return <>{children}</>
}

export function Tooltip({ children }) {
    const [content, setContent] = useState('')
    return <Ctx.Provider value={{ content, setContent }}>{children}</Ctx.Provider>
}

export function TooltipTrigger({ asChild = false, children }) {
    const { content } = useContext(Ctx)
    if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children, { title: typeof content === 'string' ? content : '' })
    }
    return <span title={typeof content === 'string' ? content : ''}>{children}</span>
}

export function TooltipContent({ children }) {
    const { setContent } = useContext(Ctx)
    useEffect(() => {
        setContent(typeof children === 'string' ? children : '')
        return () => setContent('')
    }, [children, setContent])
    return null
}