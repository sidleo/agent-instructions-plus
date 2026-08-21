/**
 * Global declarations for the DSH client-plugin sandbox.
 * The client half runs inside the browser module loader, which injects the
 * `host` RPC bridge (and `React`) without an import. Declared here so
 * `tsc --noEmit` passes for src/client.
 */
declare const host: {
  call(method: string, args?: unknown): Promise<unknown>
}
