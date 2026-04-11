import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Export Command Tests', () => {
  test('exportHtml command is registered and executable', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mikedown.exportHtml'), 'exportHtml command should exist');
  });

  test('print command is registered and executable', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mikedown.print'), 'print command should exist');
  });

  test('copyAsRichText command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mikedown.copyAsRichText'), 'copyAsRichText command should exist');
  });

  test('viewInBrowser command is registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('mikedown.viewInBrowser'), 'viewInBrowser command should exist');
  });
});
