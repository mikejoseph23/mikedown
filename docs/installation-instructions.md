# Installation Instructions

## Dogfooding daily (symlink approach)

This makes your dev copy load automatically every time you open VS Code.

```bash
# Build the extension
cd /path/to/markdown-WYSIWYG-vscode-extension
npm run compile

# Symlink into VS Code's extensions directory
ln -s "$(pwd)" "$HOME/.vscode/extensions/mikedown.mikedown-editor-0.1.0"
```

Restart VS Code. It will pick up the extension on every launch.

When you make changes, rebuild and reload VS Code (`Cmd+Shift+P` > "Developer: Reload Window").

To remove it later, just delete the symlink:

```bash
rm "$HOME/.vscode/extensions/mikedown.mikedown-editor-0.1.0"
```

## Sharing with friends (.vsix package)

### Building the package

```bash
# Install the packager (one-time)
npm install -g @vscode/vsce

# Package it from the project root
cd /path/to/markdown-WYSIWYG-vscode-extension
vsce package
```

This creates `mikedown-editor-0.1.0.vsix`.

### Installing the .vsix

Send the `.vsix` file to your friends. They can install it either way:

**Command line:**

```bash
code --install-extension mikedown-editor-0.1.0.vsix
```

**VS Code UI:**

`Cmd+Shift+P` > "Extensions: Install from VSIX..." and select the file.

### Uninstalling

```bash
code --uninstall-extension mikedown.mikedown-editor
```

Or find it in the Extensions sidebar and click Uninstall.
