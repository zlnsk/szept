'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useChatStore, type MatrixMessage } from '@/stores/chat-store'
import { getMatrixClient } from '@/lib/matrix/client'
import {
  Send,
  Paperclip,
  Smile,
  X,
  Reply,
  Image as ImageIcon,
  FileText,
  Mic,
  Square,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'

import { isEmojiOnly } from "@/lib/emoji"

interface MessageInputProps {
  onSend: (content: string) => void
  replyTo: MatrixMessage | null
  onCancelReply: () => void
  roomId: string
}

const EMOJI_MAP: Record<string, string> = {
  // Smileys & Faces
  smile: '😊', grin: '😀', grinning: '😃', smiley: '😄', laugh: '😆', sweat_smile: '😅',
  rofl: '🤣', joy: '😂', slightly_smiling: '🙂', wink: '😉', blush: '😊', innocent: '😇',
  heart_eyes: '😍', star_struck: '🤩', kissing: '😘', kissing_heart: '😘',
  yum: '😋', stuck_out_tongue: '😛', stuck_out_tongue_winking: '😜', zany: '🤪',
  stuck_out_tongue_closed_eyes: '😝', money_mouth: '🤑', hugs: '🤗', hand_over_mouth: '🤭',
  shush: '🤫', thinking: '🤔', zipper_mouth: '🤐', raised_eyebrow: '🤨',
  neutral: '😐', expressionless: '😑', no_mouth: '😶', smirk: '😏', unamused: '😒',
  rolling_eyes: '🙄', grimace: '😬', exhale: '😮‍💨', lying: '🤥', relieved: '😌',
  pensive: '😔', sleepy: '😪', drool: '🤤', sleeping: '😴', mask: '😷',
  thermometer_face: '🤒', bandage_face: '🤕', nauseated: '🤢', vomit: '🤮',
  hot: '🥵', cold: '🥶', woozy: '🥴', dizzy_face: '😵', exploding_head: '🤯',
  cowboy: '🤠', partying: '🥳', smiling_tear: '🥲', sunglasses: '😎', nerd: '🤓',
  monocle: '🧐', confused: '😕', worried: '😟', frown: '🙁', open_mouth: '😮',
  hushed: '😯', astonished: '😲', flushed: '😳', pleading: '🥺', cry: '😢',
  sob: '😭', scream: '😱', confounded: '😖', persevere: '😣', disappointed: '😞',
  sweat: '😓', weary: '😩', tired: '😫', yawn: '🥱', angry: '😠', rage: '🤬',
  devil: '😈', skull: '💀', poop: '💩', clown: '🤡', ghost: '👻',
  alien: '👽', robot: '🤖', cat_smile: '😺', monkey_see: '🙈', monkey_hear: '🙉',
  monkey_speak: '🙊',
  // Gestures & Hands
  thumbsup: '👍', thumbs_up: '👍', '+1': '👍', thumbsdown: '👎', thumbs_down: '👎', '-1': '👎',
  fist: '👊', fist_raised: '✊', fist_left: '🤛', fist_right: '🤜',
  crossed_fingers: '🤞', peace: '✌️', love_you: '🤟', rock_on: '🤘',
  ok_hand: '👌', pinched_fingers: '🤌', pinching: '🤏',
  point_left: '👈', point_right: '👉', point_up: '👆', point_down: '👇',
  index_up: '☝️', wave: '👋', raised_back: '🤚', hand_splayed: '🖐️',
  raised_hand: '✋', vulcan: '🖖', clap: '👏', raised_hands: '🙌',
  open_hands: '🤲', handshake: '🤝', pray: '🙏', writing: '✍️',
  nail_care: '💅', muscle: '💪', flexed_biceps: '💪',
  // Hearts & Love
  heart: '❤️', red_heart: '❤️', orange_heart: '🧡', yellow_heart: '💛',
  green_heart: '💚', blue_heart: '💙', purple_heart: '💜', black_heart: '🖤',
  white_heart: '🤍', brown_heart: '🤎', broken_heart: '💔', heart_exclamation: '❣️',
  two_hearts: '💕', revolving_hearts: '💞', heartbeat: '💓', growing_heart: '💗',
  sparkling_heart: '💖', cupid: '💘', gift_heart: '💝', heart_decoration: '💟',
  love_letter: '💌', kiss_mark: '💋',
  // Fire, Stars & Nature
  fire: '🔥', flame: '🔥', sparkles: '✨', star: '⭐', star2: '🌟', dizzy: '💫',
  boom: '💥', collision: '💥', droplets: '💦', dash: '💨',
  sun: '☀️', moon: '🌙', rainbow: '🌈', cloud: '☁️', snowflake: '❄️',
  zap: '⚡', lightning: '⚡', tornado: '🌪️', earth: '🌍',
  flower: '🌸', cherry_blossom: '🌸', rose: '🌹', sunflower: '🌻',
  tree: '🌳', cactus: '🌵', palm_tree: '🌴',
  // Objects & Symbols
  '100': '💯', check: '✅', white_check_mark: '✅', x: '❌', cross_mark: '❌',
  warning: '⚠️', question: '❓', exclamation: '❗', bangbang: '‼️', interrobang: '⁉️',
  rocket: '🚀', tada: '🎉', party: '🎉', party_popper: '🎉', confetti: '🎊',
  trophy: '🏆', medal: '🥇', target: '🎯', gem: '💎', diamond: '💎',
  bell: '🔔', pin: '📌', paperclip: '📎', pencil: '✏️', memo: '📝',
  briefcase: '💼', folder: '📁', chart: '📊', chart_up: '📈', chart_down: '📉',
  key: '🔑', lock: '🔒', unlock: '🔓', bulb: '💡', lightbulb: '💡',
  speech_balloon: '💬', thought_balloon: '💭', megaphone: '📣', loudspeaker: '📢',
  music: '🎵', notes: '🎶', headphones: '🎧', microphone: '🎤',
  camera: '📷', video_camera: '📹', tv: '📺', computer: '💻', phone: '📱',
  hourglass: '⏳', watch: '⌚', alarm_clock: '⏰', calendar: '📅',
  battery: '🔋', electric_plug: '🔌', magnet: '🧲', gear: '⚙️', wrench: '🔧',
  hammer: '🔨', toolbox: '🧰', shield: '🛡️', sword: '⚔️', bomb: '💣',
  pill: '💊', adhesive_bandage: '🩹', dna: '🧬', microscope: '🔬', telescope: '🔭',
  satellite: '🛰️', ufo: '🛸', airplane: '✈️', car: '🚗', bike: '🚲',
  // Food & Drink
  pizza: '🍕', hamburger: '🍔', fries: '🍟', hotdog: '🌭', taco: '🌮',
  sushi: '🍣', ramen: '🍜', cookie: '🍪', cake: '🎂', ice_cream: '🍦',
  donut: '🍩', chocolate: '🍫', popcorn: '🍿', coffee: '☕', tea: '🍵',
  beer: '🍺', wine: '🍷', cocktail: '🍸', champagne: '🍾', apple: '🍎',
  banana: '🍌', watermelon: '🍉', grapes: '🍇', strawberry: '🍓', peach: '🍑',
  avocado: '🥑', eggplant: '🍆', corn: '🌽', carrot: '🥕', broccoli: '🥦',
  // Animals
  dog: '🐕', cat: '🐈', panda: '🐼', bear: '🐻', koala: '🐨',
  tiger: '🐯', lion: '🦁', cow: '🐄', pig: '🐷', frog: '🐸',
  monkey: '🐵', chicken: '🐔', penguin: '🐧', bird: '🐦', eagle: '🦅',
  butterfly: '🦋', bug: '🐛', bee: '🐝', ant: '🐜', spider: '🕷️',
  turtle: '🐢', snake: '🐍', whale: '🐳', dolphin: '🐬', fish: '🐟',
  octopus: '🐙', shark: '🦈', crab: '🦀', unicorn: '🦄', dragon: '🐉',
  // Misc
  eyes: '👀', eye: '👁️', brain: '🧠', tongue: '👅', lips: '👄',
  baby: '👶', person: '🧑', crown: '👑', hat: '🎩', glasses: '👓',
  necktie: '👔', dress: '👗', running: '🏃', walking: '🚶', dancer: '💃',
  sleep: '💤', zzz: '💤', infinity: '♾️', recycle: '♻️', trident: '🔱',
  flag_white: '🏳️', flag_black: '🏴', checkered_flag: '🏁',
  plus: '➕', minus: '➖', multiply: '✖️', divide: '➗',
  a: '🅰️', b: '🅱️', o: '🅾️', sos: '🆘', new: '🆕', free: '🆓',
  up: '🆙', cool: '🆒', ok: '🆗', ng: '🆖',
}

const EMOJI_CATEGORIES: Record<string, string[]> = {
  'Smileys': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥲', '😎', '🤓', '🧐'],
  'Gestures': ['👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘', '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤲', '🤝', '🙏'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟'],
  'Objects': ['🔥', '💯', '✅', '❌', '⭐', '🌟', '💡', '🎉', '🎊', '🏆', '🥇', '🎯', '💎', '🔔', '📌', '📎', '✏️', '📝', '💼', '📁', '🗂️', '📊', '📈', '📉', '🔑', '🔒', '🔓'],
  'Symbols': ['💬', '💭', '🗯️', '⚡', '💥', '💫', '💦', '🚀', '🛸', '🌈', '☀️', '🌙', '⭐', '🎵', '🎶', '➕', '➖', '✖️', '➗', '♾️', '❓', '❗', '‼️', '⁉️', '💤'],
}

function FormattingToolbar({ onInsert }: { onInsert: (prefix: string, suffix: string) => void }) {
  const buttons = [
    { label: 'Bold', icon: 'B', prefix: '**', suffix: '**', className: 'font-bold' },
    { label: 'Italic', icon: 'I', prefix: '*', suffix: '*', className: 'italic' },
    { label: 'Strike', icon: 'S', prefix: '~~', suffix: '~~', className: 'line-through' },
    { label: 'Code', icon: '<>', prefix: '`', suffix: '`', className: 'font-mono text-xs' },
    { label: 'Quote', icon: '\u275D', prefix: '\n> ', suffix: '', className: '' },
    { label: 'List', icon: '\u2022', prefix: '\n- ', suffix: '', className: '' },
  ]

  return (
    <div className="flex items-center gap-1 px-4 py-1.5 border-b border-m3-outline-variant/20 bg-m3-surface-container-lowest dark:bg-m3-surface-container animate-slide-in">
      {buttons.map(btn => (
        <button
          key={btn.label}
          onClick={() => onInsert(btn.prefix, btn.suffix)}
          title={btn.label}
          className={`flex h-7 w-7 items-center justify-center rounded-md text-sm text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest ${btn.className}`}
        >
          {btn.icon}
        </button>
      ))}
    </div>
  )
}

export function MessageInput({ onSend, replyTo, onCancelReply, roomId }: MessageInputProps) {
  const { sendTyping, uploadFile, setDisplayName, joinRoom, inviteMember, setRoomTopic } = useChatStore()
  const activeRoom = useChatStore(s => s.activeRoom)
  const [content, setContent] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [showToolbar, setShowToolbar] = useState(false)
  const [emojiCategory, setEmojiCategory] = useState('Smileys')
  // isSending state removed — messages are now sent optimistically
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  // isUploading removed — uploads are now non-blocking with progress tracked in uploadStore
  const [commandStatus, setCommandStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionStart, setMentionStart] = useState(0)
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null)
  const [emojiIndex, setEmojiIndex] = useState(0)
  const [emojiStart, setEmojiStart] = useState(0)
  const mentionRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const emojiRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (replyTo) inputRef.current?.focus()
  }, [replyTo])

  // Auto-focus input when opening a chat
  useEffect(() => {
    inputRef.current?.focus()
  }, [roomId])

  // Auto-dismiss command status after 4 seconds
  useEffect(() => {
    if (commandStatus) {
      const timer = setTimeout(() => setCommandStatus(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [commandStatus])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Record as OGG if supported natively (Firefox), otherwise WebM (Chrome)
      // and convert to OGG before uploading for bridge compatibility
      const nativeOgg = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
      const mimeType = nativeOgg ? 'audio/ogg;codecs=opus' : 'audio/webm;codecs=opus'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        let blob = new Blob(audioChunksRef.current, { type: mimeType })
        if (blob.size > 0) {
          // Convert WebM to OGG for bridge compatibility (Signal, WhatsApp, etc.)
          if (!nativeOgg) {
            const { convertWebmToOgg } = await import('@/lib/audio/webm-to-ogg')
            blob = await convertWebmToOgg(blob)
          }
          const file = new File([blob], `voice-message-${Date.now()}.ogg`, { type: 'audio/ogg; codecs=opus' })
          uploadFile(roomId, file).catch(err => console.error('Voice upload failed:', err))
        }
        setRecordingDuration(0)
      }

      mediaRecorder.start()
      setIsRecording(true)

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(d => d + 1)
      }, 1000)
    } catch (err) {
      console.error('Failed to start recording:', err)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream?.getTracks().forEach(track => track.stop())
      }
      mediaRecorderRef.current.stop()
    }
    audioChunksRef.current = []
    setIsRecording(false)
    setRecordingDuration(0)
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const handleContentChange = (value: string) => {
    setContent(value)

    // Detect @ mention trigger
    const textarea = inputRef.current
    if (textarea) {
      const cursorPos = textarea.selectionStart
      const textBeforeCursor = value.slice(0, cursorPos)
      // Find the last '@' that starts a mention (preceded by space or at start)
      const mentionMatch = textBeforeCursor.match(/(?:^|\s)@([^\s]*)$/)
      if (mentionMatch) {
        setMentionQuery(mentionMatch[1].toLowerCase())
        setMentionStart(cursorPos - mentionMatch[1].length - 1) // -1 for '@'
        setMentionIndex(0)
        setEmojiQuery(null)
      } else {
        setMentionQuery(null)
        // Detect : emoji trigger (only when no mention is active)
        const emojiMatch = textBeforeCursor.match(/(?:^|\s):([a-zA-Z0-9_+-]{2,})$/)
        if (emojiMatch) {
          setEmojiQuery(emojiMatch[1].toLowerCase())
          setEmojiStart(cursorPos - emojiMatch[1].length - 1) // -1 for ':'
          setEmojiIndex(0)
          setShowEmoji(false)
        } else {
          setEmojiQuery(null)
        }
      }
    }

    if (value.length > 0) {
      sendTyping(roomId, true)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = setTimeout(() => {
        sendTyping(roomId, false)
      }, 4000)
    } else {
      sendTyping(roomId, false)
    }
  }

  const filteredMembers = mentionQuery !== null && activeRoom
    ? activeRoom.members.filter(m =>
        m.displayName.toLowerCase().includes(mentionQuery) ||
        m.userId.toLowerCase().includes(mentionQuery)
      ).slice(0, 8)
    : []

  const filteredEmojis = useMemo(() => {
    if (emojiQuery === null) return []
    return Object.entries(EMOJI_MAP)
      .filter(([key]) => key.includes(emojiQuery))
      .slice(0, 8)
      .map(([shortcode, emoji]) => ({ shortcode, emoji }))
  }, [emojiQuery])

  const insertEmoji = (item: { shortcode: string; emoji: string }) => {
    const before = content.slice(0, emojiStart)
    const after = content.slice(inputRef.current?.selectionStart ?? content.length)
    const newContent = `${before}${item.emoji} ${after}`
    setContent(newContent)
    setEmojiQuery(null)
    requestAnimationFrame(() => {
      const pos = emojiStart + item.emoji.length + 1
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  const insertMention = (member: { userId: string; displayName: string }) => {
    const before = content.slice(0, mentionStart)
    const after = content.slice(inputRef.current?.selectionStart ?? content.length)
    const name = member.displayName.startsWith('@') ? member.displayName.slice(1) : member.displayName
    const mention = `${name} `
    const newContent = `${before}@${mention}${after}`
    setContent(newContent)
    setMentionQuery(null)
    // Restore focus and cursor position
    requestAnimationFrame(() => {
      const pos = mentionStart + 1 + mention.length
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  const handleSlashCommand = async (trimmed: string): Promise<boolean> => {
    const client = getMatrixClient()
    if (!client) return false

    // /me <action> - Send an emote
    const meMatch = trimmed.match(/^\/me\s+([\s\S]+)$/)
    if (meMatch) {
      const action = meMatch[1]
      await (client as any).sendEvent(roomId, 'm.room.message', {
        msgtype: 'm.emote',
        body: action,
      })
      setCommandStatus({ type: 'success', message: 'Emote sent' })
      return true
    }

    // /nick <name> - Change display name
    const nickMatch = trimmed.match(/^\/nick\s+([\s\S]+)$/)
    if (nickMatch) {
      await setDisplayName(nickMatch[1])
      setCommandStatus({ type: 'success', message: `Display name changed to "${nickMatch[1]}"` })
      return true
    }

    // /topic <topic> - Set room topic
    const topicMatch = trimmed.match(/^\/topic\s+([\s\S]+)$/)
    if (topicMatch) {
      await setRoomTopic(roomId, topicMatch[1])
      setCommandStatus({ type: 'success', message: 'Room topic updated' })
      return true
    }

    // /invite <userId> - Invite user to room
    const inviteMatch = trimmed.match(/^\/invite\s+(\S+)$/)
    if (inviteMatch) {
      await inviteMember(roomId, inviteMatch[1])
      setCommandStatus({ type: 'success', message: `Invited ${inviteMatch[1]}` })
      return true
    }

    // /join <roomId> - Join a room
    const joinMatch = trimmed.match(/^\/join\s+(\S+)$/)
    if (joinMatch) {
      await joinRoom(joinMatch[1])
      setCommandStatus({ type: 'success', message: `Joined ${joinMatch[1]}` })
      return true
    }

    // /shrug [message] - Prepend shrug to message
    const shrugMatch = trimmed.match(/^\/shrug(?:\s+([\s\S]*))?$/)
    if (shrugMatch) {
      const shrugMsg = `¯\\_(ツ)_/¯${shrugMatch[1] ? ' ' + shrugMatch[1] : ''}`
      await onSend(shrugMsg)
      return true
    }

    return false
  }

  const handleSubmit = async () => {
    const trimmed = content.trim()
    const hasFiles = pendingFiles.length > 0

    if (!trimmed && !hasFiles) return
    // No blocking check — uploads run in background

    setCommandStatus(null)
    sendTyping(roomId, false)
    try {
      // Upload pending files — fire and forget so input stays usable.
      // Each upload is tracked in uploadStore with progress bar.
      if (hasFiles) {
        for (const file of pendingFiles) {
          uploadFile(roomId, file).catch(err => {
            console.error('File upload failed:', err)
          })
        }
        setPendingFiles([])
      }
      // Check for slash commands
      if (trimmed && trimmed.startsWith('/')) {
        try {
          const handled = await handleSlashCommand(trimmed)
          if (handled) {
            setContent('')
            inputRef.current?.focus()
            return
          }
        } catch (err) {
          setCommandStatus({ type: 'error', message: err instanceof Error ? err.message : 'Command failed' })
          return
        }
      }
      // Send text message if present — non-blocking, message appears optimistically
      if (trimmed) {
        onSend(trimmed)
      }
      setContent('')
      inputRef.current?.focus()
    } catch (err) {
      console.error('Send failed:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle emoji popup navigation
    if (emojiQuery !== null && filteredEmojis.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setEmojiIndex(i => (i + 1) % filteredEmojis.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setEmojiIndex(i => (i - 1 + filteredEmojis.length) % filteredEmojis.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertEmoji(filteredEmojis[emojiIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setEmojiQuery(null)
        return
      }
    }
    // Handle mention popup navigation
    if (mentionQuery !== null && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => (i + 1) % filteredMembers.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => (i - 1 + filteredMembers.length) % filteredMembers.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(filteredMembers[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleEmojiClick = (emoji: string) => {
    setContent(prev => prev + emoji)
    inputRef.current?.focus()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      setPendingFiles(prev => [...prev, ...files])
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Handle paste events for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter(item => item.type.startsWith('image/'))
    if (imageItems.length > 0) {
      e.preventDefault()
      const files: File[] = []
      for (const item of imageItems) {
        const file = item.getAsFile()
        if (file) {
          // Give pasted images a descriptive name
          const ext = file.type.split('/')[1] || 'png'
          const namedFile = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: file.type })
          files.push(namedFile)
        }
      }
      if (files.length > 0) {
        setPendingFiles(prev => [...prev, ...files])
      }
    }
  }, [])

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <ImageIcon className="h-4 w-4" />
    return <FileText className="h-4 w-4" />
  }

  // Memoize file preview blob URLs to avoid creating new ones on every render.
  // Revoke stale URLs when files are removed or component unmounts.
  const previewUrlsRef = useRef<Map<File, string>>(new Map())
  const filePreviewUrls = useMemo(() => {
    const prev = previewUrlsRef.current
    const next = new Map<File, string>()
    for (const file of pendingFiles) {
      if (file.type.startsWith('image/')) {
        next.set(file, prev.get(file) || URL.createObjectURL(file))
      }
    }
    // Revoke URLs for removed files
    for (const [file, url] of prev) {
      if (!next.has(file)) URL.revokeObjectURL(url)
    }
    previewUrlsRef.current = next
    return next
  }, [pendingFiles])

  // Revoke all preview URLs on unmount
  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current.values()) URL.revokeObjectURL(url)
    }
  }, [])

  const getFilePreview = (file: File) => filePreviewUrls.get(file) ?? null

  return (
    <div className="bg-m3-surface-container-lowest px-3 py-2.5 dark:bg-m3-surface md:px-4 md:py-3">
      {/* Formatting toolbar */}
      {showToolbar && (
        <FormattingToolbar onInsert={(prefix, suffix) => {
          const textarea = inputRef.current
          if (!textarea) return
          const start = textarea.selectionStart
          const end = textarea.selectionEnd
          const selected = content.substring(start, end)
          const newContent = content.substring(0, start) + prefix + selected + suffix + content.substring(end)
          setContent(newContent)
          setTimeout(() => {
            textarea.focus()
            textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length)
          }, 0)
        }} />
      )}

      {/* Command status */}
      {commandStatus && (
        <div
          className={`mb-3 flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
            commandStatus.type === 'success'
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-m3-error-container text-m3-on-error-container dark:bg-m3-error-container/20 dark:text-m3-error'
          }`}
        >
          <span>{commandStatus.message}</span>
          <button
            onClick={() => setCommandStatus(null)}
            className="ml-2 flex-shrink-0 rounded p-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Reply preview */}
      {replyTo && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border-l-2 border-m3-primary bg-m3-surface-container px-3 py-2 animate-slide-in dark:bg-m3-surface-container-high">
          <Reply className="h-4 w-4 flex-shrink-0 text-m3-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-m3-primary dark:text-m3-primary">
              Replying to {replyTo.senderName}
            </p>
            <p className="truncate text-xs text-m3-on-surface-variant dark:text-m3-outline">{replyTo.content}</p>
          </div>
          <button
            onClick={onCancelReply}
            className="flex-shrink-0 rounded p-1 text-m3-outline transition-colors hover:bg-m3-surface-container-high hover:text-m3-on-surface dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {pendingFiles.map((file, idx) => {
            const preview = getFilePreview(file)
            return (
              <div
                key={`${file.name}-${idx}`}
                className="group relative flex items-center gap-2 rounded-lg border border-m3-outline-variant bg-m3-surface-container-low p-2 shadow-sm dark:border-m3-outline-variant dark:bg-m3-surface-container-high"
              >
                {preview ? (
                  <img src={preview} alt={file.name} className="h-12 w-12 rounded object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded bg-m3-surface-container-high dark:bg-m3-surface-container-highest">
                    {getFileIcon(file)}
                  </div>
                )}
                {!file.type.startsWith('image/') && (
                  <div className="max-w-[120px]">
                    <p className="truncate text-xs font-medium text-m3-on-surface dark:text-m3-on-surface-variant">{file.name}</p>
                    <p className="text-xs text-m3-outline">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                )}
                <button
                  onClick={() => removePendingFile(idx)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow-sm transition-transform hover:scale-110"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="relative flex items-center gap-2">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.tar,.gz"
        />

        {/* Mention autocomplete popup */}
        {mentionQuery !== null && filteredMembers.length > 0 && (
          <div
            ref={mentionRef}
            className="absolute bottom-full left-0 right-0 mb-1 max-h-52 overflow-y-auto rounded-xl border border-m3-outline-variant bg-m3-surface-container-lowest shadow-lg dark:border-m3-outline-variant dark:bg-m3-surface-container-high z-30"
          >
            {filteredMembers.map((member, i) => (
              <button
                key={member.userId}
                onMouseDown={e => {
                  e.preventDefault()
                  insertMention(member)
                }}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === mentionIndex
                    ? 'bg-m3-primary-container text-m3-on-primary-container dark:bg-m3-primary-container/30 dark:text-m3-primary'
                    : 'text-m3-on-surface hover:bg-m3-surface-container-low dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest/50'
                }`}
              >
                <Avatar src={member.avatarUrl} name={member.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{member.displayName}</p>
                  <p className="truncate text-xs text-m3-outline dark:text-m3-on-surface-variant">{member.userId}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Emoji autocomplete popup */}
        {emojiQuery !== null && filteredEmojis.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1 max-h-52 overflow-y-auto rounded-xl border border-m3-outline-variant bg-m3-surface-container-lowest shadow-lg dark:border-m3-outline-variant dark:bg-m3-surface-container-high z-30">
            {filteredEmojis.map((item, i) => (
              <button
                key={item.shortcode}
                onMouseDown={e => { e.preventDefault(); insertEmoji(item) }}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                  i === emojiIndex
                    ? 'bg-m3-primary-container text-m3-on-primary-container dark:bg-m3-primary-container/30 dark:text-m3-primary'
                    : 'text-m3-on-surface hover:bg-m3-surface-container-low dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest/50'
                }`}
              >
                <span className="text-2xl">{item.emoji}</span>
                <span className="text-m3-on-surface-variant dark:text-m3-outline">:{item.shortcode}:</span>
              </button>
            ))}
          </div>
        )}

        {/* Unified input bar — Google Messages style: pill contains input + action buttons */}
        {isRecording ? (
          <div className="flex flex-1 items-center gap-3 rounded-full border border-red-300 bg-m3-error-container px-5 py-2.5 shadow-sm dark:border-red-800 dark:bg-m3-error-container/20">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
            <span className="text-sm font-medium text-m3-error dark:text-m3-error">Recording {formatDuration(recordingDuration)}</span>
            <div className="flex-1" />
            <button onClick={cancelRecording} className="rounded-full p-1 text-m3-outline hover:text-m3-error" title="Cancel">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-1 items-center rounded-full border border-m3-outline-variant/40 bg-m3-surface-container-lowest dark:border-m3-outline-variant/40 dark:bg-m3-surface-container-high">
            {/* Emoji button — left side of input */}
            <div className="relative flex-shrink-0 pl-2" ref={emojiRef}>
              <button
                onClick={() => { setShowEmoji(!showEmoji); setEmojiQuery(null) }}
                className="flex h-9 w-9 items-center justify-center rounded-full text-m3-outline transition-colors hover:bg-m3-surface-container-high hover:text-m3-on-surface dark:hover:bg-m3-surface-container-highest dark:hover:text-white"
                aria-label="Emoji picker"
              >
                <Smile className="h-5 w-5" />
              </button>
              {showEmoji && (
                <div className="absolute bottom-12 left-0 z-20 w-[340px] rounded-xl border border-m3-outline-variant bg-m3-surface-container-lowest p-3 shadow-xl animate-slide-in dark:border-m3-outline-variant dark:bg-m3-surface-container-high">
                  {/* Category tabs */}
                  <div className="mb-2 flex gap-1 overflow-x-auto border-b border-m3-outline-variant pb-2 dark:border-m3-outline-variant">
                    {Object.keys(EMOJI_CATEGORIES).map(cat => (
                      <button
                        key={cat}
                        onClick={() => setEmojiCategory(cat)}
                        className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                          emojiCategory === cat
                            ? 'bg-m3-primary-container text-m3-primary dark:bg-m3-primary-container/30 dark:text-m3-primary'
                            : 'text-m3-on-surface-variant hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-highest'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  {/* Emoji grid */}
                  <div className="grid max-h-56 grid-cols-7 gap-0.5 overflow-y-auto">
                    {EMOJI_CATEGORIES[emojiCategory].map(emoji => (
                      <button
                        key={emoji}
                        onClick={() => handleEmojiClick(emoji)}
                        className="flex items-center justify-center rounded-lg p-2 text-2xl transition-transform hover:scale-110 hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-highest"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <textarea
              ref={inputRef}
              value={content}
              onChange={e => handleContentChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Type a message..."
              rows={1}
              enterKeyHint="send"
              className={`max-h-32 min-h-[42px] flex-1 resize-none bg-transparent px-3 py-2.5 text-m3-on-surface placeholder-m3-on-surface-variant focus:outline-none dark:text-m3-on-surface dark:placeholder-m3-outline md:min-h-[44px] md:py-3 ${isEmojiOnly(content) ? 'text-4xl leading-tight' : 'text-[15px]'}`}
            />
            {/* Action buttons — right side of input */}
            <div className="flex flex-shrink-0 items-center gap-0.5 pr-2">

              {/* Formatting toolbar toggle */}
              <button
                onClick={() => setShowToolbar(!showToolbar)}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-colors ${showToolbar ? 'text-m3-primary bg-m3-primary/10' : 'text-m3-on-surface-variant hover:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest'}`}
                title="Formatting"
              >
                Aa
              </button>

              {/* Attachment button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-9 w-9 items-center justify-center rounded-full text-m3-outline transition-colors hover:bg-m3-surface-container-high hover:text-m3-on-surface dark:hover:bg-m3-surface-container-highest dark:hover:text-white"
                title="Attach file"
                aria-label="Attach file"
              >
                <Paperclip className="h-5 w-5" />
              </button>

              {/* Image button */}
              <button
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.accept = 'image/*'
                    fileInputRef.current.click()
                    // Reset accept after click
                    requestAnimationFrame(() => {
                      if (fileInputRef.current) fileInputRef.current.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.tar,.gz'
                    })
                  }
                }}
                className="hidden sm:flex h-9 w-9 items-center justify-center rounded-full text-m3-outline transition-colors hover:bg-m3-surface-container-high hover:text-m3-on-surface dark:hover:bg-m3-surface-container-highest dark:hover:text-white"
                title="Send image"
                aria-label="Send image"
              >
                <ImageIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

        {/* Send / Stop / Mic button — outside the pill */}
        {isRecording ? (
          <button
            onClick={stopRecording}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-white transition-all hover:bg-red-600 active:bg-red-700"
            title="Stop recording"
            aria-label="Stop recording"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : !content.trim() && pendingFiles.length === 0 ? (
          <button
            onClick={startRecording}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-m3-surface-container-high text-m3-on-surface-variant transition-all hover:bg-m3-outline-variant active:bg-m3-outline-variant dark:bg-m3-surface-container-highest dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest"
            title="Record voice message"
            aria-label="Record voice message"
          >
            <Mic className="h-5 w-5" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!content.trim() && pendingFiles.length === 0}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-m3-primary text-white shadow-sm transition-all hover:bg-m3-primary/90 active:bg-m3-primary/80 disabled:opacity-30"
            aria-label="Send message"
          >
            <Send className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  )
}
