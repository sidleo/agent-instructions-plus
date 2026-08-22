/**
 * DEPRECATED — agent-instructions-plus (renamed from instruction-scan).
 *
 * The install-time replacement preset is gone. The new architecture makes
 * installation a no-op: the host entry registers only the provider + GUI RPC.
 * Users enable takeover per preset in the Web GUI (Settings → Plugins →
 * AGENTS注入), which copies the chosen preset to
 * `agent-instructions-plus-<id>` with its `agent-instructions` row disabled
 * and the `/preset` injection row inserted. Disabling deletes the copy,
 * restoring the built-in preset untouched.
 *
 * This script is kept for reference only and is not part of the build.
 */
console.log('DEPRECATED: preset takeover is now driven from the Web GUI (Settings → Plugins → AGENTS注入). See README.md.')
