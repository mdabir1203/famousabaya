[![Labeler](https://github.com/mdabir1203/famousabaya/actions/workflows/label.yml/badge.svg?event=release)](https://github.com/mdabir1203/famousabaya/actions/workflows/label.yml)
[![SLSA generic generator](https://github.com/mdabir1203/famousabaya/actions/workflows/generator-generic-ossf-slsa3-publish.yml/badge.svg?event=release)](https://github.com/mdabir1203/famousabaya/actions/workflows/generator-generic-ossf-slsa3-publish.yml)

## Single EXE installer workflow

For a Windows client deployment, use the packaged launcher installer:

```bash
yarn package:installer:win
```

This runs the Windows installer build script and produces a bundled NSIS installer under dist/desktop-launcher/ when built on a Windows host. The packaged app includes the full repo runtime (server, install scripts, config, docs, and the launcher itself), so the first launch can start the server without a separate manual dependency install.

If you are building from Linux or a machine without the Windows signing/symlink prerequisites, the script falls back to a portable zip build in dist/desktop-launcher/.
