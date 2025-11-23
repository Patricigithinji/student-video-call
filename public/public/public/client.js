const socket = io();
const localVideo = document.getElementById('localVideo');
const videos = document.getElementById('videos');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const roomInput = document.getElementById('room-input');

let localStream = null;
const peers = new Map(); // peerId -> { pc, el }
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
    // Add TURN server here for production
  ]
};

async function startLocalStream(){
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    localVideo.srcObject = localStream;
  }catch(e){
    alert('Failed to get camera/microphone: ' + e.message);
  }
}

function createVideoElement(peerId){
  const slot = document.createElement('div');
  slot.className = 'video-slot';
  const v = document.createElement('video');
  v.autoplay = true;
  v.playsInline = true;
  v.id = 'video-' + peerId;
  slot.appendChild(v);
  const lbl = document.createElement('div');
  lbl.className = 'label';
  lbl.textContent = peerId;
  slot.appendChild(lbl);
  videos.appendChild(slot);
  return v;
}

function removeVideoElement(peerId){
  const el = document.getElementById('video-' + peerId);
  if(el && el.parentElement) el.parentElement.remove();
}

async function createPeerConnection(peerId, isInitiator){
  const pc = new RTCPeerConnection(configuration);

  // add local tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // remote track handling
  const remoteEl = createVideoElement(peerId);
  pc.addEventListener('track', (evt) => {
    // For browsers that split tracks per event, attach the stream
    if (remoteEl.srcObject) return;
    const [stream] = evt.streams;
    remoteEl.srcObject = stream;
  });

  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate) {
      socket.emit('signal', { to: peerId, from: socket.id, candidate: e.candidate });
    }
  });

  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed'){
      removeVideoElement(peerId);
      peers.delete(peerId);
    }
  });

  peers.set(peerId, { pc, el: remoteEl });

  if (isInitiator){
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: peerId, from: socket.id, description: pc.localDescription });
  }
}

socket.on('connect', () => console.log('connected to signaling server', socket.id));

socket.on('existing-peers', async (peerIds) => {
  // create peers and be initiator for each existing peer
  for (const peerId of peerIds){
    if (peerId === socket.id) continue;
    await createPeerConnection(peerId, true);
  }
});

socket.on('new-peer', async ({ peerId }) => {
  // A new peer joined the room: create PC but don't initiate (wait for their offer)
  if (peerId === socket.id) return;
  await createPeerConnection(peerId, false);
});

socket.on('signal', async (data) => {
  // data: { to, from, description?, candidate? }
  const from = data.from;
  if (data.description){
    let entry = peers.get(from);
    if (!entry){
      // create a PC as non-initiator
      await createPeerConnection(from, false);
      entry = peers.get(from);
    }
    const pc = entry.pc;
    const desc = data.description;
    if (desc.type === 'offer'){
      await pc.setRemoteDescription(desc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { to: from, from: socket.id, description: pc.localDescription });
    }else if (desc.type === 'answer'){
      await pc.setRemoteDescription(desc);
    }
  }
  if (data.candidate){
    const entry = peers.get(from);
    if (entry){
      try{ await entry.pc.addIceCandidate(data.candidate); }catch(e){ console.warn('ice candidate add failed', e); }
    }
  }
});

socket.on('peer-left', ({ peerId }) => {
  removeVideoElement(peerId);
  const entry = peers.get(peerId);
  if (entry){
    try{ entry.pc.close(); }catch(e){}
    peers.delete(peerId);
  }
});

// UI handlers
joinBtn.onclick = async () => {
  const room = roomInput.value.trim() || 'default-room';
  joinBtn.disabled = true;
  await startLocalStream();
  socket.emit('join-room', room);
  leaveBtn.disabled = false;
};

leaveBtn.onclick = () => {
  // close all peers and local stream
  peers.forEach(({ pc }, id) => {
    try{ pc.close(); } catch(e){}
    removeVideoElement(id);
  });
  peers.clear();
  if (localStream){
    localStream.getTracks().forEach(t => t.stop());
    localVideo.srcObject = null;
    localStream = null;
  }
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  // (optionally) reconnect socket or notify server leaving handled by disconnect
};

// Ensure the user can stop tracks when closing
window.addEventListener('beforeunload', () => {
  try{ socket.close(); }catch(e){}
});
