import { useCallback, useEffect, useRef, useState } from 'react'
import { Ear, Mic, MicOff, Send, Sparkles, X } from 'lucide-react'
import { useRoomStore } from '../store/useRoomStore'
import { parseCommand, ASSISTANT_NAME } from '../assistant/brain'
import { invokeAgent } from '../services/auraApi'
import {
  createRecognizer, speak, stopSpeaking, voiceInputSupported, voiceOutputSupported,
} from '../services/speech'
import { ROOMS } from '../config/house'

/**
 * Alexa - the in-app voice assistant.
 *
 * A floating orb plus a small chat panel. The microphone turns speech into
 * text (Web Speech API); every command then flows through `parseCommand` and
 * the *same* store actions a click uses, so the assistant, the 3D scene and
 * the device list can never disagree. Replies are spoken back with
 * `speechSynthesis` and mirrored in the chat, which doubles as the text
 * interface when voice input is unavailable (e.g. Firefox).
 *
 * Push the mic and talk, type into the box, or arm the wake word and keep
 * saying "Hey Alexa".
 */

const WAKE_WORDS = /^(?:hey |ok |okay |yo |hi |good morning |computer )?(?:alexa|computer)\b[,.!?…]?\s*/i

const SUGGESTIONS = [
  'Movie mode', 'Good night', 'Turn off everything', "What's on?",
  'Go to the kitchen', 'Open the curtains', 'Set the AC to 21 degrees',
]

let chatId = 0

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

export function VoiceAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { id: ++chatId, role: 'alexa', text: `Hi, I'm ${ASSISTANT_NAME}. Always listening! Say "Hey Alexa" to asks. Try: "what's on the coffee table", "movie mode", "prepare for bed".` },
  ])
  const [draft, setDraft] = useState('')
  const [interim, setInterim] = useState('')
  const [listening, setListening] = useState(false)
  const [wakeOn, setWakeOn] = useState(true) // ALWAYS LISTENING
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

    /* --- Questions the agent owns (vision, camera memory, the house) ------- */
    // The rule engine only knows the device list. Anything about *what the
    // cameras see* or *where an object was last seen* is answered by the
    // AuraAssist agent, which drives the VLM and the MCP tools.
    const asksAgent = plan.actions.some((a) => a.kind === 'ask_agent')
      || plan.intent === 'unknown'
      || plan.intent === 'visual_query'
      || plan.intent === 'object_location'

    if (asksAgent) {
      const ask = plan.actions.find((a) => a.kind === 'ask_agent')?.question || question
      setBusy(true)
      let reply = plan.reply || 'One moment…'
      try {
        const turn = await invokeAgent(ask, 'voice-sim')
        reply = turn.reply || reply
        for (const call of turn.tool_calls || []) {
          useRoomStore.getState().pushLog({
            level: 'info',
            text: `Voice · ${call.name}${call.result ? ` · ${call.result}` : ''}`,
          })
        }
      } catch (error) {
        reply = plan.reply && plan.reply !== 'One moment…'
          ? plan.reply
          : `I couldn't reach AuraAssist (${error.message}). Start it with: python -m uvicorn server.main:app --port 8000`
      }
      setBusy(false)
      addMessage('alexa', reply)
      if (voiceOutputSupported) {
        wakeSuspendedRef.current = true
        wakeRecRef.current?.stop()
        speak(reply).then(() => {
          wakeSuspendedRef.current = false
          if (wakeWantedRef.current) wakeRecRef.current?.start()
        })
      }
      return
    }

    // Reply first - the simulated device acks (~150ms each) must never make
    // the user wait. Patches land optimistically the moment commit() is
    // called, so the 3D scene reacts instantly too.
    addMessage('alexa', plan.reply)
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
          // "Hey Alexa ..." - the command may follow the wake word inline.
          if (stripped.trim()) {
            handleCommandRef.current?.(stripped.trim())
          } else {
            // Wake word alone - respond then listen for command
            armUntilRef.current = Date.now() + 12000
            const wakeResponses = ["Yes?", "Go ahead.", "I'm listening.", "Yes, I'm here."]
            const reply = wakeResponses[Math.floor(Math.random() * wakeResponses.length)]
            wakeSuspendedRef.current = true
            wakeRecRef.current?.stop()
            speak(reply).then(() => {
              wakeSuspendedRef.current = false
              if (wakeWantedRef.current) wakeRecRef.current?.start()
            })
          }
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
        ? 'Always listening for "Hey Alexa"'
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
    <div className="alexa">
      {!open && (
        <button
          type="button"
          className={`alexa__orb ${listening || busy ? 'alexa__orb--active' : ''} ${wakeOn ? 'alexa__orb--armed' : ''}`}
          onClick={() => { setOpen(true); inputRef.current?.focus() }}
          title={`${ASSISTANT_NAME} - voice assistant (V)`}
          aria-label="Open the voice assistant"
        >
          <Sparkles size={21} />
        </button>
      )}

      {open && (
        <div className="alexa__panel glass" role="dialog" aria-label={`${ASSISTANT_NAME} voice assistant`}>
          <div className="alexa__head">
            <span className="alexa__badge"><Sparkles size={15} /></span>
            <div className="alexa__id">
              <div className="alexa__name">{ASSISTANT_NAME}</div>
              <div className="alexa__status">{statusLine}</div>
            </div>
            {voiceInputSupported && (
              <button
                type="button"
                className={`alexa__tool ${wakeOn ? 'alexa__tool--on' : ''}`}
                onClick={() => setWakeOn((v) => !v)}
                title={'Listen continuously for "Hey Alexa"'}
                aria-label="Toggle the wake word"
              >
                <Ear size={15} />
              </button>
            )}
            <button
              type="button"
              className="alexa__tool"
              onClick={() => setOpen(false)}
              title="Close (Esc)"
              aria-label="Close the assistant"
            >
              <X size={15} />
            </button>
          </div>

          <div className="alexa__log scroll" ref={logRef}>
            {messages.map((m) => (
              <div key={m.id} className={`msg msg--${m.role}`}>{m.text}</div>
            ))}
            {busy && <div className="msg msg--alexa msg--busy">Working…</div>}
            {interim && <div className="msg msg--interim">{interim}…</div>}
          </div>

          <div className="alexa__chips">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="alexa__chip" onClick={() => handleCommand(s)}>{s}</button>
            ))}
          </div>

          <form className="alexa__form" onSubmit={submit}>
            <input
              ref={inputRef}
              className="alexa__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Say it or type it - e.g. "lights out"`}
              aria-label={`Ask ${ASSISTANT_NAME}`}
            />
            <button
              type="button"
              className={`alexa__mic ${listening ? 'alexa__mic--on' : ''}`}
              onClick={() => (listening ? stopListening() : startListening())}
              disabled={!voiceInputSupported}
              title={micTitle}
              aria-label="Push to talk"
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button type="submit" className="alexa__send" title="Send" aria-label="Send">
              <Send size={15} />
            </button>
          </form>

          {note && <div className="alexa__hint">{note}</div>}
          {!note && !voiceInputSupported && (
            <div className="alexa__hint">Voice input needs Chrome or Edge - typing works everywhere.</div>
          )}
        </div>
      )}
    </div>
  )
}
