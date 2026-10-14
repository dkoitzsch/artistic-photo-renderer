// WebGPU-Initialisierung. Liefert entweder ein Gerät oder einen verständlichen Grund,
// warum nicht gerendert werden kann (siehe DECISIONS.md: kein WebGL2-Render-Pfad in Phase 0).

export type GpuInfo = { vendor: string; architecture: string; description: string };

export type GpuInit =
  | { kind: 'webgpu'; device: GPUDevice; info: GpuInfo; limits: GPUSupportedLimits }
  | { kind: 'webgl2'; reason: string }
  | { kind: 'none'; reason: string };

// Limits, die wir bis zum Maximum des Adapters anheben (große Bilder, Export).
const RAISED_LIMITS = [
  'maxTextureDimension2D',
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
] as const;

function hasWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function noWebGpu(reason: string): GpuInit {
  return hasWebGL2() ? { kind: 'webgl2', reason } : { kind: 'none', reason };
}

export async function initGpu(onLost: (message: string) => void): Promise<GpuInit> {
  if (!('gpu' in navigator)) {
    return noWebGpu('Dieser Browser stellt kein WebGPU bereit.');
  }
  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (e) {
    return noWebGpu(`Der GPU-Adapter konnte nicht angefordert werden: ${String(e)}`);
  }
  if (!adapter) {
    return noWebGpu(
      'Es wurde kein passender GPU-Adapter gefunden (WebGPU evtl. deaktiviert oder blockiert).',
    );
  }

  const requiredLimits: Record<string, number> = {};
  for (const name of RAISED_LIMITS) requiredLimits[name] = adapter.limits[name];

  const requiredFeatures: GPUFeatureName[] = [];
  if (adapter.features.has('float32-filterable')) requiredFeatures.push('float32-filterable');

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ requiredLimits, requiredFeatures });
  } catch (e) {
    return noWebGpu(`Das GPU-Gerät konnte nicht erstellt werden: ${String(e)}`);
  }

  void device.lost.then((info) => {
    if (info.reason !== 'destroyed') onLost(info.message || 'Die Verbindung zur GPU ist verloren gegangen.');
  });
  device.addEventListener('uncapturederror', (event) => {
    console.error('WebGPU-Fehler:', event.error.message);
  });

  const ai = adapter.info;
  return {
    kind: 'webgpu',
    device,
    info: { vendor: ai.vendor, architecture: ai.architecture, description: ai.description },
    limits: device.limits,
  };
}
