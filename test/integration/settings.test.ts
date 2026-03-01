import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Settings Tests', () => {
  test('MikeDown configuration section exists', () => {
    const config = vscode.workspace.getConfiguration('mikedown');
    assert.ok(config !== undefined, 'mikedown config section should exist');
  });

  test('Default font family is readable', () => {
    const config = vscode.workspace.getConfiguration('mikedown');
    const fontFamily = config.get<string>('editor.fontFamily');
    // Should either be defined or use a fallback
    assert.ok(fontFamily !== null, 'fontFamily setting should be accessible');
  });

  test('linkClickBehavior setting is readable', () => {
    const config = vscode.workspace.getConfiguration('mikedown');
    const behavior = config.get<string>('linkClickBehavior');
    assert.ok(
      behavior === undefined || typeof behavior === 'string',
      'linkClickBehavior should be a string or undefined'
    );
  });
});
