import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Smartphone, X, AlertCircle } from 'lucide-react';
import p2pService from './services/gunSignaling';
import contactService from './services/contactService';
import storageService from './services/storageService';
import audioRinger from './services/audioRinger';
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

  // Call states
  const [callState, setCallState] = useState('idle'); // 'idle' | 'calling' | 'incoming' | 'connected'
  const [callInfo, setCallInfo] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  // Call logging trackers
  const activeCallInfoRef = useRef(null);
  const isCallOutgoingRef = useRef(false);
  const callConnectedTimeRef = useRef(null);

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

  // Request system notifications permission once if supported
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try {
        Notification.requestPermission().catch(() => {});
      } catch (e) {}
    }
  }, []);

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
      }, 600);
    }
  }, [myPeerId, refreshContacts]);

  const handleEndCall = useCallback((durationFromScreen = 0) => {
    p2pService.endCall();
    audioRinger.stop();

    const targetPeer = activeCallInfoRef.current?.peerId || remotePeerId;
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

  // Register P2P Network listeners
  useEffect(() => {
    p2pService.on('onConnectionStateChange', (state) => {
      setConnectionState(state);
      refreshContacts();
    });

    p2pService.on('onIceStateChange', (state) => {
      setIceState(state);
    });

    p2pService.on('onIncomingCall', (info) => {
      setCallInfo(info);
      activeCallInfoRef.current = { peerId: info.callerId, isVideo: info.isVideo };
      isCallOutgoingRef.current = false;
      callConnectedTimeRef.current = null;
      setCallState('incoming');

      // Native Web Notification if in background
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Incoming Nexus Call', {
            body: `${info.callerName || info.callerId} is calling you (${info.isVideo ? 'Video' : 'Voice'})`,
            icon: '/icon.svg',
          });
        } catch (e) {}
      }
    });

    p2pService.on('onCallAccepted', () => {
      callConnectedTimeRef.current = Date.now();
      setCallState('connected');
    });

    p2pService.on('onCallRejected', ({ reason }) => {
      showToast(`Call ${reason === 'busy' ? 'busy' : 'declined by peer'}`);
      handleEndCall();
    });

    p2pService.on('onCallEnded', () => {
      handleEndCall();
    });

    p2pService.on('onRemoteStream', (stream) => {
      setRemoteStream(stream);
      callConnectedTimeRef.current = Date.now();
      setCallState('connected');
    });

    p2pService.on('onMessage', () => {
      refreshContacts();
    });

    return () => {};
  }, [refreshContacts, showToast, handleEndCall]);

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

    if (connectionState !== 'connected' || remotePeerId !== contact.peerId) {
      handleConnect(contact.peerId);
    }
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
      const stream = await p2pService.initiateCall({ isVideo });
      setLocalStream(stream);
    } catch (err) {
      showToast(`Could not access camera/microphone: ${err.message}`);
      setCallState('idle');
      activeCallInfoRef.current = null;
    }
  };

  const handleAcceptCall = async ({ isVideo }) => {
    try {
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
    const targetPeer = activeCallInfoRef.current?.peerId || remotePeerId;
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
      // Save file locally to device storage
      await storageService.saveToDevice(audioBlob, fileName, 'audio/webm');
      showToast(`Call recording saved (${duration}s)`);

      // Also append as an audio message in the active chat history
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
          contacts={contacts}
          onSelectContact={handleSelectContact}
          onAddContact={handleAddContact}
          onDeleteContact={handleDeleteContact}
          onOpenSettings={() => setIsSettingsOpen(true)}
          activeRemotePeerId={remotePeerId}
          connectionState={connectionState}
        />
      ) : (
        <ChatScreen
          p2p={p2pService}
          myPeerId={myPeerId}
          remotePeerId={remotePeerId}
          contactName={activeContact?.name || remotePeerId}
          connectionState={connectionState}
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
