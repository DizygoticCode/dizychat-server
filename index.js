const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.use(cors());
app.use(express.static('public'));

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

const typingUsers = {};

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('join room', (room) => {
        socket.join(room);
        if (!typingUsers[room]) typingUsers[room] = [];
    });

    socket.on('chat message', (msg) => {
        msg.timestamp = new Date().toLocaleTimeString();
        msg.id = Date.now() + Math.random();
        msg.status = 'sent';
        io.to(msg.room).emit('chat message', msg);
    });

    socket.on('typing', (username, room) => {
        if (!typingUsers[room].includes(username)) typingUsers[room].push(username);
        io.to(room).emit('typing', typingUsers[room]);
    });

    socket.on('stop typing', (username, room) => {
        typingUsers[room] = typingUsers[room].filter(u => u !== username);
        io.to(room).emit('typing', typingUsers[room]);
    });

    socket.on('read message', ({ room, id }) => {
        io.to(room).emit('message status', { id, status: 'read' });
    });

    socket.on('disconnect', () => console.log('A user disconnected'));
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));
