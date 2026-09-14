/**
 * Ambient declaration for bare side-effect CSS imports (`import './globals.css'`,
 * `import 'maplibre-gl/dist/maplibre-gl.css'`). TypeScript 6.0 enabled
 * `noUncheckedSideEffectImports` by default, which requires a module declaration for
 * any import with no bindings – without this, those imports fail with TS2882.
 */
declare module '*.css'
