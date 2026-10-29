/**
 * VS Code's hardware read for the setup wizard: `readHardwareInfo` from faked
 * `os` and `process` values, the output channel line, and the engine
 * service's `hardwareInfo` (read once, logged once, null when it cannot be
 * read). The adapter and bridge parts are in ai-vscodeLm.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import { isLocalCapable, parseAiSettings, recommendSetupPath, type AiHardwareInfo } from '@mikedown/core/ai';
import { AiEngineService } from '../../src/ai/engineService';
import { hardwareLogLine, readHardwareInfo, type HardwareDeps } from '../../src/ai/hardware';
import { AiSecrets } from '../../src/ai/secrets';

const GB = 1024 ** 3;
const read = (platform: string, arch: string, gb: number, cpus: Array<{ model?: string }> | (() => never) = [{ model: 'Some CPU' }]): AiHardwareInfo =>
  readHardwareInfo({
    os: { totalmem: () => gb * GB, cpus: (typeof cpus === 'function' ? cpus : () => cpus) as HardwareDeps['os']['cpus'] },
    process: { arch, platform } as HardwareDeps['process'],
  });

describe('readHardwareInfo', () => {
  it('reads memory, platform, architecture and the first CPU', () => {
    expect(read('linux', 'x64', 16, [{ model: ' AMD Ryzen 7 ' }, { model: 'other' }])).toEqual({
      arch: 'x64', platform: 'linux', totalMemoryBytes: 16 * GB, appleSilicon: false, cpu: 'AMD Ryzen 7',
    });
  });

  it('is Apple Silicon only on macOS arm64, and then reports the shared memory as the GPU\'s', () => {
    const m2 = read('darwin', 'arm64', 32, [{ model: 'Apple M2 Max' }]);
    expect(m2).toMatchObject({ appleSilicon: true, gpu: { vendor: 'apple', vramBytes: 32 * GB, name: 'Apple M2 Max' } });
    for (const [platform, arch] of [['darwin', 'x64'], ['linux', 'arm64'], ['win32', 'arm64'], ['win32', 'x64']] as const) {
      const info = read(platform, arch, 32);
      expect(info.appleSilicon, `${platform} ${arch}`).toBe(false);
      expect(info.gpu, `${platform} ${arch}`).toBeUndefined();
    }
  });

  it('leaves the CPU out when there is none to read, it has no name, or the OS refuses', () => {
    expect(read('linux', 'x64', 8, [])).not.toHaveProperty('cpu');
    expect(read('linux', 'x64', 8, [{}])).not.toHaveProperty('cpu');
    expect(read('linux', 'x64', 8, [{ model: '   ' }])).not.toHaveProperty('cpu');
    const refused = read('linux', 'x64', 8, () => { throw new Error('EPERM'); });
    expect(refused).toMatchObject({ platform: 'linux', totalMemoryBytes: 8 * GB });
    expect(refused).not.toHaveProperty('cpu');
    // An Apple Silicon Mac whose CPU name is unreadable still gets its GPU, unnamed.
    const mac = read('darwin', 'arm64', 16, []);
    expect(mac.gpu).toEqual({ vendor: 'apple', vramBytes: 16 * GB });
  });

  it('feeds the wizard\'s threshold the way OQ11 says: Mac 16 GB yes, Mac 8 GB no, PC 32 GB yes, PC 16 GB no (VS Code reads no GPU)', () => {
    expect(isLocalCapable(read('darwin', 'arm64', 16))).toBe(true);
    expect(isLocalCapable(read('darwin', 'arm64', 8))).toBe(false);
    expect(isLocalCapable(read('win32', 'x64', 32))).toBe(true);
    expect(isLocalCapable(read('win32', 'x64', 16))).toBe(false);
    // With no GPU read, a PC's recommendation says it is a rough guess.
    expect(recommendSetupPath({ running: [], hardware: read('win32', 'x64', 64) }).hardwareLine).toMatch(/graphics card was not checked/);
  });
});

describe('hardwareLogLine', () => {
  it('names the platform, CPU, memory and what is known about the GPU', () => {
    expect(hardwareLogLine(read('darwin', 'arm64', 32, [{ model: 'Apple M2 Max' }]))).toBe('Hardware: darwin arm64, Apple M2 Max, 32 GB, Apple Silicon');
    expect(hardwareLogLine(read('win32', 'x64', 16, [{ model: 'Intel i7' }]))).toBe('Hardware: win32 x64, Intel i7, 16 GB, GPU not checked');
    expect(hardwareLogLine(read('linux', 'x64', 8, []))).toBe('Hardware: linux x64, 8 GB, GPU not checked');
  });

  it('rounds memory to whole gigabytes and says nothing about a key, a path or a user name', () => {
    const line = hardwareLogLine(read('linux', 'x64', 15.6));
    expect(line).toContain('16 GB');
    expect(line).not.toMatch(/\/|\\|@/);
  });
});

describe('AiEngineService.hardwareInfo', () => {
  function service(readHardware?: () => AiHardwareInfo) {
    const log: string[] = [];
    const settings = parseAiSettings({ enabled: true, engines: [] }, { onWarning: () => {} });
    const svc = new AiEngineService({
      readSettings: () => settings,
      secrets: new AiSecrets({ get: async () => undefined, store: async () => {}, delete: async () => {} }, {}),
      consent: { get: () => undefined, set: async () => {}, forget: async () => {}, ids: () => [] },
      askConsent: async () => 'notNow',
      saveEngines: async () => {},
      log: (l) => log.push(l),
      adapters: new Map(),
      readHardware,
    });
    return { svc, log };
  }

  it('reads once, answers the same object after, and logs one line per session', () => {
    const reader = vi.fn(() => read('darwin', 'arm64', 32, [{ model: 'Apple M2 Max' }]));
    const { svc, log } = service(reader);
    const first = svc.hardwareInfo();
    expect(first).toMatchObject({ appleSilicon: true, totalMemoryBytes: 32 * GB });
    expect(svc.hardwareInfo()).toBe(first);
    expect(reader).toHaveBeenCalledOnce();
    expect(log).toEqual(['Hardware: darwin arm64, Apple M2 Max, 32 GB, Apple Silicon']);
  });

  it('answers null when the host has no reader, without logging', () => {
    const { svc, log } = service();
    expect(svc.hardwareInfo()).toBeNull();
    expect(log).toEqual([]);
  });

  it('answers null when the read throws, logs why once, and does not try again', () => {
    const reader = vi.fn((): AiHardwareInfo => { throw new Error('sandbox says no'); });
    const { svc, log } = service(reader);
    expect(svc.hardwareInfo()).toBeNull();
    expect(svc.hardwareInfo()).toBeNull();
    expect(reader).toHaveBeenCalledOnce();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^Hardware: could not read \(.*sandbox says no.*\)$/);
  });
});
