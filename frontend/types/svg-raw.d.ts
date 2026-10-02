/**
 * `import svg from './x.svg?raw'` — the file's text, inlined at build time. Webpack gets
 * this from the `?raw` rule in next.config.mjs, Vitest from Vite's built-in `?raw`.
 * Used for the shared loading snail (components/snail-loader.tsx), which has to be inline
 * markup rather than an <img> so the shell can take the page's red (`--accent`).
 */
declare module '*.svg?raw' {
  const content: string
  export default content
}
