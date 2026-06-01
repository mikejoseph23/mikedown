//@ts-check

'use strict';

const path = require('path');

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node',
  mode: 'none',

  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log'
  }
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  target: 'web',
  mode: 'none',

  entry: './src/webview/editor-main.ts',
  output: {
    path: path.resolve(__dirname, 'out', 'webview'),
    filename: 'editor-main.js'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    // Prefer ES module entry points over UMD/CommonJS. Without this, webpack
    // resolves tiptap-markdown's "main" field (UMD build) which has a broken
    // UMD factory — `this` is `undefined` in webpack's web target strict mode,
    // so the factory receives `undefined` for all its dependency parameters.
    mainFields: ['module', 'browser', 'main'],
    alias: {
      '@tiptap/core': path.resolve(__dirname, 'node_modules', '@tiptap', 'core'),
      '@tiptap/pm': path.resolve(__dirname, 'node_modules', '@tiptap', 'pm'),
      // Force the ES module build of tiptap-markdown (the UMD build breaks
      // because webpack's web target sets `this` to `undefined` in strict mode)
      'tiptap-markdown': path.resolve(__dirname, 'node_modules', 'tiptap-markdown', 'dist', 'tiptap-markdown.es.js'),
    }
  },
  module: {
    // mermaid lazy-loads its diagram types via dynamic import(). The webview is
    // a single <script> under a strict CSP (script-src self only) with no
    // publicPath, so runtime chunk loading can't work. Force every dynamic
    // import to be inlined into the one bundle instead of code-split.
    parser: {
      javascript: {
        dynamicImportMode: 'eager'
      }
    },
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              // Use the webview-specific tsconfig (includes DOM lib)
              configFile: 'tsconfig.webview.json',
              // Transpile only — skip full type-checking for faster builds
              transpileOnly: true
            }
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log'
  }
};

module.exports = [extensionConfig, webviewConfig];
