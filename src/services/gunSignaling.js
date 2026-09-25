/**
 * Nexus P2P Messenger - Robust Multi-Peer WebRTC Signaling & Mesh
 * Features:
 * - Persistent connection pool (multi-contact messaging & presence)
 * - Automatic background/mobile data presence tracking:
 *     🟢 Active (in app)
 *     🟡 Away (online in background / mobile data on)
 *     ⚪ Offline (no internet / disconnected)
 * - Automatic store-and-forward outbox sync upon connection
 * - Delivery receipt confirmations (✓ sent, ✓✓ delivered)
 * - WebRTC Audio/Video calling with fallback signaling
 * - Multi-listener event emitter architecture
 */
import peerjsPkg from 'peerjs';
import contactService from './contactService';

const Peer = peerjsPkg.Peer || peerjsPkg.default?.Peer || peerjsPkg.default || peerjsPkg;

// Primary STUN & TURN servers for mobile networks (4G/5G, NAT traversal)
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Open Relay Project (Metered.ca free public TURN for strict symmetric NAT)
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export class P2PNetworkService {
  constructor() {
    this.peer = null;
    this.myPeerId = this.getOrCreatePeerId();
    
    // Connection pool: peerId (lowercase) -> DataConnection
    this.connections = new Map();
    
    // Presence map: peerId (lowercase) -> { status: 'active' | 'away' | 'offline', lastSeen: number }
    this.peerPresence = new Map();

    // Call tracking
    this.activeMediaCall = null;
    this.incomingMediaCall = null;
    this.localStream = null;
    this.remoteStream = null;

    this.isServerConnected = false;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.activeRemotePeerId = null;

    // Multi-subscriber Event Listeners Map: eventName -> Set<Function>
    this.listeners = new Map([
      ['onConnectionStateChange', new Set()],
      ['onMessage', new Set()],
      ['onMessageAck', new Set()],
      ['onPresenceChange', new Set()],
      ['onFileMeta', new Set()],
      ['onFileChunk', new Set()],
      ['onIncomingCall', new Set()],
      ['onCallAccepted', new Set()],
      ['onCallRejected', new Set()],
      ['onCallEnded', new Set()],
      ['onRemoteStream', new Set()],
      ['onIceStateChange', new Set()],
      ['onSignalingStatus', new Set()],
    ]);

    this.initPeer();
    this.initBroadcastFallback();
    this.initNetworkAndVisibilityListeners();
  }

  getOrCreatePeerId() {
    let id = localStorage.getItem('nexus_peer_id');
    if (!id) {
      const rand = Math.random().toString(36).substring(2, 8);
      id = `nexus-${rand}`;
      localStorage.setItem('nexus_peer_id', id);
    }
    return id.trim().toLowerCase();
  }

  getMyPeerId() {
    return this.myPeerId;
  }

  setPeerId(newId) {
    if (!newId || newId.trim() === '') return;
    const cleanId = newId.trim().toLowerCase();
    if (cleanId === this.myPeerId) return;

    this.myPeerId = cleanId;
    localStorage.setItem('nexus_peer_id', this.myPeerId);

    // Reinitialize peer with new identity
    this.initPeer();
  }

  /**
   * Event Subscription system supporting multiple listeners
   * Returns an unsubscribe function.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit(event, ...args) {
    const subs = this.listeners.get(event);
    if (subs) {
      subs.forEach((cb) => {
        try {
          cb(...args);
        } catch (e) {
          console.warn(`[P2P] Error in listener for ${event}:`, e);
        }
      });
    }
  }

  /**
   * Returns current user's own status:
   * 🟢 'active'  - in app and connected
   * 🟡 'away'    - phone internet/data is ON, but app is in background/screen locked
   * ⚪ 'offline' - no internet or disconnected
   */
  getMyStatus() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'offline';
    }
    if (!this.isServerConnected) {
      return 'offline';
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      return 'active';
    }
    return 'away'; // Phone data is ON, app is in background
  }

  /**
   * Get presence status of a remote contact
   * Returns 'active' | 'away' | 'offline'
   */
  getPeerStatus(peerId) {
    if (!peerId) return 'offline';
    const cleanId = peerId.toLowerCase();
    const entry = this.peerPresence.get(cleanId);
    if (!entry) return 'offline';

    // If no heartbeat received in last 35 seconds, consider offline
    if (Date.now() - entry.lastSeen > 35000) {
      return 'offline';
    }
    return entry.status;
  }

  /**
   * Network (Mobile Data/WiFi) and Visibility listeners
   * Automatically switches between:
   * 🟢 Active (app in foreground)
   * 🟡 Away (mobile data ON, app in background)
   * ⚪ Offline (mobile data OFF)
   */
  initNetworkAndVisibilityListeners() {
    if (typeof window === 'undefined') return;

    // Detect Phone Mobile Data or WiFi turned ON
    window.addEventListener('online', () => {
      console.log('[P2P] Network online detected. Reconnecting signaling...');
      this.emit('onSignalingStatus', 'connecting');
      if (this.peer && !this.peer.destroyed) {
        if (this.peer.disconnected) {
          this.peer.reconnect();
        }
      } else {
        this.initPeer();
      }

      // Broadcast presence as soon as connected
      setTimeout(() => {
        this.broadcastMyPresence();
      }, 1500);
    });

    // Detect Phone Mobile Data or WiFi turned OFF
    window.addEventListener('offline', () => {
      console.log('[P2P] Network offline detected.');
      this.isServerConnected = false;
      this.emit('onSignalingStatus', 'offline');
      this.emit('onConnectionStateChange', 'disconnected');
    });

    // Detect App Minimized, Screen Locked, or Tab Switched
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        const isVisible = document.visibilityState === 'visible';
        console.log(`[P2P] Visibility changed: ${isVisible ? 'active (in app)' : 'away (background)'}`);
        this.broadcastMyPresence();
      });

      // Window focus/blur extra safety
      window.addEventListener('focus', () => this.broadcastMyPresence());
      window.addEventListener('blur', () => this.broadcastMyPresence());
    }

    // Clean teardown on unload
    window.addEventListener('beforeunload', () => {
      this.broadcastPresence('offline');
      if (this.peer && !this.peer.destroyed) {
        try {
          this.peer.destroy();
        } catch (e) {}
      }
    });
  }

  /**
   * Broadcast current user's presence to all connected peers
   */
  broadcastMyPresence() {
    const status = this.getMyStatus();
    this.broadcastPresence(status);
  }

  broadcastPresence(status) {
    const payload = {
      type: 'presence',
      peerId: this.myPeerId,
      status,
      timestamp: Date.now(),
    };

    // Send to all open connections
    this.connections.forEach((conn) => {
      if (conn && conn.open) {
        try {
          conn.send(payload);
        } catch (e) {}
      }
    });

    // Send via local BroadcastChannel
    if (this.bc) {
      this.bc.postMessage({
        type: 'presence',
        payload,
      });
    }
  }

  /**
   * Initialize PeerJS signaling
   */
  initPeer() {
    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch (e) {}
    }

    this.isServerConnected = false;
    this.emit('onSignalingStatus', 'connecting');

    try {
      this.peer = new Peer(this.myPeerId, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        pingInterval: 5000,
        config: {
          iceServers: ICE_SERVERS,
          iceCandidatePoolSize: 10,
        },
      });

      this.peer.on('open', (id) => {
        this.myPeerId = id;
        this.isServerConnected = true;
        console.log('[P2P] Connected to signaling server as:', id);
        this.emit('onSignalingStatus', 'connected');

        // Start heartbeat ping cycle
        this.startHeartbeatCycle();

        // Broadcast presence
        this.broadcastMyPresence();

        // Auto connect or re-verify active target
        if (this.activeRemotePeerId) {
          this.connectToPeer(this.activeRemotePeerId);
        }
      });

      // Handle Incoming Data Connections
      this.peer.on('connection', (conn) => {
        console.log('[P2P] Received incoming connection from:', conn.peer);
        this.setupConnection(conn, false);
      });

      // Handle Incoming Calls
      this.peer.on('call', (mediaCall) => {
        console.log('[P2P] Received incoming media call from:', mediaCall.peer);
        this.incomingMediaCall = mediaCall;
        const isVideo = !!mediaCall.metadata?.isVideo;
        const callerName = mediaCall.metadata?.callerName || mediaCall.metadata?.callerId || mediaCall.peer;

        this.emit('onIncomingCall', {
          callerId: mediaCall.peer.toLowerCase(),
          callerName,
          isVideo,
          timestamp: Date.now(),
        });
      });

      this.peer.on('disconnected', () => {
        console.warn('[P2P] Disconnected from signaling server.');
        this.isServerConnected = false;
        this.emit('onSignalingStatus', 'disconnected');
        if (this.peer && !this.peer.destroyed) {
          try {
            this.peer.reconnect();
          } catch (e) {}
        }
      });

      this.peer.on('close', () => {
        this.isServerConnected = false;
        this.emit('onSignalingStatus', 'closed');
      });

      this.peer.on('error', (err) => {
        console.warn('[P2P] PeerJS error:', err.type, err.message);

        if (err.type === 'peer-unavailable') {
          const target = this.activeRemotePeerId;
          if (target) {
            this.peerPresence.set(target, { status: 'offline', lastSeen: Date.now() });
            this.emit('onPresenceChange', { peerId: target, status: 'offline' });
            this.emit('onConnectionStateChange', 'disconnected', target);
          }
        } else if (err.type === 'unavailable-id') {
          // In case ID is temporarily locked, wait and recreate
          setTimeout(() => {
            if (this.peer && this.peer.destroyed) {
              this.initPeer();
            }
          }, 3000);
        } else if (err.type === 'network' || err.type === 'server-error') {
          if (this.peer && !this.peer.destroyed) {
            setTimeout(() => {
              try {
                this.peer.reconnect();
              } catch (e) {}
            }, 3000);
          }
        }
      });
    } catch (err) {
      console.error('[P2P] Peer initialization exception:', err);
    }
  }

  /**
   * BroadcastChannel for instant testing in multiple browser tabs on same machine
   */
  initBroadcastFallback() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.bc = new BroadcastChannel('nexus_p2p_mesh');
        this.bc.onmessage = (event) => {
          const { type, targetPeerId, payload } = event.data || {};
          if (targetPeerId && targetPeerId.toLowerCase() !== this.myPeerId) return;

          if (type === 'data') {
            this.handleIncomingData(payload, payload?.sender || targetPeerId);
          } else if (type === 'presence' && payload) {
            const pid = payload.peerId?.toLowerCase();
            if (pid) {
              this.peerPresence.set(pid, { status: payload.status, lastSeen: Date.now() });
              this.emit('onPresenceChange', { peerId: pid, status: payload.status });
            }
          }
        };
      } catch (e) {}
    }
  }

  /**
   * Connect to a remote peer via WebRTC DataConnection
   */
  connectToPeer(targetPeerId) {
    if (!targetPeerId) return;
    const cleanId = targetPeerId.trim().toLowerCase();
    if (cleanId === this.myPeerId) return;

    this.activeRemotePeerId = cleanId;

    // Check existing connection in pool
    const existing = this.connections.get(cleanId);
    if (existing && existing.open) {
      this.emit('onConnectionStateChange', 'connected', cleanId);
      this.sendPresenceToPeer(existing);
      this.flushOutboxForPeer(cleanId);
      return;
    }

    this.emit('onConnectionStateChange', 'connecting', cleanId);

    if (!this.peer || !this.isServerConnected || this.peer.destroyed) {
      return;
    }

    try {
      const conn = this.peer.connect(cleanId, {
        reliable: true,
      });
      this.setupConnection(conn, true);
    } catch (err) {
      console.warn('[P2P] Failed to connect to peer:', cleanId, err);
      this.emit('onConnectionStateChange', 'disconnected', cleanId);
    }
  }

  /**
   * Setup event listeners on a DataConnection (both incoming and outgoing)
   */
  setupConnection(conn, isOutgoing) {
    const peerId = conn.peer.toLowerCase();

    // Check if we already have an open working connection to this peer
    const current = this.connections.get(peerId);
    if (current && current.open && current !== conn) {
      // Tie-breaking: keep the canonical connection
      if (this.myPeerId < peerId && isOutgoing) {
        try { current.close(); } catch (e) {}
      } else {
        try { conn.close(); } catch (e) {}
        return;
      }
    }

    conn.on('open', () => {
      console.log(`[P2P] DataConnection OPEN with: ${peerId}`);
      this.connections.set(peerId, conn);

      // Default peer presence to away until active status confirmed
      if (!this.peerPresence.has(peerId)) {
        this.peerPresence.set(peerId, { status: 'away', lastSeen: Date.now() });
      }

      this.emit('onConnectionStateChange', 'connected', peerId);

      // Exchange presence
      this.sendPresenceToPeer(conn);

      // Automatically send any pending outbox messages
      this.flushOutboxForPeer(peerId);
    });

    conn.on('data', (data) => {
      this.handleIncomingData(data, peerId);
    });

    conn.on('close', () => {
      console.log(`[P2P] DataConnection CLOSED with: ${peerId}`);
      if (this.connections.get(peerId) === conn) {
        this.connections.delete(peerId);
        this.peerPresence.set(peerId, { status: 'offline', lastSeen: Date.now() });
        this.emit('onPresenceChange', { peerId, status: 'offline' });
        if (this.activeRemotePeerId === peerId) {
          this.emit('onConnectionStateChange', 'disconnected', peerId);
        }
      }
    });

    conn.on('error', (err) => {
      console.warn(`[P2P] DataConnection error with ${peerId}:`, err);
    });

    if (conn.peerConnection) {
      conn.peerConnection.oniceconnectionstatechange = () => {
        const ice = conn.peerConnection.iceConnectionState;
        this.emit('onIceStateChange', ice);
      };
    }
  }

  sendPresenceToPeer(conn) {
    if (conn && conn.open) {
      try {
        conn.send({
          type: 'presence',
          peerId: this.myPeerId,
          status: this.getMyStatus(),
          timestamp: Date.now(),
        });
      } catch (e) {}
    }
  }

  /**
   * Heartbeat cycle: Keeps NAT pinholes open, exchanges presence heartbeats every 12 seconds
   */
  startHeartbeatCycle() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      const myStatus = this.getMyStatus();

      this.connections.forEach((conn, peerId) => {
        if (conn && conn.open) {
          try {
            conn.send({
              type: '__ping__',
              sender: this.myPeerId,
              status: myStatus,
              timestamp: Date.now(),
            });
          } catch (e) {}
        }
      });

      // Cleanup stale presence
      const now = Date.now();
      this.peerPresence.forEach((entry, pid) => {
        if (entry.status !== 'offline' && now - entry.lastSeen > 35000) {
          entry.status = 'offline';
          this.emit('onPresenceChange', { peerId: pid, status: 'offline' });
        }
      });
    }, 12000);
  }

  /**
   * Flush outbox messages for a peer when connection opens
   */
  flushOutboxForPeer(peerId) {
    if (!peerId || !this.myPeerId) return;
    const cleanId = peerId.toLowerCase();
    const conn = this.connections.get(cleanId);
    if (!conn || !conn.open) return;

    const outbox = contactService.getOutbox(this.myPeerId, cleanId);
    if (outbox && outbox.length > 0) {
      console.log(`[P2P] Flushing ${outbox.length} pending outbox messages to ${cleanId}...`);
      outbox.forEach((msg) => {
        try {
          conn.send({
            type: 'chat',
            id: msg.id,
            text: msg.text,
            sender: this.myPeerId,
            timestamp: msg.timestamp || Date.now(),
          });
          contactService.removeFromOutbox(this.myPeerId, cleanId, msg.id);
          contactService.updateMessageStatus(this.myPeerId, cleanId, msg.id, 'sent');
        } catch (e) {}
      });
    }
  }

  /**
   * Process all incoming data channel payloads
   */
  handleIncomingData(data, senderPeerId) {
    if (!data) return;

    let payload = data;
    if (typeof data === 'string') {
      try {
        payload = JSON.parse(data);
      } catch (e) {
        payload = { type: 'chat', text: data, sender: senderPeerId };
      }
    }

    const fromPeer = (payload.sender || payload.peerId || senderPeerId || '').toLowerCase();

    // Heartbeat ping/pong with presence status
    if (payload.type === '__ping__') {
      if (fromPeer) {
        const remoteStatus = payload.status || 'away';
        this.peerPresence.set(fromPeer, { status: remoteStatus, lastSeen: Date.now() });
        this.emit('onPresenceChange', { peerId: fromPeer, status: remoteStatus });
      }

      const conn = this.connections.get(fromPeer);
      if (conn && conn.open) {
        try {
          conn.send({
            type: '__pong__',
            sender: this.myPeerId,
            status: this.getMyStatus(),
            timestamp: Date.now(),
          });
        } catch (e) {}
      }
      return;
    }

    if (payload.type === '__pong__') {
      if (fromPeer) {
        const remoteStatus = payload.status || 'away';
        this.peerPresence.set(fromPeer, { status: remoteStatus, lastSeen: Date.now() });
        this.emit('onPresenceChange', { peerId: fromPeer, status: remoteStatus });
      }
      return;
    }

    // Presence update notification
    if (payload.type === 'presence') {
      if (fromPeer) {
        const newStatus = payload.status || 'away';
        this.peerPresence.set(fromPeer, { status: newStatus, lastSeen: Date.now() });
        this.emit('onPresenceChange', { peerId: fromPeer, status: newStatus });
      }
      return;
    }

    // Delivery Receipt acknowledgment
    if (payload.type === 'ack') {
      if (fromPeer && payload.messageId) {
        contactService.updateMessageStatus(this.myPeerId, fromPeer, payload.messageId, 'delivered');
      }
      this.emit('onMessageAck', { messageId: payload.messageId, peerId: fromPeer, timestamp: payload.timestamp });
      return;
    }

    // Call response (reject / cancel)
    if (payload.type === 'call-response') {
      if (payload.action === 'reject') {
        this.emit('onCallRejected', { from: fromPeer, reason: payload.reason || 'declined' });
      } else if (payload.action === 'cancel') {
        this.emit('onCallEnded', { from: fromPeer, reason: 'cancelled' });
      }
      return;
    }

    // Incoming Chat Message
    if (payload.type === 'chat') {
      const msgId = payload.id || `msg_${Date.now()}`;
      const text = payload.text || '';
      const timestamp = payload.timestamp || Date.now();

      // 1. Send immediate receipt acknowledgment (✓✓ delivered)
      const conn = this.connections.get(fromPeer);
      if (conn && conn.open) {
        try {
          conn.send({
            type: 'ack',
            messageId: msgId,
            timestamp: Date.now(),
          });
        } catch (e) {}
      }

      // 2. Persist message in local contact store
      const chatItem = {
        id: msgId,
        text,
        sender: fromPeer,
        timestamp,
        isSelf: false,
        status: 'delivered',
      };
      contactService.saveChatMessage(this.myPeerId, fromPeer, chatItem);
      contactService.updateLastMessage(this.myPeerId, fromPeer, text, timestamp);

      // 3. Emit message event to UI
      this.emit('onMessage', chatItem);
      return;
    }

    // File chunks and meta
    if (payload.type === 'file-meta') {
      this.emit('onFileMeta', payload);
    } else if (payload.type === 'file-chunk') {
      this.emit('onFileChunk', payload);
    } else {
      this.emit('onMessage', payload);
    }
  }

  /**
   * Send a chat message to a peer
   */
  sendChatMessage(messageText, targetPeerId = null, customId = null) {
    const target = (targetPeerId || this.activeRemotePeerId || '').toLowerCase();
    if (!target) return { sent: false, payload: null };

    const msgId = customId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const payload = {
      type: 'chat',
      id: msgId,
      text: messageText,
      sender: this.myPeerId,
      timestamp: Date.now(),
    };

    let sent = false;
    const conn = this.connections.get(target);

    if (conn && conn.open) {
      try {
        conn.send(payload);
        sent = true;
      } catch (e) {
        console.warn('[P2P] Failed to send over DataConnection:', e);
      }
    }

    // BroadcastChannel local fallback
    if (this.bc) {
      this.bc.postMessage({
        type: 'data',
        targetPeerId: target,
        payload,
      });
      sent = true;
    }

    // If not sent, queue in outbox for automatic forward upon connect
    if (!sent) {
      contactService.saveToOutbox(this.myPeerId, target, {
        id: msgId,
        text: messageText,
        sender: this.myPeerId,
        timestamp: Date.now(),
      });
      this.connectToPeer(target);
    }

    return { sent, payload };
  }

  /**
   * Send binary/chunk data with backpressure control
   */
  async sendChunkWithBackpressure(chunkPayload, targetPeerId = null) {
    const target = (targetPeerId || this.activeRemotePeerId || '').toLowerCase();
    const conn = this.connections.get(target);

    if (!conn || !conn.open) {
      if (this.bc) {
        this.bc.postMessage({
          type: 'data',
          targetPeerId: target,
          payload: chunkPayload,
        });
        return;
      }
      throw new Error('Connection not open');
    }

    const dataChannel = conn.dataChannel;
    const BUFFER_LIMIT = 262144; // 256KB threshold

    if (dataChannel && dataChannel.bufferedAmount > BUFFER_LIMIT) {
      await new Promise((resolve) => {
        const onBufferedLow = () => {
          dataChannel.removeEventListener('bufferedamountlow', onBufferedLow);
          resolve();
        };
        dataChannel.bufferedAmountLowThreshold = 65536;
        dataChannel.addEventListener('bufferedamountlow', onBufferedLow);
      });
    }

    conn.send(chunkPayload);
  }

  sendData(payload, targetPeerId = null) {
    const target = (targetPeerId || this.activeRemotePeerId || '').toLowerCase();
    const conn = this.connections.get(target);

    if (conn && conn.open) {
      try {
        conn.send(payload);
        return true;
      } catch (e) {}
    }

    if (this.bc) {
      this.bc.postMessage({
        type: 'data',
        targetPeerId: target,
        payload,
      });
      return true;
    }

    return false;
  }

  /**
   * Media Calling: Initiate Audio/Video Call
   */
  async initiateCall({ targetPeerId = null, isVideo = false }) {
    const target = (targetPeerId || this.activeRemotePeerId || '').toLowerCase();
    if (!target) {
      throw new Error('No recipient peer specified for call');
    }

    const constraints = {
      audio: true,
      video: isVideo ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    };

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

    const call = this.peer.call(target, this.localStream, {
      metadata: { isVideo, callerId: this.myPeerId, callerName: this.myPeerId },
    });

    this.activeMediaCall = call;
    this.setupCallListeners(call);

    return this.localStream;
  }

  /**
   * Media Calling: Accept Incoming Call
   */
  async acceptCall({ isVideo = false }) {
    if (!this.incomingMediaCall) return null;

    const constraints = {
      audio: true,
      video: isVideo ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    };

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

    this.incomingMediaCall.answer(this.localStream);
    this.activeMediaCall = this.incomingMediaCall;
    this.incomingMediaCall = null;

    this.setupCallListeners(this.activeMediaCall);
    this.emit('onCallAccepted', { from: this.activeMediaCall.peer, isVideo });

    return this.localStream;
  }

  setupCallListeners(call) {
    call.on('stream', (stream) => {
      this.remoteStream = stream;
      this.emit('onRemoteStream', stream);
      this.emit('onCallAccepted', { from: call.peer });
    });

    call.on('close', () => {
      this.emit('onCallEnded', { from: call.peer });
      this.cleanupCallMedia();
    });

    call.on('error', (err) => {
      console.warn('[P2P] Media call error:', err);
      this.emit('onCallEnded', { from: call.peer });
      this.cleanupCallMedia();
    });
  }

  rejectCall(reason = 'declined') {
    if (this.incomingMediaCall) {
      const caller = this.incomingMediaCall.peer;
      try {
        this.incomingMediaCall.close();
      } catch (e) {}
      this.incomingMediaCall = null;

      this.sendData({
        type: 'call-response',
        action: 'reject',
        reason,
      }, caller);
    }
  }

  endCall() {
    if (this.activeMediaCall) {
      const peer = this.activeMediaCall.peer;
      try {
        this.activeMediaCall.close();
      } catch (e) {}
      this.activeMediaCall = null;

      this.sendData({
        type: 'call-response',
        action: 'cancel',
      }, peer);
    }
    if (this.incomingMediaCall) {
      try {
        this.incomingMediaCall.close();
      } catch (e) {}
      this.incomingMediaCall = null;
    }
    this.cleanupCallMedia();
  }

  cleanupCallMedia() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
  }
}

// Singleton export
export const p2pService = new P2PNetworkService();
export default p2pService;
