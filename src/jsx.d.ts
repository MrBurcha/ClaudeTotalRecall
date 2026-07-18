// @types/react 19 stopped declaring the global `JSX` namespace (it now lives
// under `React.JSX`). This codebase annotates components with the bare
// `JSX.Element` throughout, so re-expose the global namespace by delegating each
// member to `React.JSX`. TypeScript only ever looks up this fixed set of names
// in the JSX namespace, so the shim is complete — and because every member just
// forwards to React's own definition, it can't drift out of sync.
import type { JSX as ReactJSX } from 'react'

declare global {
  namespace JSX {
    type ElementType = ReactJSX.ElementType
    type Element = ReactJSX.Element
    type ElementClass = ReactJSX.ElementClass
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute
    type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>
    type IntrinsicAttributes = ReactJSX.IntrinsicAttributes
    type IntrinsicClassAttributes<T> = ReactJSX.IntrinsicClassAttributes<T>
    type IntrinsicElements = ReactJSX.IntrinsicElements
  }
}
