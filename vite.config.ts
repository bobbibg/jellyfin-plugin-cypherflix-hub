import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Build pipeline for Cypherflix Hub's frontend.
 *
 *   Web/                           → ts/css source
 *     bootstrap.ts                 ← entry point loaded by Plugin Pages
 *     pages/*.ts                   ← route handlers
 *     components/*.ts              ← shared UI primitives
 *     state/*.ts                   ← cross-page state
 *     types/*.ts                   ← shared types
 *     styles/*.css                 ← stylesheet
 *
 *   dist/
 *     cypherflix-hub.[hash].js     ← single bundle (cache-busted by hash)
 *     cypherflix-hub.[hash].css
 *     manifest.json                ← maps logical names → hashed filenames
 *
 * The C# DLL embeds dist/** as resources. WebController serves them at
 * /CypherflixHub/Web/cypherflix-hub.[hash].js so plugins/extensions can
 * reach a deterministic URL per-build.
 *
 * IMPORTANT: keep this a SINGLE bundle (no chunking). Jellyfin's WebController
 * exposes resources by static name; multi-chunk builds would need a more
 * elaborate routing layer that's not worth it for our size.
 */
export default defineConfig({
    root: resolve(import.meta.dirname, 'Web'),
    base: '/CypherflixHub/Web/',  // matches the WebController route prefix
    build: {
        // Output under Web/dist/ so the C# csproj can embed it as
        // Jellyfin.Plugin.CypherflixHub.Web.dist.* resources alongside the
        // Configuration HTML, with a single shared <EmbeddedResource> rule.
        outDir: resolve(import.meta.dirname, 'Web/dist'),
        emptyOutDir: true,
        // Force the flat path. Vite 5's default for `manifest: true` is
        // `dist/.vite/manifest.json`, but our C# WebController loads the
        // embedded resource `Jellyfin.Plugin.CypherflixHub.Web.dist.manifest.json`
        // (flat) and the csproj's WarnIfNoBundle target checks the same path.
        // A string value here makes Vite write `dist/<that-name>` directly.
        manifest: 'manifest.json',
        sourcemap: true,           // ship maps so devtools shows TS in stack traces
        cssCodeSplit: false,       // single bundle.css
        rollupOptions: {
            input: resolve(import.meta.dirname, 'Web/bootstrap.ts'),
            output: {
                entryFileNames: 'cypherflix-hub.[hash].js',
                chunkFileNames: 'cypherflix-hub.[hash].js',
                assetFileNames: (info) => {
                    if (info.name && info.name.endsWith('.css')) {
                        return 'cypherflix-hub.[hash].css';
                    }
                    return 'assets/[name].[hash][extname]';
                },
                manualChunks: undefined,  // disable chunking — single file
            },
        },
        target: 'es2022',
        minify: 'esbuild',
    },
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, 'Web'),
        },
    },
});
