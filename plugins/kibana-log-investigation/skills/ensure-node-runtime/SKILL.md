---
name: ensure-node-runtime
description: Check or install Node.js 22+ at user scope.
---

# Ensure Node Runtime

Run these before building the cloned repository:

```bash
node --version
npm --version
```

If both work and Node is 22+, stop. Otherwise install at user scope with `fnm`; avoid system-wide installs. Choose the section matching the OS and shell.

## Windows: PowerShell

1. If `fnm` is missing, run `winget install Schniz.fnm`. If winget is blocked or unavailable, download the official Windows `fnm` release binary, extract it under the user's home, and add that directory to the user PATH. Do not assume Scoop exists.
2. Configure the current session:

   ```powershell
   fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
   ```

3. Create `$PROFILE` if needed. Add that same line once for future sessions.
4. [Install and verify Node](#install-and-verify-node).

## macOS or Linux

1. If `fnm` is missing, run its official user-level installer:

   ```bash
   curl -fsSL https://fnm.vercel.app/install | bash
   ```

2. Configure the active shell; add the same line once to its startup file.

   | Shell | Current session | Startup file |
   | --- | --- | --- |
   | Bash | `eval "$(fnm env --use-on-cd)"` | `~/.bashrc` |
   | Zsh | `eval "$(fnm env --use-on-cd)"` | `~/.zshrc` |
   | Fish | `fnm env --use-on-cd \| source` | `~/.config/fish/config.fish` |

3. [Install and verify Node](#install-and-verify-node).

## Install and verify Node

1. Install the repository's Node major:

   ```bash
   fnm install 22
   fnm default 22
   ```

   In the checkout, `fnm use --install-if-missing` also reads `.node-version`.

2. Verify the selected runtime:

   ```bash
   fnm --version
   node --version
   npm --version
   ```

   Node must report 22+ and npm must work. If PATH has not refreshed, restart the terminal or Codex and check again.

3. Continue setup:

   ```bash
   npm install
   npm run build
   ```
