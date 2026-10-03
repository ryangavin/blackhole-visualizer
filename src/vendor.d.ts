declare module 'butterchurn' {
  const butterchurn: { createVisualizer(context: AudioContext | null, canvas: HTMLCanvasElement, options: { width: number; height: number; pixelRatio?: number; textureRatio?: number }): { renderer: { audioLevels: { starts: number[]; stops: number[] } }; loadPreset(preset: unknown, blendTime: number): void; render(options?: { audioLevels: { timeByteArray: Uint8Array; timeByteArrayL: Uint8Array; timeByteArrayR: Uint8Array } }): void; setRendererSize(width: number, height: number): void } };
  export default butterchurn;
}
declare module 'butterchurn-presets' {
  const presets: { getPresets(): Record<string, unknown> };
  export default presets;
}
