/**
 * Simple MCP-based voice client for AuraAssist.
 * Uses the MCP protocol to communicate with the server.
 */

import { mcpUrl } from './mcpClient'
import { speak, stopSpeaking, voiceInputSupported, voiceOutputSupported, createRecognizer } from './speech'

/**
 * Create a simple voice client that uses MCP protocol with AuraAssist.
 */
export function createVoiceClient({ onMessage, onStatus } = {}) {
  let mcpClient = null
  let sessionId = null
  let listening = false

  // Speech recognition
  let recognition = null

  /** Initialize MCP connection */
  async function init() {
    const { createMcpClient } = await import('./mcpClient')
    mcpClient = createMcpClient()
    try {
      const result = await mcpClient.connect()
      sessionId = mcpClient.sessionId
      onStatus?.('connected')
      return true
    } catch (error) {
      onStatus?.('error', error.message)
      return false
    }
  }

  /** Send a message to AuraAssist via MCP agent tool */
  async function sendMessage(text) {
    if (!mcpClient) {
      onStatus?.('error', 'MCP client not initialized')
      return null
    }

    onStatus?.('thinking')

    try {
      // Call the agent tool through MCP
      const result = await mcpClient.callTool('agent', { message: text })
      onStatus?.('idle')

      // Parse the result
      const response = {
        reply: '',
        needsConfirmation: false,
        pending: null,
      }

      if (result?.content) {
        // Extract text from content
        const textContent = result.content.find?.(c => c.text)
        response.reply = textContent?.text || JSON.stringify(result.content)
      }

      // Check for confirmation needs
      const data = await parseJsonResponse(result)
      if (data?.needs_user_input) {
        response.needsConfirmation = true
        response.pending = data.pending || 'Please confirm'
      }

      return response
    } catch (error) {
      onStatus?.('error', error.message)
      return { reply: 'Sorry, I couldn\'t reach AuraAssist', needsConfirmation: false }
    }
  }

  /** Parse JSON from MCP result */
  async function parseJsonResponse(result) {
    try {
      if (result?.content?.[0]?.text) {
        const text = result.content[0].text
        // Try to parse as JSON
        try {
          return JSON.parse(text)
        } catch {
          // Not JSON, return as text
          return { text }
        }
      }
    } catch {
      // Ignore parsing errors
    }
    return result || {}
  }

  /** Start listening for speech */
  function startListening() {
    if (!voiceInputSupported || listening) return
    listening = true

    recognition = createRecognizer({
      onFinal: (text) => {
        onMessage?.('user', text)
        stopListening()
      },
      onError: (error) => {
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          onStatus?.('error', 'Microphone access denied')
        }
        listening = false
      },
      onEnd: () => {
        listening = false
      },
    })

    if (recognition) {
      recognition.start()
    }
  }

  /** Stop listening */
  function stopListening() {
    if (recognition) {
      try { recognition.stop() } catch {}
      try { recognition.abort() } catch {}
    }
    listening = false
  }

  /** Speak text */
  async function speakText(text) {
    if (voiceOutputSupported && text) {
      stopSpeaking()
      await speak(text)
    }
  }

  /** Cleanup */
  function destroy() {
    stopListening()
    if (mcpClient) {
      mcpClient.close()
    }
  }

  return {
    init,
    sendMessage,
    startListening,
    stopListening,
    speakText,
    destroy,
    get isListening() { return listening },
  }
}
