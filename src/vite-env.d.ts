/// <reference types="vite/client" />

/* Components load their markup and styles as strings (REQ-APP-1). Vite resolves
 * the `?raw` suffix; these declarations are what make it typed. */
declare module '*.html?raw' {
  const content: string;
  export default content;
}

declare module '*.css?raw' {
  const content: string;
  export default content;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}
