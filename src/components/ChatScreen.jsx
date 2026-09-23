import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  Square,
  FileCheck,
  Download,
  HardDrive,
  Cloud,
  FileText,
  Video as VideoIcon,
  Music,
  Image as ImageIcon,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Loader2,
  AlertCircle,
  Play,
  Pause,
  ArrowLeft,
  Phone,
  PhoneMissed,
  PhoneIncoming,
  PhoneOutgoing,
  Video,
  User,
  Disc,
  RotateCcw,
} from 'lucide-react';
import storageService from '../services/storageService';
import contactService from '../services/contactService';
import audioRinger from '../services/audioRinger';

const CHUNK_SIZE = 16384; // 16KB chunk size for reliable WebRTC transport

export default function ChatScreen({
  p2p,
  myPeerId,
  remotePeerId,
  contactName,
  connectionState,
  onBack,
  onStartCall,
  onOpenSettings,
  onRetryConnect,
}) {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [activeTransfer, setActiveTransfer] = useState(null);
  const [savingFileId, setSavingFileId] = useState(null);
  const [peerPresence, setPeerPresence] = useState('away'); // 'active' | 'away' | 'offline'

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordTimerRef = useRef(null);

  const incomingFilesRef = useRef(new Map());

  // Load chat history when switching peers
  useEffect(() => {
    if (myPeerId && remotePeerId) {
      const history = contactService.getChatHistory(myPeerId, remotePeerId);
      setMessages(history);
    }
  }, [myPeerId, remotePeerId]);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, activeTransfer]);

  // Drain local outbox when connection is established
  const flushOutbox = useCallback(() => {
    if (connectionState === 'connected' && myPeerId && remotePeerId) {
      const outbox = contactService.getOutbox(myPeerId, remotePeerId);
      if (outbox.length > 0) {
        outbox.forEach((pendingMsg) => {
          const { sent } = p2p.sendChatMessage(pendingMsg.text, pendingMsg.id);
          if (sent) {
            contactService.removeFromOutbox(myPeerId, remotePeerId, pendingMsg.id);
            contactService.updateMessageStatus(myPeerId, remotePeerId, pendingMsg.id, 'sent');
            setMessages((prev) =>
              prev.map((m) => (m.id === pendingMsg.id ? { ...m, status: 'sent' } : m))
            );
          }
        });
      }
    }
  }, [connectionState, myPeerId, remotePeerId, p2p]);

  useEffect(() => {
    flushOutbox();
  }, [flushOutbox]);

  // Wire up P2P Network Data Channel events
  useEffect(() => {
    if (!p2p) return;

    // Track active peer presence
    p2p.on('onPresenceChange', ({ peerId, status }) => {
      if (peerId?.toLowerCase() === remotePeerId?.toLowerCase()) {
        setPeerPresence(status);
      }
    });

    // Delivery confirmation acknowledgment
    p2p.on('onMessageAck', ({ messageId }) => {
      if (myPeerId && remotePeerId) {
        contactService.updateMessageStatus(myPeerId, remotePeerId, messageId, 'delivered');
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, status: 'delivered' } : m))
        );
      }
    });

    // Incoming text/control messages
    p2p.on('onMessage', (msg) => {
      if (msg.type === 'chat') {
        const newMsg = {
          id: msg.id || `msg_${Date.now()}`,
          text: msg.text,
          sender: msg.sender || remotePeerId,
          timestamp: msg.timestamp || Date.now(),
          isSelf: false,
        };

        setMessages((prev) => [...prev, newMsg]);
        audioRinger.playMessageBeep();

        if (myPeerId && remotePeerId) {
          contactService.saveChatMessage(myPeerId, remotePeerId, newMsg);
          contactService.updateLastMessage(myPeerId, remotePeerId, msg.text, newMsg.timestamp);
        }
      }
    });

    // Incoming file metadata header
    p2p.on('onFileMeta', (meta) => {
      const { fileId, name, size, mimeType, totalChunks, thumbnail } = meta;
      incomingFilesRef.current.set(fileId, {
        meta,
        receivedChunks: new Map(),
        totalChunks,
        totalBytes: size,
      });

      setActiveTransfer({
        id: fileId,
        name,
        size,
        progress: 0,
        type: 'receive',
      });
    });

    // Incoming file chunk
    p2p.on('onFileChunk', (chunkData) => {
      const { fileId, index, chunk } = chunkData;
      const fileEntry = incomingFilesRef.current.get(fileId);
      if (!fileEntry) return;

      fileEntry.receivedChunks.set(index, chunk);
      const receivedCount = fileEntry.receivedChunks.size;
      const progress = Math.min(100, Math.round((receivedCount / fileEntry.totalChunks) * 100));

      setActiveTransfer((prev) => (prev && prev.id === fileId ? { ...prev, progress } : prev));

      // When all chunks are received
      if (receivedCount === fileEntry.totalChunks) {
        const sortedChunks = [];
        for (let i = 0; i < fileEntry.totalChunks; i++) {
          const b64 = fileEntry.receivedChunks.get(i);
          if (b64) {
            sortedChunks.push(base64ToArrayBuffer(b64));
          }
        }

        const reconstructedBlob = new Blob(sortedChunks, { type: fileEntry.meta.mimeType });
        const objectUrl = URL.createObjectURL(reconstructedBlob);

        const newFileMessage = {
          id: fileId,
          type: 'file',
          sender: remotePeerId,
          isSelf: false,
          timestamp: fileEntry.meta.timestamp || Date.now(),
          file: {
            name: fileEntry.meta.name,
            size: fileEntry.meta.size,
            mimeType: fileEntry.meta.mimeType,
            thumbnail: fileEntry.meta.thumbnail || null,
            blob: reconstructedBlob,
            url: objectUrl,
            savedLocation: null,
          },
        };

        setMessages((prev) => [...prev, newFileMessage]);
        incomingFilesRef.current.delete(fileId);
        setActiveTransfer(null);
        audioRinger.playMessageBeep();

        if (myPeerId && remotePeerId) {
          contactService.saveChatMessage(myPeerId, remotePeerId, {
            ...newFileMessage,
            file: { ...newFileMessage.file, blob: null },
          });
          contactService.updateLastMessage(
            myPeerId,
            remotePeerId,
            `📎 ${fileEntry.meta.name}`,
            newFileMessage.timestamp
          );
        }
      }
    });

    return () => {};
  }, [p2p, remotePeerId, myPeerId]);

  const base64ToArrayBuffer = (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };

  // Send message - supports Store & Forward queue on sender phone when offline
  const handleSendMessage = (e) => {
    e?.preventDefault();
    if (!inputMessage.trim()) return;

    const text = inputMessage.trim();
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const isOnline = connectionState === 'connected';

    const sentMsg = {
      id: msgId,
      text,
      sender: myPeerId,
      timestamp: Date.now(),
      isSelf: true,
      status: isOnline ? 'sent' : 'pending', // 'pending' 🕒 if offline, 'sent' ✓ if online
    };

    setMessages((prev) => [...prev, sentMsg]);
    setInputMessage('');

    if (myPeerId && remotePeerId) {
      contactService.saveChatMessage(myPeerId, remotePeerId, sentMsg);
      contactService.updateLastMessage(myPeerId, remotePeerId, sentMsg.text, sentMsg.timestamp);

      if (isOnline) {
        p2p.sendChatMessage(text, msgId);
      } else {
        // Option 1: Queue in sender's local outbox
        contactService.saveToOutbox(myPeerId, remotePeerId, sentMsg);
      }
    }
  };

  const generatePreviewThumbnail = async (file) => {
    if (file.type.startsWith('image/')) {
      return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 80;
          let w = img.width;
          let h = img.height;
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', 0.5));
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    }
    return null;
  };

  const handleSendFile = async (file) => {
    if (!file || connectionState !== 'connected') return;

    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const thumbnail = await generatePreviewThumbnail(file);

    const metaPayload = {
      type: 'file-meta',
      fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      totalChunks,
      chunkSize: CHUNK_SIZE,
      thumbnail,
      timestamp: Date.now(),
    };

    p2p.sendData(metaPayload);

    const fileMessage = {
      id: fileId,
      type: 'file',
      sender: myPeerId,
      isSelf: true,
      timestamp: Date.now(),
      status: 'sent',
      file: {
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        thumbnail,
        blob: file,
        url: URL.createObjectURL(file),
      },
    };
    setMessages((prev) => [...prev, fileMessage]);

    if (myPeerId && remotePeerId) {
      contactService.saveChatMessage(myPeerId, remotePeerId, {
        ...fileMessage,
        file: { ...fileMessage.file, blob: null },
      });
      contactService.updateLastMessage(
        myPeerId,
        remotePeerId,
        `📎 ${file.name}`,
        fileMessage.timestamp
      );
    }

    setActiveTransfer({
      id: fileId,
      name: file.name,
      size: file.size,
      progress: 0,
      type: 'send',
    });

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const slice = file.slice(start, end);

        const arrayBuf = await slice.arrayBuffer();
        const base64Chunk = arrayBufferToBase64(arrayBuf);

        await p2p.sendChunkWithBackpressure({
          type: 'file-chunk',
          fileId,
          index: i,
          chunk: base64Chunk,
        });

        const progress = Math.min(100, Math.round(((i + 1) / totalChunks) * 100));
        setActiveTransfer((prev) => (prev && prev.id === fileId ? { ...prev, progress } : prev));
      }
    } catch (err) {
      console.error('[FileTransfer] Chunk send error:', err);
    } finally {
      setTimeout(() => setActiveTransfer(null), 1000);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current.start(100);
      setIsRecording(true);
      setRecordDuration(0);

      recordTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.warn('Microphone error:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordTimerRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordTimerRef.current);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordDuration(0);
  };

  const sendVoiceRecording = () => {
    if (!audioBlob) return;
    const file = new File(
      [audioBlob],
      `voice_${Date.now()}.webm`,
      { type: 'audio/webm' }
    );
    handleSendFile(file);
    cancelRecording();
  };

  const handleSaveFile = async (msgId, file, destination) => {
    if (!file?.blob) return;
    setSavingFileId(msgId);
    try {
      if (destination === 'drive') {
        const res = await storageService.saveToGoogleDrive(file.blob, file.name, file.mimeType);
        updateMessageFileSaved(msgId, 'drive', res.link);
      } else {
        const res = await storageService.saveToDevice(file.blob, file.name, file.mimeType);
        if (res.success) {
          updateMessageFileSaved(msgId, 'device', res.uri || res.fileName);
        }
      }
    } catch (err) {
      console.warn('Save file failed:', err);
    } finally {
      setSavingFileId(null);
    }
  };

  const updateMessageFileSaved = (msgId, destination, link) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId) {
          const updated = {
            ...m,
            file: {
              ...m.file,
              savedLocation: destination,
              savedLink: link,
            },
          };
          if (myPeerId && remotePeerId) {
            contactService.saveChatMessage(myPeerId, remotePeerId, updated);
          }
          return updated;
        }
        return m;
      })
    );
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  };

  // Helper to format Call Log duration
  const formatCallDuration = (seconds) => {
    if (!seconds || seconds <= 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    }
    return `${secs}s`;
  };

  // Checkmark status helper for WhatsApp-like status
  const renderStatusIcon = (status, isSelf) => {
    if (!isSelf) return null;
    if (status === 'pending') {
      return <Clock className="w-3 h-3 text-amber-300 shrink-0" title="Queued (Offline)" />;
    }
    if (status === 'delivered') {
      return <CheckCheck className="w-3.5 h-3.5 text-cyan-300 shrink-0" title="Delivered" />;
    }
    return <Check className="w-3 h-3 text-slate-300 shrink-0" title="Sent" />;
  };

  const isPeerOnlineInApp = connectionState === 'connected' && peerPresence === 'active';

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden relative w-full">
      {/* 1. Header Bar */}
      <header
        className="min-h-14 border-b border-slate-800 bg-slate-950/95 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between z-20 shrink-0"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition shrink-0"
            title="Back to contacts"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            {/* Contact Avatar */}
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                {(contactName || remotePeerId).charAt(0).toUpperCase()}
              </div>
              {/* Online Green Dot (Only active when in app) */}
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-950 transition-colors ${
                  isPeerOnlineInApp
                    ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                    : connectionState === 'connected'
                    ? 'bg-amber-500'
                    : connectionState === 'connecting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-slate-600'
                }`}
                title={
                  isPeerOnlineInApp
                    ? 'Active in app'
                    : connectionState === 'connected'
                    ? 'Connected (background)'
                    : 'Offline'
                }
              />
            </div>

            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-100 truncate">
                {contactName || remotePeerId}
              </h2>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span
                  className={`font-medium ${
                    isPeerOnlineInApp
                      ? 'text-emerald-400 font-semibold'
                      : connectionState === 'connected'
                      ? 'text-amber-400'
                      : 'text-slate-400'
                  }`}
                >
                  {isPeerOnlineInApp
                    ? 'Active now'
                    : connectionState === 'connected'
                    ? 'Online (in background)'
                    : 'Offline (Queued)'}
                </span>
                <span className="text-slate-500">•</span>
                <span className="font-mono text-slate-400 truncate max-w-[100px] sm:max-w-none">
                  {remotePeerId}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Call Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onStartCall(false)}
            className="p-2 sm:p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-400 transition"
            title="Voice Call"
          >
            <Phone className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button
            onClick={() => onStartCall(true)}
            className="p-2 sm:p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-400 transition"
            title="Video Call"
          >
            <Video className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </header>

      {/* Offline Store & Forward Notification Pill */}
      {connectionState !== 'connected' && (
        <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-300 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 truncate">
            <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">
              Peer is offline. Messages will queue on your phone and deliver when online.
            </span>
          </div>
          <button
            onClick={onRetryConnect}
            className="px-2 py-0.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[10px] font-semibold transition shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* 2. Messages Timeline */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 max-w-4xl mx-auto w-full">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-16 px-4">
            <div className="h-16 w-16 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400 mb-4">
              <User className="h-8 w-8 text-cyan-400/80" />
            </div>
            <h3 className="text-base font-semibold text-slate-200">End-to-End Encrypted Chat</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
              Send messages or media anytime. If peer is offline, messages queue on your device and deliver once connected.
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isSelf = msg.isSelf ?? msg.sender === myPeerId;

          // A. WhatsApp-Style Call Log Bubble
          if (msg.type === 'call-log') {
            const isMissed = msg.status === 'missed';
            const isDeclined = msg.status === 'declined';
            const isVideoCall = msg.isVideo;

            let title = '';
            if (isMissed) {
              title = isVideoCall ? 'Missed video call' : 'Missed voice call';
            } else if (isDeclined) {
              title = isVideoCall ? 'Declined video call' : 'Declined voice call';
            } else {
              title = msg.isOutgoing
                ? isVideoCall ? 'Outgoing video call' : 'Outgoing voice call'
                : isVideoCall ? 'Incoming video call' : 'Incoming voice call';
            }

            return (
              <div key={msg.id} className="flex justify-center my-2 animate-in fade-in">
                <div className="max-w-xs sm:max-w-sm w-full rounded-2xl bg-slate-900/90 border border-slate-800 p-3 shadow-md backdrop-blur-sm flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl shrink-0 ${
                        isMissed || isDeclined
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}
                    >
                      {isMissed ? (
                        <PhoneMissed className="w-5 h-5 text-rose-400" />
                      ) : msg.isOutgoing ? (
                        <PhoneOutgoing className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <PhoneIncoming className="w-5 h-5 text-cyan-400" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <h4
                        className={`text-xs font-semibold truncate ${
                          isMissed ? 'text-rose-400' : 'text-slate-200'
                        }`}
                      >
                        {title}
                      </h4>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono mt-0.5">
                        {!isMissed && !isDeclined && msg.duration > 0 && (
                          <>
                            <span>{formatCallDuration(msg.duration)}</span>
                            <span>•</span>
                          </>
                        )}
                        <span>
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Callback Button */}
                  <button
                    onClick={() => onStartCall(isVideoCall)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-400 border border-slate-700 hover:border-cyan-500/40 transition active:scale-95 shrink-0 flex items-center gap-1"
                    title="Call Back"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">Call Back</span>
                  </button>
                </div>
              </div>
            );
          }

          // B. File / Media Message Card
          if (msg.type === 'file' && msg.file) {
            const { file } = msg;
            const isImage = file.mimeType?.startsWith('image/');
            const isVideoFile = file.mimeType?.startsWith('video/');
            const isAudioFile = file.mimeType?.startsWith('audio/');

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-md rounded-2xl p-3 border shadow-md ${
                    isSelf
                      ? 'bg-slate-900 border-cyan-500/30 rounded-br-none'
                      : 'bg-slate-900 border-slate-800 rounded-bl-none'
                  }`}
                >
                  {/* Image/Video Preview */}
                  {isImage && file.url && (
                    <div className="mb-2 rounded-xl overflow-hidden max-h-60 bg-black/40">
                      <img
                        src={file.url}
                        alt={file.name}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}

                  {isVideoFile && file.url && (
                    <div className="mb-2 rounded-xl overflow-hidden max-h-60 bg-black">
                      <video src={file.url} controls className="w-full h-full object-contain" />
                    </div>
                  )}

                  {isAudioFile && file.url && (
                    <div className="mb-2 flex items-center gap-2 bg-slate-950 p-2 rounded-xl">
                      <Music className="w-5 h-5 text-emerald-400 shrink-0" />
                      <audio src={file.url} controls className="h-8 w-full" />
                    </div>
                  )}

                  {/* File Metadata Bar */}
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-slate-800 text-cyan-400 shrink-0">
                      {isImage ? (
                        <ImageIcon className="w-5 h-5" />
                      ) : isVideoFile ? (
                        <VideoIcon className="w-5 h-5" />
                      ) : isAudioFile ? (
                        <Music className="w-5 h-5" />
                      ) : (
                        <FileText className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-200 truncate">{file.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {formatFileSize(file.size)} • Original Quality
                      </p>
                    </div>
                  </div>

                  {/* Save to Device or Google Drive */}
                  {!isSelf && file.blob && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center gap-2">
                      <button
                        disabled={savingFileId === msg.id}
                        onClick={() => handleSaveFile(msg.id, file, 'local')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
                      >
                        {savingFileId === msg.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                        <span>Save to Device</span>
                      </button>

                      <button
                        disabled={savingFileId === msg.id}
                        onClick={() => handleSaveFile(msg.id, file, 'drive')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 text-xs font-medium text-indigo-200 border border-indigo-700/50 transition"
                      >
                        <Cloud className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Google Drive</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-2 font-mono">
                  <span>
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {renderStatusIcon(msg.status, isSelf)}
                </div>
              </div>
            );
          }

          // C. Standard Text Message
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[80%] sm:max-w-md rounded-2xl px-4 py-2.5 text-sm ${
                  isSelf
                    ? 'bg-gradient-to-r from-cyan-600 to-indigo-600 text-white rounded-br-none shadow-md shadow-cyan-900/20'
                    : 'bg-slate-900 text-slate-100 rounded-bl-none border border-slate-800 shadow-sm'
                }`}
              >
                <p className="leading-relaxed break-words whitespace-pre-wrap">{msg.text}</p>
              </div>

              <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-2 font-mono">
                <span>
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                {renderStatusIcon(msg.status, isSelf)}
              </div>
            </div>
          );
        })}

        {/* Live Transfer Progress Pill */}
        {activeTransfer && (
          <div className="sticky bottom-2 z-30 p-3 rounded-2xl bg-slate-900/95 border border-cyan-500/30 backdrop-blur-md shadow-2xl animate-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
              <span className="text-slate-200 truncate max-w-[200px]">
                {activeTransfer.type === 'send' ? 'Streaming' : 'Receiving'}: {activeTransfer.name}
              </span>
              <span className="text-cyan-400 font-mono font-bold">{activeTransfer.progress}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                style={{ width: `${activeTransfer.progress}%` }}
                className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-200"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
              <span>Original binary chunks ({CHUNK_SIZE / 1024} KB)</span>
              <span>100% uncompressed</span>
            </p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Audio Recorder Panel (Active Recording State) */}
      {isRecording && (
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-rose-500 animate-ping" />
            <span className="text-xs font-mono font-bold text-rose-400">
              Recording Voice: {Math.floor(recordDuration / 60)}:
              {(recordDuration % 60).toString().padStart(2, '0')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={cancelRecording}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
            >
              Cancel
            </button>
            <button
              onClick={stopRecording}
              className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white flex items-center gap-1.5 transition"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Done</span>
            </button>
          </div>
        </div>
      )}

      {/* Audio Preview Before Sending */}
      {audioBlob && !isRecording && (
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2 flex-1">
            <Music className="w-5 h-5 text-emerald-400 shrink-0" />
            <audio controls src={audioUrl} className="h-8 max-w-[200px] sm:max-w-sm" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={cancelRecording}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
            >
              Discard
            </button>
            <button
              onClick={sendVoiceRecording}
              className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white flex items-center gap-1.5 shadow-lg shadow-cyan-600/30"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send Voice Note</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Chat Input Bar (Always Enabled for Offline Composition) */}
      <div className="bg-slate-900/95 border-t border-slate-800 pb-safe w-full">
        <form
          onSubmit={handleSendMessage}
          className="p-2 sm:p-3 max-w-4xl mx-auto flex items-center gap-1.5 sm:gap-2 relative z-10"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}
        >
          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleSendFile(file);
                e.target.value = '';
              }
            }}
          />

          {/* Attach File Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-slate-800 text-slate-300 hover:text-cyan-400 hover:bg-slate-700 transition shrink-0"
            title="Send original file (Photos, Videos, Audio, Docs)"
          >
            <Paperclip className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Voice Note Button */}
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            className={`p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition shrink-0 ${
              isRecording
                ? 'bg-rose-600 text-white animate-pulse'
                : 'bg-slate-800 text-slate-300 hover:text-cyan-400 hover:bg-slate-700'
            }`}
            title="Record Voice Note"
          >
            <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>

          {/* Text Input (Always enabled) */}
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={
              connectionState === 'connected'
                ? 'Type an encrypted message...'
                : 'Peer offline — message will queue in outbox...'
            }
            className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl sm:rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-slate-100 placeholder-slate-400 outline-none transition"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputMessage.trim()}
            className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-white transition disabled:opacity-30 disabled:pointer-events-none shadow-lg shadow-cyan-600/30 shrink-0"
            title="Send Message"
          >
            <Send className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
