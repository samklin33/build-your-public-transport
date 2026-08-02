/// <reference types="vite/client" />

/**
 * 由 vite.config.ts 的 define 在建置時替換成字面量 true / false。
 * true 代表城市資料直接打包進 bundle（單檔版），false 則在執行期用 fetch 載入。
 */
declare const __INLINE_PACK__: boolean;

declare module '*?worker&inline' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
