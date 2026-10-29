import * as nodeOs from 'os';
import type { AiHardwareInfo } from '@mikedown/core/ai';

/**
 * This machine's memory and CPU for the setup wizard's "can it run models
 * locally" hint (`recommendSetupPath` in core). Pure Node, no `vscode`
 * import; `os` and `process` are injectable for tests. No GPU probe: VS Code
 * has no cheap way to read one, so the hint says it is a rough call (Apple
 * Silicon is the exception, where the GPU shares the memory).
 */

export interface HardwareDeps {
  os: Pick<typeof nodeOs, 'totalmem' | 'cpus'>;
  process: Pick<NodeJS.Process, 'arch' | 'platform'>;
}

export function readHardwareInfo(deps: HardwareDeps = { os: nodeOs, process }): AiHardwareInfo {
  const { arch, platform } = deps.process;
  const appleSilicon = platform === 'darwin' && arch === 'arm64';
  const info: AiHardwareInfo = { arch, platform, totalMemoryBytes: deps.os.totalmem(), appleSilicon };
  let cpu = '';
  try {
    cpu = deps.os.cpus()[0]?.model?.trim() ?? '';
  } catch {
    // Some sandboxes refuse; the CPU name is only for the log line.
  }
  if (cpu) {info.cpu = cpu;}
  if (appleSilicon) {info.gpu = { vendor: 'apple', vramBytes: info.totalMemoryBytes, ...(cpu ? { name: cpu } : {}) };}
  return info;
}

/** One output-channel line: "Hardware: darwin arm64, Apple M2 Max, 32 GB, Apple Silicon". */
export function hardwareLogLine(info: AiHardwareInfo): string {
  const gb = Math.round(info.totalMemoryBytes / 1024 ** 3);
  const parts = [`${info.platform} ${info.arch}`];
  if (info.cpu) {parts.push(info.cpu);}
  parts.push(`${gb} GB`);
  parts.push(info.appleSilicon ? 'Apple Silicon' : 'GPU not checked');
  return `Hardware: ${parts.join(', ')}`;
}
