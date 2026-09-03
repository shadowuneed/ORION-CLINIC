class OrionPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = Math.max(256, Math.round(sampleRate * 0.02));
    this.frame = new Float32Array(this.frameSize);
    this.frameOffset = 0;
    this.active = true;

    this.port.onmessage = (event) => {
      if (event.data?.type !== 'flush') return;
      this.flush();
      this.port.postMessage({ type: 'flushed' });
    };
  }

  flush() {
    if (this.frameOffset === 0) return;
    const samples = this.frame.slice(0, this.frameOffset);
    this.port.postMessage(
      { type: 'pcm', samples, sampleRate },
      [samples.buffer],
    );
    this.frameOffset = 0;
  }

  process(inputs) {
    if (!this.active) return false;

    const channels = inputs[0];
    if (!channels?.length || channels[0].length === 0) return true;

    const inputLength = channels[0].length;
    for (let index = 0; index < inputLength; index += 1) {
      let mixedSample = 0;
      for (const channel of channels) mixedSample += channel[index] ?? 0;
      this.frame[this.frameOffset] = mixedSample / channels.length;
      this.frameOffset += 1;

      if (this.frameOffset === this.frame.length) this.flush();
    }

    return true;
  }
}

registerProcessor('orion-pcm-processor', OrionPcmProcessor);
