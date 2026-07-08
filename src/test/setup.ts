// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.) for the
// component tests. Safe to load in the Node environment too — it only extends
// `expect`; the matchers touch the DOM only when actually called.
import '@testing-library/jest-dom/vitest'
