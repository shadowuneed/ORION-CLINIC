class OrionPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;
    const length = channels[0].length;
    const mono = new Float32Array(length);
    for (let channel = 0; channel < channels.length; channel += 1) {
      const source = channels[channel];
      for (let index = 0; index < length; index += 1) {
        mono[index] += source[index] / channels.length;
      }
    }
    this.port.postMessage(mono, [mono.buffer]);
    return true;
  }
}

registerProcessor('orion-pcm-processor', OrionPcmProcessor);
