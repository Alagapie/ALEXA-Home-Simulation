import { useCallback, useEffect, useRef, useState } from 'react'
import { Ear, Mic, MicOff, Send, Sparkles, X } from 'lucide-react'
import { useRoomStore } from '../store/useRoomStore'
import { parseCommand, ASSISTANT_NAME } from '../assistant/brain'
import {
  createRecognizer, speak, stopSpeaking, voiceInputSupported, voiceOutputSupported,
} from '../services/speech'
import { ROOMS } from '../config/house'

/**
 * NOVA - the in-app voice assistant.
 *
 * A floating orb plus a small chat panel. The microphone turns speech into
 * text (Web Speech API); every command then flows through `parseCommand` and
 * the *same* store actions a click uses, so the assistant, the 3D scene and
 * the device list can never disagree. Replies are spoken back with
 * `speechSynthesis` and mirrored in the chat, which doubles as the text
 * interface when voice input is unavailable (e.g. Firefox).
 *
 * Push the mic and talk, type into the box, or arm the wake word and keep
 * saying "Hey NOVA".
 */

const WAKE_WORDS = /^(?:hey |ok |okay |yo |hi )?nova\b[,.!?…]?\s*/i

const SUGGESTIONS = [
  'Movie mode', 'Good night', 'Turn off everything', "What's on?",
  'Go to the kitchen', 'Open the curtains', 'Set the AC to 21 degrees',
]

let chatId = 0

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

export function VoiceAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { id: ++chatId, role: 'nova', text: `Hi, I'm ${ASSISTANT_NAME}. Ask me to control anything - "turn off the kitchen light", "movie mode", "what's on?"` },
  ])
  const [draft, setDraft] = useState('')
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [wakeOn, setWakeOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const logRef = useRef(null)
  const inputRef = useRef(null)
  const pushRecRef = useRef(null)
  const wakeRecRef = useRef(null)
  const wakeWantedRef = useRef(false)
  const wakeSuspendedRef = useRef(false)
  const armUntilRef = useRef(0)
  const guardRef = useRef(0)
  const handleCommandRef = useRef(null)

  const addMessage = useCallback((role, text) => {
    setMessages((prev) => [...prev.slice(-39), { id: ++chatId, role, text }])
  }, [])

  /* ------------------------------------------------------------- commands */

  const handleCommand = useCallback(async (text) => {
    const question = String(text || '').trim()
    if (!question) return
    addMessage('user', question)

    const snapshot = useRoomStore.getState()
    const plan = parseCommand(question, {
      devices: snapshot.devices,
      room: snapshot.room,
      currentRoom: snapshot.currentRoom,
      activeMode: snapshot.activeMode,
    })

    // Reply first - the simulated device acks (~150ms each) must never make
    // the user wait. Patches land optimistically the moment commit() is
    // called, so the 3D scene reacts instantly too.
    addMessage('nova', plan.reply)
    if (voiceOutputSupported) {
      wakeSuspendedRef.current = true
      wakeRecRef.current?.stop()
      speak(plan.reply).then(() => {
        wakeSuspendedRef.current = false
        if (wakeWantedRef.current) wakeRecRef.current?.start()
      })
    }

    setBusy(true)
    try {
      await Promise.all(plan.actions.map((action) => {
        const store = useRoomStore.getState()
        if (action.kind === 'commit') return store.commit(action.id, action.patch, action.command)
        if (action.kind === 'scene') return store.applyMode(action.modeId)
        if (action.kind === 'nav') {
          store.goToRoom(action.roomId)
          store.pushLog({ level: 'info', text: `${ASSISTANT_NAME} · camera to the ${ROOMS[action.roomId]?.label || action.roomId}` })
          return undefined
        }
        if (action.kind === 'call') return store[action.name]?.(...(action.args || []))
        return undefined
      }))
    } finally {
      setBusy(false)
    }
  }, [addMessage])

  handleCommandRef.current = handleCommand

  /* ---------------------------------------------------------- push to talk */

  const stopListening = useCallback(() => {
    pushRecRef.current?.stop()
    setListening(false)
  }, [])

  const startListening = useCallback(() => {
    if (!voiceInputSupported) { inputRef.current?.focus(); return }
    stopSpeaking() // never let the assistant hear its own reply
    setInterim('')
    setNote('')
    const rec = createRecognizer({
      onInterim: (t) => setInterim(t),
      onFinal: (t) => { setInterim(''); handleCommandRef.current?.(t); rec.stop() },
      onEnd: () => { setListening(false); setInterim(''); clearTimeout(guardRef.current) },
      onError: (error) => {
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          setNote('Microphone blocked - allow mic access, or just type.')
        }
      },
    })
    if (!rec) return
    pushRecRef.current = rec
    setListening(true)
    rec.start()
    // A hung recogniser would leave the orb glowing forever.
    guardRef.current = setTimeout(() => rec.stop(), 9000)
  }, [])

  /* ------------------------------------------------------------- wake word */

  const startWake = useCallback(() => {
    if (!voiceInputSupported) return
    wakeWantedRef.current = true
    const rec = createRecognizer({
      continuous: true,
      interimResults: true,
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim('')
        const stripped = t.replace(WAKE_WORDS, '')
        if (stripped.toLowerCase() !== t.toLowerCase()) {
          // "Hey NOVA ..." - the command may follow the wake word inline.
          if (stripped.trim()) handleCommandRef.current?.(stripped.trim())
          else { armUntilRef.current = Date.now() + 12000; speak(`Yes?`) }
        } else if (Date.now() < armUntilRef.current) {
          // Woken up already: the next sentence needs no wake word.
          armUntilRef.current = 0
          handleCommandRef.current?.(t)
        }
      },
      onEnd: () => {
        // Chrome stops continuous recognition every few minutes; restart while armed.
        if (wakeWantedRef.current && !wakeSuspendedRef.current) rec.start()
      },
      onError: (error) => {
        if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture') {
          wakeWantedRef.current = false
          setWakeOn(false)
          setNote('Microphone blocked - allow mic access to use the wake word.')
        }
      },
    })
    if (!rec) { setWakeOn(false); return }
    wakeRecRef.current = rec
    rec.start()
  }, [])

  const stopWake = useCallback(() => {
    wakeWantedRef.current = false
    armUntilRef.current = 0
    wakeRecRef.current?.abort()
    wakeRecRef.current = null
  }, [])

  useEffect(() => {
    if (wakeOn) startWake()
    else stopWake()
    return stopWake
  }, [wakeOn, startWake, stopWake])

  /* --------------------------------------------------------------- layout */

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages, interim, busy])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
      if (event.key.toLowerCase() === 'v' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(document.activeElement)) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    const onKey = (event) => {
      if (open || event.key.toLowerCase() !== 'v' || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(document.activeElement) || useRoomStore.getState().walkLocked) return
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => () => { stopSpeaking() }, [])

  const statusLine = busy
    ? 'One moment…'
    : listening
      ? 'Listening…'
      : wakeOn
        ? 'Always listening for "Hey NOVA"'
        : 'Ask me anything - or push the mic'

  const submit = (event) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    handleCommand(text)
  }

  const micTitle = voiceInputSupported ? 'Push to talk' : 'Voice input needs Chrome or Edge'

  return (
    <div className="nova">
      {!open && (
        <button
          type="button"
          className={`nova__orb ${listening || busy ? 'nova__orb--active' : ''} ${wakeOn ? 'nova__orb--armed' : ''}`}
          onClick={() => { setOpen(true); inputRef.current?.focus() }}
          title={`${ASSISTANT_NAME} - voice assistant (V)`}
          aria-label="Open the voice assistant"
        >
          <Sparkles size={21} />
        </button>
      )}

      {open && (
        <div className="nova__panel glass" role="dialog" aria-label={`${ASSISTANT_NAME} voice assistant`}>
          <div className="nova__head">
            <span className="nova__badge"><Sparkles size={15} /></span>
            <div className="nova__id">
              <div className="nova__name">{ASSISTANT_NAME}</div>
              <div className="nova__status">{statusLine}</div>
            </div>
            {voiceInputSupported && (
              <button
                type="button"
                className={`nova__tool ${wakeOn ? 'nova__tool--on' : ''}`}
                onClick={() => setWakeOn((v) => !v)}
                title={'Listen continuously for "Hey NOVA"'}
                aria-label="Toggle the wake word"
              >
                <Ear size={15} />
              </button>
            )}
            <button
              type="button"
              className="nova__tool"
              onClick={() => setOpen(false)}
              title="Close (Esc)"
              aria-label="Close the assistant"
            >
              <X size={15} />
            </button>
          </div>

          <div className="nova__log scroll" ref={logRef}>
            {messages.map((m) => (
              <div key={m.id} className={`msg msg--${m.role}`}>{m.text}</div>
            ))}
            {busy && <div className="msg msg--nova msg--busy">Working…</div>}
            {interim && <div className="msg msg--interim">{interim}…</div>}
          </div>

          <div className="nova__chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="nova__chip" onClick={() => handleCommand(s)}>{s}</button>
            ))}
          </div>

          <form className="nova__form" onSubmit={submit}>
            <input
              ref={inputRef}
              className="nova__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Say it or type it - e.g. "lights out"`}
              aria-label={`Ask ${ASSISTANT_NAME}`}
            />
            <button
              type="button"
              className={`nova__mic ${listening ? 'nova__mic--on' : ''}`}
              onClick={() => (listening ? stopListening() : startListening())}
              disabled={!voiceInputSupported}
              title={micTitle}
              aria-label="Push to talk"
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button type="submit" className="nova__send" title="Send" aria-label="Send">
              <Send size={15} />
            </button>
          </form>

          {note && <div className="nova__hint">{note}</div>}
          {!note && !voiceInputSupported && (
            <div className="nova__hint">Voice input needs Chrome or Edge - typing works everywhere.</div>
          )}
        </div>
      )}
    </div>
  )
}
