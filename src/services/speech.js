/**
 * Browser speech I/O for the NOVA assistant.
 *
 * Voice output uses the built-in `speechSynthesis` engine and voice input uses
 * `SpeechRecognition` (Chrome / Edge ship it; Firefox does not). Both are free,
 * on-device-ish and need no API keys, which keeps the project dependency-free -
 * the same rule the rest of the simulator follows. The assistant UI degrades
 * gracefully: when voice input is unavailable it simply becomes a text chat.
 *
 * NOTE: Chrome's recogniser is "continuous-free" by spec but does accept
 * `continuous = true`; when the tab is hidden or the stream ends it stops, so
 * the caller restarts it (see VoiceAssistant's wake loop).
 */

const getRecognition = () =>
  (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null

export const voiceInputSupported = !!getRecognition()
export const voiceOutputSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

/* ------------------------------------------------------------------ speech */

let cachedVoice = null

function pickVoice() {
  if (!voiceOutputSupported) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const english = voices.filter((v) => /^en/i.test(v.lang))
  const pool = english.length ? english : voices
  const preferred = pool.find((v) => /aria|jenny|zira|natural|online|google us english/i.test(v.name))
  return preferred || pool[0]
}

if (voiceOutputSupported) {
  // Voices load asynchronously in most browsers; refresh the cache when they arrive.
  window.speechSynthesis.onvoiceschanged = () => { cachedVoice = pickVoice() }
}

/** Speak `text`, resolving when the utterance finishes (or fails / is cancelled). */
export function speak(text, { rate = 1.03, pitch = 1 } = {}) {
  if (!voiceOutputSupported || !text) return Promise.resolve()
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = rate
  utterance.pitch = pitch
  utterance.lang = 'en-US'
  utterance.voice = cachedVoice || (cachedVoice = pickVoice())
  return new Promise((resolve) => {
    utterance.onend = resolve
    utterance.onerror = resolve
    window.speechSynthesis.speak(utterance)
  })
}

/** Stop any reply currently being spoken (e.g. so the mic can hear you). */
export function stopSpeaking() {
  if (voiceOutputSupported) window.speechSynthesis.cancel()
}

/* ------------------------------------------------------------------ listen */

/**
 * Create a one-line recogniser wrapper.
 *
 * @param {object} callbacks
 * @param {(text: string) => void} callbacks.onFinal    a finalised utterance
 * @param {(text: string) => void} callbacks.onInterim  live partial results
 * @param {() => void}             callbacks.onEnd      recogniser stopped
 * @param {(error: string) => void} callbacks.onError   recogniser error name
 */
export function createRecognizer({ lang = 'en-US', continuous = false, interimResults = true, onFinal, onInterim, onEnd, onError } = {}) {
  const Recognition = getRecognition()
  if (!Recognition) return null

  const recognition = new Recognition()
  recognition.lang = lang
  recognition.continuous = continuous
  recognition.interimResults = interimResults
  recognition.maxAlternatives = 1

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      if (result.isFinal) {
        const text = result[0].transcript.trim()
        if (text) onFinal?.(text)
      } else {
        interim += result[0].transcript
      }
    }
    if (interim.trim()) onInterim?.(interim.trim())
  }
  recognition.onerror = (event) => onError?.(event.error || 'unknown')
  recognition.onend = () => onEnd?.()

  return {
    start() {
      try { recognition.start() } catch { /* already started */ }
    },
    stop() {
      try { recognition.stop() } catch { /* not started */ }
    },
    abort() {
      try { recognition.abort() } catch { /* not started */ }
    },
  }
}
