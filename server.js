const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Frontend files
app.use(express.static(path.join(__dirname, ".")));

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Connected users
const onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User joins
  socket.on("join", (username) => {
    if (!username) return;

    onlineUsers.set(socket.id, username);

    console.log(`${username} joined`);

    // Send current online users
    io.emit("onlineUsers", Array.from(onlineUsers.values()));

    // Notify others
    socket.broadcast.emit("userOnline", {
      username: username
    });
  });

  // Message
  socket.on("sendMessage", (data) => {
    if (!data || !data.message) return;

    const messageData = {
      username: data.username || "Unknown",
      message: data.message,
      time: new Date().toISOString()
    };

    // Send to everyone
    io.emit("receiveMessage", messageData);
  });

  // Disconnect
  socket.on("disconnect", () => {
    const username = onlineUsers.get(socket.id);

    if (username) {
      onlineUsers.delete(socket.id);

      console.log(`${username} disconnected`);

      io.emit("userOffline", {
        username: username
      });

      io.emit("onlineUsers", Array.from(onlineUsers.values()));
    }
  });
});

server.listen(PORT, () => {
  console.log(`TELESUPAR server running on port ${PORT}`);
});
