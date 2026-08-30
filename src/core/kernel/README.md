# `src/core/kernel`

GSSK WASM loading, instance lifecycle and typed-array views. The kernel runs in a Web Worker and the main thread holds no views into WASM memory (REQ-APP-6/7). Built by `p0-kernel-worker`.

Empty until the task that fills it. Listed in §9.1 of
`docs/gssk-budget-requirements.md`, so the directory exists from the start
rather than appearing halfway through and moving code around.
