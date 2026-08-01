// Minimal `vscode` stub so host-side modules can be unit-tested under vitest.
// Only the surface the tested modules actually touch is implemented.
export const Uri = {
  file: (p: string) => ({
    fsPath: p,
    toString: () => `file://${p.split('/').map(encodeURIComponent).join('/')}`,
  }),
};
