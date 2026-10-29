// Dev-only helper loaded by capture.sh as a second --extensionDevelopmentPath.
// Reads the shot plan the script wrote, stages the window, then signals back.
// Does nothing when there is no plan, so it is inert anywhere else.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const DIR = process.env.MDSHOTS_DIR || '/tmp/mdshots';
const PLAN = path.join(DIR, 'shot.json');
const STAGED = path.join(DIR, 'staged');
const QUIT = path.join(DIR, 'quit');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args).then(undefined, err => log(`${cmd}: ${err}`));
const log = msg => fs.appendFileSync(path.join(DIR, 'stager.log'), `${new Date().toISOString()} ${msg}\n`);

async function activate() {
  if (!fs.existsSync(PLAN)) {return;}
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {log('no workspace folder'); return;}

  await run('workbench.action.closeAllEditors');
  await run('workbench.action.closePanel');
  await run('workbench.action.closeAuxiliaryBar');
  if (plan.layout) {await run('vscode.setEditorLayout', plan.layout);}

  for (const item of plan.open || []) {
    const uri = vscode.Uri.joinPath(root, item.file);
    const column = item.group || 1;
    if (item.editor === 'text') {
      await run('vscode.openWith', uri, 'default', { viewColumn: column, preview: false });
    } else {
      await run('vscode.openWith', uri, 'mikedown.editor', { viewColumn: column, preview: false });
    }
    await sleep(400);
  }

  await run(plan.explorer ? 'workbench.view.explorer' : 'workbench.action.closeSidebar');
  await run('workbench.action.focusFirstEditorGroup');
  // Webviews need a moment before they take host commands.
  await sleep(plan.commandDelayMs || 2500);
  for (const cmd of plan.commands || []) {
    await run(cmd);
    await sleep(500);
  }
  fs.writeFileSync(STAGED, String(Date.now()));
  log(`staged ${plan.name}`);

  // capture.sh touches <dir>/quit to close this instance cleanly.
  const timer = setInterval(() => {
    if (fs.existsSync(QUIT)) {clearInterval(timer); run('workbench.action.quit');}
  }, 500);
}

module.exports = { activate, deactivate() {} };
