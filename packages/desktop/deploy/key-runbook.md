# Updater signing key runbook

The MikeDown updater accepts only updates signed by this minisign key. Lose the
key or its password and every installed copy can never update again, so keep
two independent backups. No secret values belong in this file or in git.

## What the key is

| Item | Value |
| --- | --- |
| Key file | `~/.tauri/mikedown.key` on the Mac Studio (`michaeljosephwork`) |
| Override env vars | `TAURI_SIGNING_PRIVATE_KEY_PATH`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Password | login Keychain, generic password, service `mikedown-updater-key` |
| Public key id | `C5386105C2C03AF7` |
| Public key | `plugins.updater.pubkey` in `packages/desktop/src-tauri/tauri.conf.json` (not secret) |

Check that both halves exist without printing the secret:

```bash
test -f ~/.tauri/mikedown.key && echo "key file present"
security find-generic-password -s mikedown-updater-key >/dev/null 2>&1 && echo "keychain item present"
```

The Windows installer is signed for the updater on the Mac after it comes back
from BEAST (`release.sh`), so the key never leaves the Mac.

## Backups (to be filled in by Mike)

Nothing below is confirmed. Fill in each line when it is done, and tick the
release blocker in `desktop-auto-update-plan.md` (U5) only after Mike confirms.

- Key file backup 1: network drive, `interapp/mikedown.key` (mounted on the Mac Studio as `/Volumes/Storage-1`), byte-identical to the live key (confirmed by Mike on 2026-10-24)
- Key file backup 2: ____ (confirmed by Mike on ____)
- Keychain password backup 1 (password manager entry name): LastPass, "MikeDown Note" (confirmed by Mike on 2026-10-24)
- Keychain password backup 2: ____ (confirmed by Mike on ____)
- Restore test (a throwaway file signed with the restored key verifies against
  the pubkey above): passed. Signed with the network-drive copy and the Keychain password, then verified against key id `C5386105C2C03AF7` with `lib/verify-cli.js` (done by the orchestrator on 2026-10-24)

Rules for the backups:

- Keep the key file and the password in different places.
- Store them outside the Mac Studio's disk, since the Mac is the only machine
  that holds the live copy.
- Never paste the key or the password into chat, git, a ticket, or a log.

## Routine use

`release.sh` checks for the key and the Keychain item before it builds
anything. A missing item stops the release with the message "Keychain item
mikedown-updater-key (the key's password) not found". Restore from backup
before retrying. Do not generate a new key to get past the error, because
installed copies would reject it.

## Rotation (not built; only if the key is lost or compromised)

The plan's bridge pattern, as written in `desktop-auto-update-plan.md`
("Signing and key continuity"):

1. Release N is signed with the old key, and it ships the new public key in
   `tauri.conf.json`. Installed copies verify it with the old key they already
   hold.
2. Every release after N is signed with the new key.
3. Installs that skip N can't jump straight to N+1, so N's files stay published
   under the old key as a bridge.

Open point before any rotation: the endpoint list in `tauri.conf.json` falls
through only on a fetch or parse failure, not on a bad signature. So an install
on an old key that reads `latest-<target>-<arch>.json` and finds an N+1 manifest
signed with the new key will refuse it, and the bridge needs a way to reach N's
manifest. That mechanism is not built. Decide it, and test it with
`updater-staging-test.sh` (the "other key" case), before rotating.

If the key is compromised rather than lost, the bridge is not enough to protect
users who skip N. Treat that as a separate incident.
