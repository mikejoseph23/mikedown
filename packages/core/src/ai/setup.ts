/**
 * The setup wizard's first decision, as plain data: which path to offer
 * first (a running local server, VS Code's Copilot models, or a cloud
 * provider), whether this machine can run models locally, and how big a
 * model fits (OQ11, OQ13). No DOM, no network: the host reports the
 * hardware (`hardwareInfo`), the running servers (`detectLocalServers`) and
 * its built-in models (`detectHostEngines`).
 *
 * Every size here is a hint for a 4-bit quantised model, never a gate: the
 * user can pick any model.
 */

import { AI_ENGINE_PRESETS } from './presets';
import type { AiHardwareInfo, AiHostEngineProbe, AiLocalServerProbe } from './types';

const GIB = 1024 ** 3;

/** Reported memory runs a little under the nominal size (firmware, the iGPU's share): 31.3 GiB is a 32 GB machine. */
const NOMINAL_SLACK = 0.94;

/** OQ11: Apple Silicon with this much unified memory can run local models. */
export const AI_LOCAL_MIN_UNIFIED_GB = 16;
/** OQ11: any machine with this much memory can. */
export const AI_LOCAL_MIN_MEMORY_GB = 32;
/** OQ11: or an NVIDIA GPU with this much video memory (Desktop only, where it can be read). */
export const AI_LOCAL_MIN_VRAM_GB = 8;

export type AiSetupPath = 'runningLocal' | 'vscodeLm' | 'cloud';

export interface AiSetupInput {
  /** `detectLocalServers` results (every candidate, running or not). */
  running: readonly AiLocalServerProbe[];
  /** `hardwareInfo()`, or null when the host cannot tell. */
  hardware: AiHardwareInfo | null;
  /** VS Code only: whether `vscode.lm` offers a Copilot model (see `vscodeLmAvailability`). */
  vscodeLm?: { available: boolean; models: number };
}

export interface AiSetupRecommendation {
  /** What the wizard offers first. */
  path: AiSetupPath;
  /** OQ11: this machine is above the threshold, so local is shown as an option (still under Advanced unless a server runs). */
  localCapable: boolean;
  /** The model-size sentence for this machine (OQ11); empty without hardware info. */
  localHint: string;
  /**
   * Step 1's hardware line: "Local is an option on this machine: Apple
   * Silicon, 32 GB. Models up to about 30B parameters run well." when
   * capable, the small-machine sentence when not, empty without hardware
   * info.
   */
  hardwareLine: string;
  /** `runningLocal`: the server to offer (most models first, then preset order). */
  running?: AiLocalServerProbe;
  /** Why, one short sentence per signal checked, in order (for tooltips, logs and tests). */
  reasons: string[];
}

/** Bytes to gigabytes, for display ("32 GB"). */
export function formatMemoryGb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / GIB))} GB`;
}

function atLeastGb(bytes: number | undefined, gb: number): boolean {
  return typeof bytes === 'number' && bytes >= gb * GIB * NOMINAL_SLACK;
}

function nvidiaVram(hw: AiHardwareInfo): number | undefined {
  return hw.gpu?.vendor === 'nvidia' ? hw.gpu.vramBytes : undefined;
}

/** OQ11's threshold: Apple Silicon with 16 GB or more, any machine with 32 GB or more, or an NVIDIA GPU with 8 GB of VRAM or more. */
export function isLocalCapable(hw: AiHardwareInfo | null): boolean {
  if (!hw) {return false;}
  if (hw.appleSilicon && atLeastGb(hw.totalMemoryBytes, AI_LOCAL_MIN_UNIFIED_GB)) {return true;}
  if (atLeastGb(hw.totalMemoryBytes, AI_LOCAL_MIN_MEMORY_GB)) {return true;}
  return atLeastGb(nvidiaVram(hw), AI_LOCAL_MIN_VRAM_GB);
}

/**
 * The memory a local model runs in: unified memory on Apple Silicon, an
 * NVIDIA card's VRAM when the host read it, else system memory (CPU
 * inference: slower, but it runs).
 */
export function modelMemoryBytes(hw: AiHardwareInfo): number {
  if (hw.appleSilicon) {return hw.totalMemoryBytes;}
  const vram = nvidiaVram(hw);
  return typeof vram === 'number' && vram > 0 ? vram : hw.totalMemoryBytes;
}

type Band = 'small' | 'medium' | 'large';

/** OQ11's bands: under 24 GB, 24 to 48 GB, above. */
function memoryBand(bytes: number): Band {
  if (!atLeastGb(bytes, 24)) {return 'small';}
  return atLeastGb(bytes, 48) ? 'large' : 'medium';
}

const SIZE_SENTENCES: Readonly<Record<Band, string>> = {
  small: 'Models up to about 8B parameters run well.',
  medium: 'Models up to about 30B parameters run well.',
  large: 'Larger models work, well beyond 30B parameters.',
};

/** OQ11's model-size sentence for a machine ("Models up to about 30B parameters run well."); empty for null. */
export function localSizeHint(hw: AiHardwareInfo | null): string {
  return hw ? SIZE_SENTENCES[memoryBand(modelMemoryBytes(hw))] : '';
}

/** "Apple Silicon, 32 GB", "64 GB of memory, NVIDIA GeForce RTX 4090 (24 GB)", "16 GB of memory". */
export function describeHardware(hw: AiHardwareInfo): string {
  if (hw.appleSilicon) {return `Apple Silicon, ${formatMemoryGb(hw.totalMemoryBytes)}`;}
  const parts = [`${formatMemoryGb(hw.totalMemoryBytes)} of memory`];
  if (hw.gpu && hw.gpu.vendor !== 'apple') {
    const name = hw.gpu.name?.trim() || (hw.gpu.vendor === 'nvidia' ? 'NVIDIA GPU' : hw.gpu.vendor === 'amd' ? 'AMD GPU' : 'GPU');
    parts.push(hw.gpu.vramBytes ? `${name} (${formatMemoryGb(hw.gpu.vramBytes)})` : name);
  }
  return parts.join(', ');
}

/** Shown on a machine below the OQ11 threshold. */
export const AI_LOCAL_SMALL_MACHINE = 'This machine is on the small side for local models; cloud is the easier path.';

/** Added when the host read no GPU (VS Code reads none): the hint comes from memory alone. */
export const AI_LOCAL_ROUGH_GUESS = 'A rough guess from memory alone; the graphics card was not checked.';

function hardwareLine(hw: AiHardwareInfo | null, capable: boolean): string {
  if (!hw) {return '';}
  if (!capable) {return AI_LOCAL_SMALL_MACHINE;}
  const rough = !hw.appleSilicon && !hw.gpu ? ` ${AI_LOCAL_ROUGH_GUESS}` : '';
  return `Local is an option on this machine: ${describeHardware(hw)}. ${localSizeHint(hw)}${rough}`;
}

/** A server that answered and lists at least one model (or did not say how many). */
function isUsableServer(p: AiLocalServerProbe): boolean {
  return p.ok && p.models !== 0;
}

function presetName(id: string): string {
  return AI_ENGINE_PRESETS.find((p) => p.id === id)?.name ?? id;
}

function modelsText(n: number | undefined): string {
  return n === undefined ? '' : ` with ${n} ${n === 1 ? 'model' : 'models'}`;
}

/**
 * The wizard's path, checked in order (OQ13):
 *
 * a. a local server is running and lists models → offer it first;
 * b. VS Code offers a Copilot model (`vscode-lm`, OQ12) → offer it first;
 * c. this machine is above the OQ11 threshold → cloud first, with "Local is
 *    an option on this machine" shown;
 * d. otherwise cloud, with local under Advanced and no hint.
 *
 * `localCapable`, `localHint` and `hardwareLine` are filled whatever the path.
 */
export function recommendSetupPath(input: AiSetupInput): AiSetupRecommendation {
  const hw = input.hardware;
  const localCapable = isLocalCapable(hw);
  const base = { localCapable, localHint: localSizeHint(hw), hardwareLine: hardwareLine(hw, localCapable) };
  const reasons: string[] = [];

  const servers = input.running
    .map((probe, index) => ({ probe, index }))
    .filter(({ probe }) => isUsableServer(probe))
    .sort((a, b) => (b.probe.models ?? 0) - (a.probe.models ?? 0) || a.index - b.index);
  if (servers.length > 0) {
    const first = servers[0].probe;
    reasons.push(`${presetName(first.presetId)} is running on this machine${modelsText(first.models)}.`);
    return { path: 'runningLocal', ...base, running: first, reasons };
  }
  const idle = input.running.filter((p) => p.ok && p.models === 0);
  reasons.push(idle.length > 0
    ? `${idle.map((p) => presetName(p.presetId)).join(' and ')} answered but lists no models.`
    : 'No local model server is running.');

  if (input.vscodeLm?.available && input.vscodeLm.models > 0) {
    reasons.push(`GitHub Copilot offers ${input.vscodeLm.models} ${input.vscodeLm.models === 1 ? 'model' : 'models'} in VS Code.`);
    return { path: 'vscodeLm', ...base, reasons };
  }
  if (input.vscodeLm) {reasons.push('GitHub Copilot offers no model in VS Code.');}

  if (!hw) {
    reasons.push('The host did not report this machine’s hardware.');
  } else {
    reasons.push(localCapable
      ? `${describeHardware(hw)} can run local models.`
      : `${describeHardware(hw)} is below the threshold for local models.`);
  }
  return { path: 'cloud', ...base, reasons };
}

/** The recommendation's `vscodeLm` input from `detectHostEngines` results. */
export function vscodeLmAvailability(probes: readonly AiHostEngineProbe[] | null | undefined): { available: boolean; models: number } {
  const probe = probes?.find((p) => p.kind === 'vscode-lm');
  return { available: !!probe?.ok && probe.models > 0, models: probe?.ok ? probe.models : 0 };
}

// ── Model size tags ──────────────────────────────────────────────────────────

/**
 * A model's parameter count in billions, from its id: `7b`, `30b`, `1.5b`,
 * `270m`, a mixture `8x7b` (total). The first count wins, so `30b-a3b`
 * (active parameters) reads 30. Null when the id names none.
 */
export function modelParamsBillions(id: string): number | null {
  const s = id.toLowerCase();
  const moe = /(?:^|[^a-z0-9.])(\d+)x(\d+(?:\.\d+)?)b(?![a-z0-9])/.exec(s);
  if (moe) {return Number(moe[1]) * Number(moe[2]);}
  const m = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)([bm])(?![a-z0-9])/.exec(s);
  if (!m) {return null;}
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) {return null;}
  return m[2] === 'm' ? n / 1000 : n;
}

export type AiModelSizeTag = 'fits' | 'tight' | 'too large';

/** A model this much over the "fits" size is still worth a try. */
const TIGHT_FACTOR = 1.75;

/** The largest model (billions) that runs well, by OQ11's bands; small machines scale down with memory. */
function fitsBillions(memoryBytes: number): number {
  const gb = memoryBytes / GIB;
  switch (memoryBand(memoryBytes)) {
    case 'small':
      return Math.min(8, gb / 2);
    case 'medium':
      return 30;
    case 'large':
      return gb * 1.1;
  }
}

/**
 * "fits", "tight" or "too large" for a model on this machine, from the
 * parameter count in its id (OQ11's bands, 4-bit). Undefined when the id has
 * no count or the hardware is unknown: no tag. A hint only; nothing is
 * blocked.
 */
export function modelSizeHint(id: string, hardware: AiHardwareInfo | null): AiModelSizeTag | undefined {
  if (!hardware) {return undefined;}
  const params = modelParamsBillions(id);
  if (params === null) {return undefined;}
  const fits = fitsBillions(modelMemoryBytes(hardware));
  if (params <= fits) {return 'fits';}
  return params <= fits * TIGHT_FACTOR ? 'tight' : 'too large';
}
