import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('File Handling Tests', () => {
  const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const sampleFile = path.join(workspaceRoot, 'sample.md');

  test('Opening .md file does not dirty the document', async () => {
    const doc = await vscode.workspace.openTextDocument(sampleFile);
    assert.strictEqual(doc.isDirty, false, 'Document should not be dirty on open');
  });

  test('Document has markdown language ID', async () => {
    const doc = await vscode.workspace.openTextDocument(sampleFile);
    assert.strictEqual(doc.languageId, 'markdown');
  });

  test('Document content is readable', async () => {
    const doc = await vscode.workspace.openTextDocument(sampleFile);
    const text = doc.getText();
    assert.ok(text.length > 0, 'Document should have content');
    assert.ok(text.includes('# Sample Document'), 'Should contain heading');
  });

  test('Workspace edit saves without error', async () => {
    const doc = await vscode.workspace.openTextDocument(sampleFile);
    const originalText = doc.getText();
    // Make a trivial edit and save
    const edit = new vscode.WorkspaceEdit();
    const lastLine = doc.lineCount - 1;
    const lastChar = doc.lineAt(lastLine).text.length;
    edit.insert(doc.uri, new vscode.Position(lastLine, lastChar), '\n');
    const success = await vscode.workspace.applyEdit(edit);
    assert.ok(success, 'Edit should succeed');
    // Restore
    const restoreEdit = new vscode.WorkspaceEdit();
    const newDoc = await vscode.workspace.openTextDocument(sampleFile);
    restoreEdit.replace(doc.uri, new vscode.Range(0, 0, newDoc.lineCount, 0), originalText);
    await vscode.workspace.applyEdit(restoreEdit);
    await newDoc.save();
  });
});
