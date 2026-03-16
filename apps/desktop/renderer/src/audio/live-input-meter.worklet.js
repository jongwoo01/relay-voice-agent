class RelayLiveInputMeterProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];

    if (input && output) {
      output.set(input);
    }

    if (!input || input.length === 0) {
      return true;
    }

    let peak = 0;
    let sumSquares = 0;
    const pcm16 = new Int16Array(input.length);

    for (let index = 0; index < input.length; index += 1) {
      const value = Math.max(-1, Math.min(1, input[index]));
      peak = Math.max(peak, Math.abs(value));
      sumSquares += value * value;
      pcm16[index] = value * 32768;
    }

    this.port.postMessage(
      {
        peak,
        rms: Math.sqrt(sumSquares / input.length),
        pcm16
      },
      [pcm16.buffer]
    );

    return true;
  }
}

registerProcessor("relay-live-input-meter", RelayLiveInputMeterProcessor);
