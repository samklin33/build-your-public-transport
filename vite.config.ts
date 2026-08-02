import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * VITE_INLINE_PACK=1 會產生「單檔版」：城市資料、JS、CSS 全部內嵌成一個 HTML，
 * 可以直接用檔案開啟或丟到任何地方，不需要伺服器。
 * 一般的 build 則維持城市資料獨立成檔，方便瀏覽器快取。
 */
export default defineConfig(({ mode }) => {
  void mode;
  const single = process.env.VITE_INLINE_PACK === '1';
  return {
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    base: './',
    // 用 define 換成字面量常數，Rollup 才能把用不到的那一支完全消掉。
    // 若寫成 import.meta.env.X，未定義時會留成執行期查表，
    // 結果 1.6 MB 的城市資料會被打包進一般版本裡。
    define: { __INLINE_PACK__: JSON.stringify(single) },
    worker: { format: 'es' },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 4000,
      outDir: single ? 'dist-single' : 'dist',
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
  };
});
