window.onload = () => {
  const VF = Vex.Flow;

  const startBtn = document.getElementById("startBtn");
  const bpmSlider = document.getElementById("bpm");
  const bpmVal = document.getElementById("bpmVal");
  const toggleMetronomeBtn = document.getElementById("toggleMetronome");
  const pitchDiv = document.getElementById("pitch");
  const doremiDiv = document.getElementById("doremi");
  const octaveDiv = document.getElementById("octave");
  const frequencyDiv = document.getElementById("frequency");
  const statusDiv = document.getElementById("status");
  const metronomeSound = document.getElementById("metronomeSound");
  const outputDiv = document.getElementById("output");
  const metronomeVolumeSlider = document.getElementById("metronomeVolume");
  const volValSpan = document.getElementById("volVal");
  const numeratorInput = document.getElementById("numerator");
  const denominatorInput = document.getElementById("denominator");

  let audioContext = null;
  let analyser = null;
  let microphone = null;
  let scriptProcessor = null;
  let metronomeGainNode = null;
  let metronomeInterval = null;
  let metronomeOn = false;
  let pitchHistory = [];
  const maxHistory = 10;
  let staveNotes = [];

  const noteToDoremiMap = {
    C: "도",
    "C#": "도#",
    D: "레",
    "D#": "레#",
    E: "미",
    F: "파",
    "F#": "파#",
    G: "솔",
    "G#": "솔#",
    A: "라",
    "A#": "라#",
    B: "시",
  };

  function noteToVexflow(n) {
    let match = n.match(/^([A-G]#?)(\d)$/);
    if (!match) return null;
    const step = match[1].toLowerCase();
    const octave = match[2];
    return `${step}/${octave}`;
  }

  function getDoremi(n) {
    const match = n.match(/^([A-G]#?)(\d)$/);
    if (!match) return "--";
    const note = match[1];
    return noteToDoremiMap[note] || "--";
  }

  function getOctave(n) {
    const match = n.match(/^([A-G]#?)(\d)$/);
    if (!match) return "--";
    return match[2];
  }

  function autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    let bestOffset = -1;
    let bestCorrelation = 0;
    let rms = 0;
    let foundGoodCorrelation = false;
    const correlations = new Array(MAX_SAMPLES);

    for (let i = 0; i < SIZE; i++) {
      const val = buffer[i];
      rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    let lastCorrelation = 1;
    for (let offset = 0; offset < MAX_SAMPLES; offset++) {
      let correlation = 0;
      for (let i = 0; i < MAX_SAMPLES; i++) {
        correlation += Math.abs(buffer[i] - buffer[i + offset]);
      }
      correlation = 1 - correlation / MAX_SAMPLES;
      correlations[offset] = correlation;

      if (correlation > 0.9 && correlation > lastCorrelation) {
        foundGoodCorrelation = true;
        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestOffset = offset;
        }
      } else if (foundGoodCorrelation) {
        const shift =
          (correlations[bestOffset + 1] - correlations[bestOffset - 1]) /
          correlations[bestOffset];
        return sampleRate / (bestOffset + 8 * shift);
      }
      lastCorrelation = correlation;
    }
    if (bestCorrelation > 0.01) {
      return sampleRate / bestOffset;
    }
    return -1;
  }

  function frequencyToNote(freq) {
    if (freq === -1) return "--";
    const noteNum = 12 * (Math.log2(freq / 440)) + 69;
    const noteIndex = Math.round(noteNum) % 12;
    const octave = Math.floor(Math.round(noteNum) / 12) - 1;
    const noteStrings = [
      "C", "C#", "D", "D#", "E", "F",
      "F#", "G", "G#", "A", "A#", "B"
    ];
    return noteStrings[noteIndex] + octave;
  }

  function weightedAverage(arr) {
    let weightSum = 0;
    let weightedValSum = 0;
    for (let i = 0; i < arr.length; i++) {
      const weight = i + 1;
      weightSum += weight;
      weightedValSum += arr[i] * weight;
    }
    return weightedValSum / weightSum;
  }

  function drawEmptyStave(timeSignature = "4/4") {
    outputDiv.innerHTML = "";
    const renderer = new VF.Renderer(outputDiv, VF.Renderer.Backends.SVG);
    renderer.resize(600, 160);
    const context = renderer.getContext();
    const stave = new VF.Stave(10, 40, 580);
    stave.addClef("treble").addTimeSignature(timeSignature);
    stave.setContext(context).draw();
  }

  function drawNotes(notesArr, timeSignature = "4/4") {
    if (notesArr.length === 0) {
      drawEmptyStave(timeSignature);
      return;
    }
    outputDiv.innerHTML = "";
    const renderer = new VF.Renderer(outputDiv, VF.Renderer.Backends.SVG);
    renderer.resize(600, 160);
    const context = renderer.getContext();
    const stave = new VF.Stave(10, 40, 580);
    stave.addClef("treble").addTimeSignature(timeSignature);
    stave.setContext(context).draw();

    const notes = notesArr.map(noteStr =>
      new VF.StaveNote({ clef: "treble", keys: [noteStr], duration: "q" })
    );

    const beats = parseInt(timeSignature.split("/")[0]);
    const beatValue = parseInt(timeSignature.split("/")[1]);

    const voice = new VF.Voice({
      num_beats: Math.max(beats, notesArr.length),
      beat_value: beatValue,
      strict: false,
    });
    voice.addTickables(notes);

    const formatter = new VF.Formatter()
      .joinVoices([voice])
      .format([voice], 500);
    voice.draw(context, stave);
  }

  drawEmptyStave("4/4");

  function setupMetronomeAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (!metronomeGainNode) {
      metronomeGainNode = audioContext.createGain();
      metronomeGainNode.gain.value = metronomeVolumeSlider.value / 100;
      metronomeGainNode.connect(audioContext.destination);
    }
  }

  metronomeVolumeSlider.oninput = () => {
    const vol = metronomeVolumeSlider.value;
    volValSpan.textContent = vol;
    if (metronomeGainNode) {
      metronomeGainNode.gain.value = vol / 100;
    }
  };

  function playMetronomeClick() {
    setupMetronomeAudio();
    const source = audioContext.createBufferSource();
    const request = new XMLHttpRequest();
    request.open("GET", metronomeSound.src, true);
    request.responseType = "arraybuffer";
    request.onload = () => {
      audioContext.decodeAudioData(request.response, (buffer) => {
        source.buffer = buffer;
        source.connect(metronomeGainNode);
        source.start(0);
      });
    };
    request.send();
  }

  function startMetronome() {
    const intervalMs = Math.floor(60000 / bpmSlider.value);
    if (metronomeInterval) clearInterval(metronomeInterval);
    metronomeInterval = setInterval(() => {
      playMetronomeClick();

      if (pitchHistory.length) {
        const avgPitch = weightedAverage(pitchHistory);
        const noteName = frequencyToNote(avgPitch);
        const vfNote = noteToVexflow(noteName);
        if (vfNote) {
          staveNotes.push(vfNote);
          if (staveNotes.length > 16) staveNotes.shift();
          const numerator = parseInt(numeratorInput.value);
          const denominator = parseInt(denominatorInput.value);
          const validNumerator = numerator >= 1 && numerator <= 16 ? numerator : 4;
          const validDenominator = [1, 2, 4, 8, 16, 32].includes(denominator) ? denominator : 4;
          const timeSignature = `${validNumerator}/${validDenominator}`;
          drawNotes(staveNotes, timeSignature);
        }
      }
    }, intervalMs);
    toggleMetronomeBtn.textContent = "메트로놈 끄기";
    metronomeOn = true;
    statusDiv.textContent = `메트로놈 작동 중 (BPM: ${bpmSlider.value})`;
  }

  function stopMetronome() {
    clearInterval(metronomeInterval);
    metronomeInterval = null;
    toggleMetronomeBtn.textContent = "메트로놈 켜기";
    metronomeOn = false;
    statusDiv.textContent = "메트로놈 정지됨";
  }

  toggleMetronomeBtn.onclick = () => {
    if (metronomeOn) stopMetronome();
    else startMetronome();
  };

  bpmSlider.oninput = () => {
    bpmVal.textContent = bpmSlider.value;
    if (metronomeOn) {
      stopMetronome();
      startMetronome();
    }
  };

  numeratorInput.oninput = () => {
    const numerator = parseInt(numeratorInput.value);
    const denominator = parseInt(denominatorInput.value);
    const validNum = numerator >= 1 && numerator <= 16 ? numerator : 4;
    const validDen = [1, 2, 4, 8, 16, 32].includes(denominator) ? denominator : 4;
    drawEmptyStave(`${validNum}/${validDen}`);
  };

  denominatorInput.oninput = () => {
    const numerator = parseInt(numeratorInput.value);
    const denominator = parseInt(denominatorInput.value);
    const validNum = numerator >= 1 && numerator <= 16 ? numerator : 4;
    const validDen = [1, 2, 4, 8, 16, 32].includes(denominator) ? denominator : 4;
    drawEmptyStave(`${validNum}/${validDen}`);
  };

  startBtn.onclick = async () => {
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphone = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);

      microphone.connect(analyser);
      analyser.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      scriptProcessor.onaudioprocess = () => {
        const array = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(array);
        const pitch = autoCorrelate(array, audioContext.sampleRate);
        if (pitch !== -1) {
          pitchHistory.push(pitch);
          if (pitchHistory.length > maxHistory) pitchHistory.shift();
          const avgPitch = weightedAverage(pitchHistory);
          const noteName = frequencyToNote(avgPitch);
          pitchDiv.textContent = `음계: ${noteName}`;
          doremiDiv.textContent = "음정: " + getDoremi(noteName);
          octaveDiv.textContent = "옥타브: " + getOctave(noteName);
          frequencyDiv.textContent = `주파수: ${avgPitch.toFixed(2)} Hz`;
          statusDiv.textContent = "마이크 활성화 및 음성 분석 중";
        } else {
          pitchDiv.textContent = "음계: --";
          doremiDiv.textContent = "음정: --";
          octaveDiv.textContent = "옥타브: --";
          frequencyDiv.textContent = "주파수: -- Hz";
          statusDiv.textContent = "마이크 활성화 및 음성 분석 대기 중";
        }
      };

      startBtn.disabled = true;
    } catch (err) {
      statusDiv.textContent = "마이크 권한 거부 또는 오류 발생";
      console.error(err);
    }
  };
};
