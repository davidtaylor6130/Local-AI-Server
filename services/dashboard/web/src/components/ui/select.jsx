// src/components/ui/select.jsx
import React from 'react'
const cn = (...xs) => xs.filter(Boolean).join(' ')

const isComp = (el, name) => React.isValidElement(el) && el.type && el.type.displayName === name

export function Select({ value, onValueChange, children }) {
    let triggerClass = ''
    let placeholder = undefined
    let items = []

    React.Children.forEach(children, (child) => {
        if (!React.isValidElement(child)) return
        if (isComp(child, 'SelectTrigger')) {
            triggerClass = child.props.className || ''
            React.Children.forEach(child.props.children, (c) => {
                if (isComp(c, 'SelectValue')) placeholder = c.props.placeholder
            })
        }
        if (isComp(child, 'SelectContent')) {
            React.Children.forEach(child.props.children, (item) => {
                if (isComp(item, 'SelectItem')) {
                    items.push({ value: item.props.value, label: item.props.children })
                }
            })
        }
    })

    // Ensure the current value exists; otherwise default to first.
    const current = items.find((i) => i.value === value)?.value ?? value

    return (
        <select
            value={current}
            onChange={(e) => onValueChange?.(e.target.value)}
            className={cn(
                'h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300',
                triggerClass
            )}
        >
            {placeholder && <option disabled hidden value="__placeholder__">{placeholder}</option>}
            {items.map((i) => (
                <option key={i.value} value={i.value}>
                    {i.label}
                </option>
            ))}
        </select>
    )
}

export function SelectTrigger({ className = '', children }) {
    return <div className={className} data-slot="trigger">{children}</div>
}
SelectTrigger.displayName = 'SelectTrigger'

export function SelectValue({ placeholder }) {
    return <span data-placeholder={placeholder} />
}
SelectValue.displayName = 'SelectValue'

export function SelectContent({ children }) {
    return <>{children}</>
}
SelectContent.displayName = 'SelectContent'

export function SelectItem({ value, children }) {
    return <option value={value}>{children}</option>
}
SelectItem.displayName = 'SelectItem'