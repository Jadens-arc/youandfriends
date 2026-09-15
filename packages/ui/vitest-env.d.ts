// Registers the Testing Library matchers (`toBeInTheDocument`, `toHaveTextContent`, …) with
// TypeScript. The matchers are installed at runtime by the shared setup file in
// `@youandfriends/config/vitest/react`; this makes the compiler aware of them too, so a
// passing test cannot hide a typecheck failure.
/// <reference types="@testing-library/jest-dom/vitest" />
