const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// simple in-memory rooms: { roomId: Set(socketId, ...) }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    const members = rooms.get(roomId);

    // inform existing members about new peer
    members.forEach((memberId) => {
      io.to(memberId).emit('new-peer', { peerId: socket.id });
    });

    // send list of existing peers to the new client
    socket.emit('existing-peers', Array.from(members));

    members.add(socket.id);

    socket.on('signal', (data) => {
      // data: { to, from, description?, candidate? }
      io.to(data.to).emit('signal', data);
    });

    socket.on('disconnect', () => {
      console.log('socket disconnected', socket.id);
      const m = rooms.get(roomId);
      if (m) {
        m.delete(socket.id);
        // notify remaining peers
        socket.to(roomId).emit('peer-left', { peerId: socket.id });
        if (m.size === 0) rooms.delete(roomId);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
