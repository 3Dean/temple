let audioContext = null;
let analyser = null;
let masterGain = null;
let mediaElement = null;
let mediaSource = null;
let timeDomain = null;
let smoothedMouth = 0;
let activeObjectUrl = null;

export async function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;
    timeDomain = new Uint8Array(analyser.fftSize);

    masterGain = audioContext.createGain();
    masterGain.gain.value = 1;

    analyser.connect(masterGain);
    masterGain.connect(audioContext.destination);
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  return { audioContext, analyser, masterGain };
}

function cleanupCurrentElement() {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }

  if (mediaElement) {
    mediaElement.pause();
    mediaElement.src = '';
    mediaElement.load();
  }

  if (mediaSource) {
    mediaSource.disconnect();
  }

  mediaElement = null;
  mediaSource = null;
}

async function playBlob(blob) {
  if (!audioContext) {
    await initAudio();
  }

  cleanupCurrentElement();

  try {
    activeObjectUrl = URL.createObjectURL(blob);

    mediaElement = new Audio();
    mediaElement.preload = 'auto';
    mediaElement.src = activeObjectUrl;

    mediaSource = audioContext.createMediaElementSource(mediaElement);
    mediaSource.connect(analyser);

    mediaElement.addEventListener(
      'ended',
      () => {
        if (activeObjectUrl) {
          URL.revokeObjectURL(activeObjectUrl);
          activeObjectUrl = null;
        }
        smoothedMouth = 0;
      },
      { once: true }
    );

    await mediaElement.play();
    return true;
  } catch (error) {
    console.warn('Failed to play audio blob', error);
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
    return false;
  }
}

export async function playFromUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Audio file not found: ${url}`);
      return false;
    }

    const blob = await response.blob();
    return playBlob(blob);
  } catch (error) {
    console.warn(`Failed to play audio from ${url}`, error);
    return false;
  }
}

function decodeBase64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function playTtsText(text, options = {}) {
  if (!audioContext) {
    await initAudio();
  }

  const payload = typeof text === 'string' ? text.trim() : '';
  const requestedType = typeof options?.type === 'string' ? options.type.trim().toLowerCase() : 'text';
  const type = requestedType === 'ssml' ? 'ssml' : 'text';
  if (!payload) {
    console.warn('No text provided for TTS');
    return false;
  }

  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: payload, type }),
    });

    if (!response.ok) {
      console.warn(`TTS endpoint returned ${response.status}`);
      return false;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    let blob;

    if (contentType.includes('application/json')) {
      const json = await response.json();
      const base64Audio =
        (typeof json?.audioBase64 === 'string' && json.audioBase64) ||
        (typeof json?.body === 'string' && json.body && json.isBase64Encoded ? json.body : '');

      if (!base64Audio) {
        console.warn('TTS JSON response did not include base64 audio');
        return false;
      }

      const bytes = decodeBase64ToBytes(base64Audio);
      blob = new Blob([bytes], { type: 'audio/mpeg' });
    } else if (contentType.includes('audio/mpeg') || contentType.includes('application/octet-stream')) {
      const bytes = await response.arrayBuffer();
      blob = new Blob([bytes], { type: 'audio/mpeg' });
    } else {
      const maybeText = await response.text();
      try {
        const json = JSON.parse(maybeText);
        const base64Audio =
          (typeof json?.audioBase64 === 'string' && json.audioBase64) ||
          (typeof json?.body === 'string' && json.body && json.isBase64Encoded ? json.body : '');
        if (!base64Audio) {
          console.warn('Unexpected TTS response format');
          return false;
        }
        const bytes = decodeBase64ToBytes(base64Audio);
        blob = new Blob([bytes], { type: 'audio/mpeg' });
      } catch {
        console.warn('Unexpected TTS response format');
        return false;
      }
    }

    return playBlob(blob);
  } catch (error) {
    console.warn('Failed calling /api/tts', error);
    return false;
  }
}

export function getMouthAmount() {
  if (!analyser || !timeDomain || !isPlaying()) {
    smoothedMouth *= 0.85;
    return smoothedMouth;
  }

  analyser.getByteTimeDomainData(timeDomain);

  let sumSq = 0;
  for (let i = 0; i < timeDomain.length; i += 1) {
    const centered = (timeDomain[i] - 128) / 128;
    sumSq += centered * centered;
  }

  const rms = Math.sqrt(sumSq / timeDomain.length);
  const normalized = Math.min(1, rms * 3.2);

  const attack = 0.4;
  const release = 0.12;
  const blend = normalized > smoothedMouth ? attack : release;
  smoothedMouth += (normalized - smoothedMouth) * blend;

  return smoothedMouth;
}

export function isPlaying() {
  return Boolean(mediaElement && !mediaElement.paused && !mediaElement.ended);
}

export function stopPlayback() {
  cleanupCurrentElement();
  smoothedMouth = 0;
}
