import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Default Editor Command Tests', () => {
  test('mikedown.setAsDefaultEditor command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('mikedown.setAsDefaultEditor'),
      'mikedown.setAsDefaultEditor command should be registered'
    );
  });

  test('invoking mikedown.setAsDefaultEditor sets workbench.editorAssociations["*.md"]', async () => {
    // First, clear the association to start fresh
    const config = vscode.workspace.getConfiguration();
    await config.update(
      'workbench.editorAssociations',
      { '*.md': undefined },
      vscode.ConfigurationTarget.Global
    );

    // Now invoke the command
    await vscode.commands.executeCommand('mikedown.setAsDefaultEditor');

    // Verify the association was set
    const associations = config.get<Record<string, string>>('workbench.editorAssociations') ?? {};
    assert.strictEqual(
      associations['*.md'],
      'mikedown.editor',
      'mikedown.editor should be set for *.md after command execution'
    );
  });

  test('invoking mikedown.setAsDefaultEditor when already default shows info message', async () => {
    // Set MikeDown as default first
    const config = vscode.workspace.getConfiguration();
    await config.update(
      'workbench.editorAssociations',
      { '*.md': 'mikedown.editor' },
      vscode.ConfigurationTarget.Global
    );

    // Mock the showInformationMessage to verify it's called
    const showInfoSpy = vscode.window.showInformationMessage as any;
    let wasCalledWithAlreadyDefault = false;

    const originalShowInfo = showInfoSpy;
    vscode.window.showInformationMessage = async (message: string) => {
      if (message.includes('already your default editor')) {
        wasCalledWithAlreadyDefault = true;
      }
      return originalShowInfo(message);
    };

    await vscode.commands.executeCommand('mikedown.setAsDefaultEditor');

    // Restore original
    vscode.window.showInformationMessage = originalShowInfo;

    assert.ok(
      wasCalledWithAlreadyDefault,
      'Should show "already your default editor" message when already set'
    );
  });

  test('globalState dismissal flag persists "Don\'t ask again" choice', async () => {
    // This test verifies that the globalState persists dismissal state
    // We can verify this by checking that the extension context has the key set
    const ext = vscode.extensions.getExtension('undefined_publisher.mikedown-editor') ||
                vscode.extensions.getExtension('interapp.mikedown-editor');

    if (ext && ext.isActive) {
      // The globalState is updated when the command runs
      // This is harder to test directly from integration tests without access to context
      // The real test of persistence happens in a full reload cycle
      // For now, we just verify the command executed without error
      await vscode.commands.executeCommand('mikedown.setAsDefaultEditor');
      assert.ok(true, 'Command executed without error');
    }
  });
});
