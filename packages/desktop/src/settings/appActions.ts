/**
 * Actions behind the App tab's buttons: the app version, "Check for
 * Updates…" and "Set MikeDown as default for .md". "Check for Updates…" is
 * the updater controller's manual check (`src/app/updater.ts`), which gives
 * explicit feedback for every outcome.
 */
import type { Dialogs } from '../ui/dialogs';

export interface AppActionsDeps {
  dialogs: Pick<Dialogs, 'toast' | 'info'>;
  isMac: boolean;
  appVersion(): Promise<string>;
  /** The updater's manual check (`UpdaterController.manualCheck`). */
  manualUpdateCheck(): Promise<void>;
  openDefaultAppsSettings(): Promise<boolean>;
  /** Remember that the offer was made (`fileAssociationsOffered`). */
  markAssociationsOffered(): void;
}

export interface AppActions {
  version(): Promise<string>;
  checkForUpdates(): Promise<void>;
  setDefaultApp(): Promise<void>;
}

export const MAC_DEFAULT_APP_STEPS =
  'In Finder, select any .md file, choose File > Get Info, pick MikeDown under "Open with", then click "Change All…" and confirm.';

export function createAppActions(deps: AppActionsDeps): AppActions {
  return {
    version: () => deps.appVersion(),
    checkForUpdates: () => deps.manualUpdateCheck(),
    async setDefaultApp() {
      deps.markAssociationsOffered();
      if (deps.isMac) {
        await deps.dialogs.info(MAC_DEFAULT_APP_STEPS, 'Set MikeDown as the default for .md');
        return;
      }
      try {
        if (await deps.openDefaultAppsSettings()) {
          deps.dialogs.toast('Choose MikeDown for .md files under Default apps.');
          return;
        }
      } catch { /* fall through to the instructions */ }
      await deps.dialogs.info('Open Settings > Apps > Default apps, search for ".md" and choose MikeDown.', 'Set MikeDown as the default for .md');
    },
  };
}
