# Language servers

Tungsten bundles the TypeScript language server and can connect to language servers installed on the computer.

| Language | Executable |
| --- | --- |
| JavaScript / TypeScript | Bundled `typescript-language-server` |
| Python | `pylsp` |
| Rust | `rust-analyzer` |
| Go | `gopls` |
| C / C++ | `clangd` |
| Java | `jdtls` |
| C# | `omnisharp` |
| Ruby | `solargraph` |
| PHP | `intelephense` |
| Kotlin | `kotlin-language-server` |
| Lua | `lua-language-server` |

When a supported file is opened, Tungsten starts the matching server on demand. Completion, hover information, and diagnostics are bridged into Monaco. If an external server is unavailable, editing and bundled syntax highlighting continue normally.
