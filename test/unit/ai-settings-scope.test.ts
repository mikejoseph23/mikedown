/**
 * Scope of the AI settings in package.json: the ones that decide where text can
 * go are machine scope, so a repository's .vscode/settings.json cannot turn
 * cloud on or add an endpoint.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
const props: Record<string, any> = pkg.contributes.configuration.properties;

describe('package.json scopes for the AI settings', () => {
  it('mikedown.ai.allowCloud is machine scope and off by default', () => {
    expect(props['mikedown.ai.allowCloud'].scope).toBe('machine');
    expect(props['mikedown.ai.allowCloud'].default).toBe(false);
  });

  it('mikedown.ai.engines is machine scope', () => {
    expect(props['mikedown.ai.engines'].scope).toBe('machine');
  });

  it('no AI setting stores a secret: key properties only name where to look', () => {
    const engineProps = props['mikedown.ai.engines'].items.properties as Record<string, unknown>;
    expect(Object.keys(engineProps)).not.toContain('apiKey');
    expect(Object.keys(props).filter((k) => /^mikedown\.ai\..*(apiKey|secret|token)$/i.test(k))).toEqual([]);
  });
});
