/** Bubble / plankton CSS adapted from the DSH theme; motion is preserved. */
export const DECORATION_STYLES = `
[data-codex-decoration-layer] [data-codex-critter] {
  position: absolute;
  color: #7ea4df;
  opacity: 0.22;
  pointer-events: none;
}
[data-codex-decoration-layer] [data-codex-critter='bubble'] {
  color: #a9c6ef;
  opacity: 0;
  animation: codex-decoration-bubble-rise 9s ease-in infinite;
}
[data-codex-decoration-layer] [data-codex-critter='plankton'] {
  color: #7ea4df;
  animation: codex-decoration-plankton 5s ease-in-out infinite;
}
@keyframes codex-decoration-bubble-rise {
  0% { transform: translate3d(0, 0, 0); opacity: 0; }
  10% { opacity: 0.5; }
  100% { transform: translate3d(8px, -150px, 0); opacity: 0; }
}
@keyframes codex-decoration-plankton {
  0%, 100% { opacity: 0.1; }
  50% { opacity: 0.38; }
}
@media (prefers-reduced-motion: reduce) {
  [data-codex-decoration-layer] [data-codex-critter] { animation: none; }
  [data-codex-decoration-layer] [data-codex-critter='bubble'] { opacity: 0; }
}
`
