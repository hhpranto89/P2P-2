import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Smartphone, X, AlertCircle, Bell } from 'lucide-react';
import p2pService from './services/gunSignaling';
import contactService from './services/contactService';
import storageService from './services/storageService';
import audioRinger from './services/audioRinger';
import notificationService from './services/notificationService';
import ContactsScreen from './components/ContactsScreen';
import ChatScreen from './components/ChatScreen';
import CallScreen from './components/CallScreen';
import SettingsModal from './components/SettingsModal';
import { useScreenMetrics } from './hooks/useScreenMetrics';

export default function App() {
  const [myPeerId, setMyPeerId] = useState(p2pService.getMyPeerId());
  const [currentScreen, setCurrentScreen] = useState('contacts'); // 'contacts' | 'chat'
  const [activeContact, setActiveContact] = useState(null); // { peerId, name }
  const [remotePeerId, setRemotePeerId] = useState('');
  const [contacts, setContacts] = useState([]);
  const [connectionState, setConnectionState] = useState('new');
  const [iceState, setIceState] = useState('');
  
  // Own online/background status: 'active' (green) | 'away' (yellow) | 'offline' (gray)
  const [myStatus, setMyStatus] = useState(p2pService.getMyStatus());
  
  // Contact presence map: peerId -> 'active' | 'away' | 'offline'
  const [presenceMap, setPresenceMap] = useState({});

  // Notification permission state
  const [notificationPermission, setNotificationPermission] = useState(
    notificationService.getPermissionState()
  );

  // Call states
  const [callState, setCallState] = useState('idle'); // 'idle' | 'calling' | 'incoming' | 'connected'
  const [callInfo, setCallInfo] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  // Call logging trackers
  const activeCallInfoRef = useRef(null);
  const isCallOutgoingRef = useRef(false);
  const callConnectedTimeRef = useRef(null);

  // Active chat tracker (for suppressing notifications when actively looking at the conversation)
  const activeChatPeerRef = useRef(null);
  useEffect(() => {
    activeChatPeerRef.current = currentScreen === 'chat' ? remotePeerId?.toLowerCase() : null;
  }, [currentScreen, remotePeerId]);

  // Modals & UI states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = useCallback((msg, duration = 3000) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, duration);
  }, []);

  // Screen metrics hook
  const metrics = useScreenMetrics();
  const { simulationPreset, setSimulationPreset } = metrics;

  // Refresh and broadcast status whenever network or visibility changes
  useEffect(() => {
    const updateStatus = () => {
      const s = p2pService.getMyStatus();
      setMyStatus(s);
    };

    updateStatus();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    document.addEventListener('visibilitychange', updateStatus);
    window.addEventListener('focus', updateStatus);
    window.addEventListener('blur', updateStatus);

    const unsubSignaling = p2pService.on('onSignalingStatus', () => updateStatus());

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
      document.removeEventListener('visibilitychange', updateStatus);
      window.removeEventListener('focus', updateStatus);
      window.removeEventListener('blur', updateStatus);
      unsubSignaling();
    };
  }, []);

  // Request system notifications permission helper
  const handleRequestNotifications = async () => {
    const granted = await notificationService.requestPermission();
    setNotificationPermission(notificationService.getPermissionState());
    if (granted) {
      showToast('Notifications enabled!');
    }
  };

  // Load saved contacts for this identity
  const refreshContacts = useCallback(() => {
    if (myPeerId) {
      const list = contactService.getContacts(myPeerId);
      setContacts(list);
    }
  }, [myPeerId]);

  useEffect(() => {
    refreshContacts();
  }, [refreshContacts]);

  // Check URL parameters for peer invite link (?peer=xyz or #peer=xyz)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let target = params.get('peer');
    if (!target && window.location.hash.startsWith('#peer=')) {
      target = window.location.hash.replace('#peer=', '');
    }

    if (target && target !== myPeerId) {
      const cleanTarget = target.trim().toLowerCase();
      setRemotePeerId(cleanTarget);
      const contact = contactService.saveContact(myPeerId, cleanTarget, cleanTarget);
      refreshContacts();
      setActiveContact(contact || { peerId: cleanTarget, name: cleanTarget });
      setCurrentScreen('chat');

      setTimeout(() => {
        handleConnect(cleanTarget);
      }, 500);
    }
  }, [myPeerId, refreshContacts]);

  const handleEndCall = useCallback((durationFromScreen = 0) => {
    p2pService.endCall();
    audioRinger.stop();

    const targetPeer = activeCallInfoRef.current?.peerId || remotePeerId;
    if (targetPeer) {
      notificationService.clearCallNotification(targetPeer);
    }

    if (targetPeer && myPeerId) {
      let finalDuration = durationFromScreen;
      let status = 'connected';

      if (callConnectedTimeRef.current) {
        if (!finalDuration) {
          finalDuration = Math.max(1, Math.round((Date.now() - callConnectedTimeRef.current) / 1000));
        }
        status = 'connected';
      } else {
        finalDuration = 0;
        status = isCallOutgoingRef.current ? 'cancelled' : 'missed';
      }

      contactService.saveCallLog(myPeerId, targetPeer, {
        isVideo: activeCallInfoRef.current?.isVideo,
        isOutgoing: isCallOutgoingRef.current,
        status,
        duration: finalDuration,
        timestamp: Date.now(),
      });
      refreshContacts();
    }

    setCallState('idle');
    setCallInfo(null);
    activeCallInfoRef.current = null;
    callConnectedTimeRef.current = null;

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }
    setRemoteStream(null);
  }, [localStream, myPeerId, remotePeerId, refreshContacts]);

  // Register Centralized P2P Network listeners
  useEffect(() => {
    const unsubConn = p2pService.on('onConnectionStateChange', (state, peer) => {
      if (!peer || peer === remotePeerId) {
        setConnectionState(state);
      }
      refreshContacts();
    });

    const unsubIce = p2pService.on('onIceStateChange', (state) => {
      setIceState(state);
    });

    // Contact Presence updates
    const unsubPresence = p2pService.on('onPresenceChange', ({ peerId, status }) => {
      if (peerId) {
        setPresenceMap((prev) => ({
          ...prev,
          [peerId.toLowerCase()]: status,
        }));
      }
    });

    // Incoming Call listener
    const unsubIncomingCall = p2pService.on('onIncomingCall', (info) => {
      setCallInfo(info);
      activeCallInfoRef.current = { peerId: info.callerId, isVideo: info.isVideo };
      isCallOutgoingRef.current = false;
      callConnectedTimeRef.current = null;
      setCallState('incoming');

      // Start authentic telephone ringtone immediately
      audioRinger.startIncomingRingtone();

      // Fire system notification for incoming call (service worker background push + web notification)
      notificationService.showCallNotification(
        info.callerId,
        info.callerName || info.callerId,
        info.isVideo
      );
    });

    const unsubAccepted = p2pService.on('onCallAccepted', () => {
      audioRinger.stop();
      if (activeCallInfoRef.current?.peerId) {
        notificationService.clearCallNotification(activeCallInfoRef.current.peerId);
      }
      callConnectedTimeRef.current = Date.now();
      setCallState('connected');
    });

    const unsubRejected = p2pService.on('onCallRejected', ({ reason }) => {
      showToast(`Call ${reason === 'busy' ? 'busy' : 'declined by peer'}`);
      handleEndCall();
    });

    const unsubEnded = p2pService.on('onCallEnded', () => {
      handleEndCall();
    });

    const unsubRemoteStream = p2pService.on('onRemoteStream', (stream) => {
      audioRinger.stop();
      setRemoteStream(stream);
      callConnectedTimeRef.current = Date.now();
      setCallState('connected');
    });

    // Central Message Dispatcher:
    // Handles message persistence, sound, notification, and list refresh regardless of screen
    const unsubMessage = p2pService.on('onMessage', (msg) => {
      refreshContacts();

      if (msg.type === 'chat') {
        const sender = (msg.sender || '').toLowerCase();
        const isCurrentlyViewingThisChat =
          document.visibilityState === 'visible' &&
          activeChatPeerRef.current === sender;

        // Play message notification sound
        audioRinger.playMessageBeep();

        // If app is in background or not currently looking at this active chat, show notification
        if (!isCurrentlyViewingThisChat) {
          const contact = contacts.find((c) => c.peerId.toLowerCase() === sender);
          const senderName = contact?.name || sender;

          notificationService.showMessageNotification(sender, senderName, msg.text);

          if (document.visibilityState === 'visible') {
            showToast(`💬 ${senderName}: ${msg.text.slice(0, 40)}`);
          }
        }
      }
    });

    return () => {
      unsubConn();
      unsubIce();
      unsubPresence();
      unsubIncomingCall();
      unsubAccepted();
      unsubRejected();
      unsubEnded();
      unsubRemoteStream();
      unsubMessage();
    };
  }, [remotePeerId, contacts, refreshContacts, showToast, handleEndCall]);

  const handleConnect = (targetPeerId) => {
    const cleanId = (targetPeerId || remotePeerId).trim().toLowerCase();
    if (!cleanId || cleanId === myPeerId) return;
    setRemotePeerId(cleanId);
    setConnectionState('connecting');
    p2pService.connectToPeer(cleanId);
  };

  const handleSelectContact = (contact) => {
    setActiveContact(contact);
    setRemotePeerId(contact.peerId);
    setCurrentScreen('chat');
    handleConnect(contact.peerId);
  };

  const handleAddContact = (targetId, nickname) => {
    const newContact = contactService.saveContact(myPeerId, targetId, nickname);
    refreshContacts();
    return newContact;
  };

  const handleDeleteContact = (targetId) => {
    const updated = contactService.deleteContact(myPeerId, targetId);
    setContacts(updated);
    showToast('Contact deleted');
    if (activeContact?.peerId?.toLowerCase() === targetId.toLowerCase()) {
      setActiveContact(null);
      setCurrentScreen('contacts');
    }
  };

  const handleStartCall = async (isVideo) => {
    if (!remotePeerId) return;

    try {
      activeCallInfoRef.current = { peerId: remotePeerId, isVideo };
      isCallOutgoingRef.current = true;
      callConnectedTimeRef.current = null;

      setCallInfo({ peerId: remotePeerId, isVideo });
      setCallState('calling');
      audioRinger.startOutgoingRingback();

      const stream = await p2pService.initiateCall({ targetPeerId: remotePeerId, isVideo });
      setLocalStream(stream);
    } catch (err) {
      audioRinger.stop();
      showToast(`Could not access camera/microphone: ${err.message}`);
      setCallState('idle');
      activeCallInfoRef.current = null;
    }
  };

  const handleAcceptCall = async ({ isVideo }) => {
    try {
      audioRinger.stop();
      if (activeCallInfoRef.current?.peerId) {
        notificationService.clearCallNotification(activeCallInfoRef.current.peerId);
      }
      const stream = await p2pService.acceptCall({ isVideo });
      setLocalStream(stream);
      callConnectedTimeRef.current = Date.now();
      setCallState('connected');
    } catch (err) {
      showToast(`Could not start media: ${err.message}`);
      handleEndCall();
    }
  };

  const handleRejectCall = () => {
    audioRinger.stop();
    const targetPeer = activeCallInfoRef.current?.peerId || remotePeerId;
    if (targetPeer) {
      notificationService.clearCallNotification(targetPeer);
    }

    if (targetPeer && myPeerId) {
      contactService.saveCallLog(myPeerId, targetPeer, {
        isVideo: activeCallInfoRef.current?.isVideo,
        isOutgoing: false,
        status: 'declined',
        duration: 0,
        timestamp: Date.now(),
      });
      refreshContacts();
    }
    p2pService.rejectCall('declined');
    setCallState('idle');
    setCallInfo(null);
    activeCallInfoRef.current = null;
  };

  const handleRecordingComplete = async (audioBlob, fileName, duration) => {
    try {
      await storageService.saveToDevice(audioBlob, fileName, 'audio/webm');
      showToast(`Call recording saved (${duration}s)`);

      const targetPeer = activeCallInfoRef.current?.peerId || remotePeerId;
      if (myPeerId && targetPeer) {
        const url = URL.createObjectURL(audioBlob);
        const recordMsg = {
          id: `rec_${Date.now()}`,
          type: 'file',
          sender: myPeerId,
          isSelf: true,
          timestamp: Date.now(),
          file: {
            name: fileName,
            size: audioBlob.size,
            mimeType: 'audio/webm',
            blob: audioBlob,
            url,
          },
        };
        contactService.saveChatMessage(myPeerId, targetPeer, recordMsg);
        contactService.updateLastMessage(myPeerId, targetPeer, `🎙️ Call Recording (${duration}s)`);
        refreshContacts();
      }
    } catch (err) {
      console.warn('Failed to save call recording:', err);
    }
  };

  const handleUpdatePeerId = (newId) => {
    p2pService.setPeerId(newId);
    setMyPeerId(newId);
  };

  // Main UI Content
  const appContent = (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 font-sans select-none overflow-hidden relative">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-slate-700 shadow-2xl text-xs font-medium text-slate-200 backdrop-blur-md animate-in fade-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {currentScreen === 'contacts' ? (
        <ContactsScreen
          myPeerId={myPeerId}
          myStatus={myStatus}
          presenceMap={presenceMap}
          contacts={contacts}
          notificationPermission={notificationPermission}
          onRequestNotifications={handleRequestNotifications}
          onSelectContact={handleSelectContact}
          onAddContact={handleAddContact}
          onDeleteContact={handleDeleteContact}
          onOpenSettings={() => setIsSettingsOpen(true)}
          activeRemotePeerId={remotePeerId}
          connectionState={connectionState}
          p2p={p2pService}
        />
      ) : (
        <ChatScreen
          p2p={p2pService}
          myPeerId={myPeerId}
          remotePeerId={remotePeerId}
          contactName={activeContact?.name || remotePeerId}
          connectionState={connectionState}
          presenceMap={presenceMap}
          onBack={() => {
            refreshContacts();
            setCurrentScreen('contacts');
          }}
          onStartCall={handleStartCall}
          onRetryConnect={() => handleConnect(remotePeerId)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}

      {/* Active Audio/Video Call Screen Modal */}
      <CallScreen
        callState={callState}
        callInfo={callInfo}
        localStream={localStream}
        remoteStream={remoteStream}
        onAccept={handleAcceptCall}
        onReject={handleRejectCall}
        onEndCall={handleEndCall}
        p2p={p2pService}
        onRecordingComplete={handleRecordingComplete}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        myPeerId={myPeerId}
        onUpdatePeerId={handleUpdatePeerId}
        metrics={metrics}
        activePreset={simulationPreset}
        onSelectPreset={setSimulationPreset}
      />
    </div>
  );

  if (simulationPreset && simulationPreset.width && simulationPreset.height) {
    return (
      <div className="min-h-screen w-screen bg-slate-950 flex flex-col items-center justify-center p-2 sm:p-4 overflow-auto">
        <div className="mb-2 flex items-center justify-between w-full max-w-[500px] px-3 py-1.5 rounded-2xl bg-slate-900 border border-slate-800 text-xs">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold text-slate-200">{simulationPreset.name}</span>
            <span className="text-[10px] font-mono text-cyan-400">
              {simulationPreset.width} × {simulationPreset.height} px
            </span>
          </div>
          <button
            onClick={() => setSimulationPreset(null)}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition flex items-center gap-1 text-[11px]"
          >
            <span>Exit Test</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div
          style={{
            width: `${simulationPreset.width}px`,
            height: `${simulationPreset.height}px`,
            maxWidth: '100vw',
            maxHeight: '92vh',
          }}
          className="rounded-[36px] border-4 border-slate-700 shadow-2xl overflow-hidden flex flex-col bg-slate-950 relative"
        >
          {appContent}
        </div>
      </div>
    );
  }

  return (
    <div className="h-dynamic-screen w-full flex flex-col overflow-hidden bg-slate-950">
      {appContent}
    </div>
  );
}
