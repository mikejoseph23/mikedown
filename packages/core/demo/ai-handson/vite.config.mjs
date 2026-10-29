// Injects the oMLX key from the server's environment; never written to disk.
export default {
  define: { __OMLX_KEY__: JSON.stringify(process.env.OMLX_API_KEY ?? '') },
  server: { fs: { allow: ['../..'] } },
};
