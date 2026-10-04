const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;

let db;
let users;
let messages;
let conversations;

const client = new MongoClient(MONGODB_URI);

/* =========================
   DATABASE
========================= */

async function connectDatabase() {
  await client.connect();

  db = client.db("telesupar");

  users = db.collection("users");
  messages = db.collection("messages");
  conversations = db.collection("conversations");

  await users.createIndex(
    { username: 1 },
    { unique: true }
  );

  await users.createIndex(
    { email: 1 },
    { unique: true }
  );

  await conversations.createIndex(
    { memberKey: 1 },
    { unique: true }
  );

  console.log("MongoDB connected successfully");
}

/* =========================
   HELPERS
========================= */

function makeToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      username: user.username,
      email: user.email
    },
    JWT_SECRET,
    {
      expiresIn: "30d"
    }
  );
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName || user.username,
    email: user.email,
    createdAt: user.createdAt
  };
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Login required"
    });
  }

  const token = header.substring(7);

  try {
    const decoded = jwt.verify(
      token,
      JWT_SECRET
    );

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
}

function validId(id) {
  return ObjectId.isValid(id);
}

/* =========================
   HOME
========================= */

app.get("/", function (req, res) {
  res.json({
    name: "TELESUPAR",
    status: "running"
  });
});

/* =========================
   HEALTH
========================= */

app.get("/api/health", async function (req, res) {
  try {
    await db.command({ ping: 1 });

    res.json({
      status: "ok",
      mongodb: "connected"
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      mongodb: "disconnected"
    });
  }
});

/* =========================
   REGISTER
========================= */

app.post("/api/register", async function (req, res) {
  try {
    const username = String(
      req.body.username || ""
    ).trim().toLowerCase();

    const displayName = String(
      req.body.displayName || ""
    ).trim();

    const email = String(
      req.body.email || ""
    ).trim().toLowerCase();

    const password = String(
      req.body.password || ""
    );

    if (
      !username ||
      !displayName ||
      !email ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Username must be at least 3 characters"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters"
      });
    }

    const existing = await users.findOne({
      $or: [
        { username: username },
        { email: email }
      ]
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Username or email already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(
      password,
      12
    );

    const user = {
      username: username,
      displayName: displayName,
      email: email,
      password: hashedPassword,
      createdAt: new Date()
    };

    const result = await users.insertOne(user);

    user._id = result.insertedId;

    const token = makeToken(user);

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      token: token,
      user: publicUser(user)
    });

  } catch (error) {
    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async function (req, res) {
  try {
    const email = String(
      req.body.email || ""
    ).trim().toLowerCase();

    const password = String(
      req.body.password || ""
    );

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const user = await users.findOne({
      email: email
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const match = await bcrypt.compare(
      password,
      user.password
    );

    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const token = makeToken(user);

    res.json({
      success: true,
      message: "Login successful",
      token: token,
      user: publicUser(user)
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
});

/* =========================
   MY PROFILE
========================= */

app.get("/api/me", auth, async function (req, res) {
  try {
    const user = await users.findOne({
      _id: new ObjectId(req.user.id)
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user: publicUser(user)
    });

  } catch (error) {
    console.error("ME ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not load profile"
    });
  }
});

/* =========================
   REAL USERS / SEARCH
========================= */

app.get("/api/users", auth, async function (req, res) {
  try {
    const search = String(
      req.query.search || ""
    ).trim();

    const query = {
      _id: {
        $ne: new ObjectId(req.user.id)
      }
    };

    if (search) {
      query.$or = [
        {
          username: {
            $regex: search,
            $options: "i"
          }
        },
        {
          displayName: {
            $regex: search,
            $options: "i"
          }
        }
      ];
    }

    const list = await users
      .find(query)
      .project({
        password: 0
      })
      .sort({
        displayName: 1
      })
      .limit(50)
      .toArray();

    res.json({
      success: true,
      users: list.map(publicUser)
    });

  } catch (error) {
    console.error("USERS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not load users"
    });
  }
});

/* =========================
   CREATE CONVERSATION
========================= */

app.post(
  "/api/conversations/:userId",
  auth,
  async function (req, res) {
    try {
      const myId = req.user.id;
      const otherId = req.params.userId;

      if (!validId(otherId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID"
        });
      }

      if (myId === otherId) {
        return res.status(400).json({
          success: false,
          message: "You cannot chat with yourself"
        });
      }

      const otherUser = await users.findOne({
        _id: new ObjectId(otherId)
      });

      if (!otherUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const ids = [
        myId,
        otherId
      ].sort();

      const memberKey = ids.join(":");

      let conversation =
        await conversations.findOne({
          memberKey: memberKey
        });

      if (!conversation) {
        const newConversation = {
          memberKey: memberKey,
          members: [
            new ObjectId(ids[0]),
            new ObjectId(ids[1])
          ],
          lastMessage: "",
          lastMessageAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        try {
          const result =
            await conversations.insertOne(
              newConversation
            );

          newConversation._id =
            result.insertedId;

          conversation =
            newConversation;

        } catch (insertError) {
          conversation =
            await conversations.findOne({
              memberKey: memberKey
            });

          if (!conversation) {
            throw insertError;
          }
        }
      }

      res.json({
        success: true,
        conversation: {
          id: conversation._id.toString(),
          members: conversation.members.map(
            function (id) {
              return id.toString();
            }
          ),
          lastMessage:
            conversation.lastMessage || "",
          lastMessageAt:
            conversation.lastMessageAt || null,
          updatedAt:
            conversation.updatedAt,
          user: publicUser(otherUser)
        }
      });

    } catch (error) {
      console.error(
        "CONVERSATION ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Could not create conversation"
      });
    }
  }
);

/* =========================
   RECENT CHATS
========================= */

app.get(
  "/api/conversations",
  auth,
  async function (req, res) {
    try {
      const myId = new ObjectId(req.user.id);

      const list = await conversations
        .find({
          members: myId
        })
        .sort({
          updatedAt: -1
        })
        .limit(50)
        .toArray();

      const result = [];

      for (const conversation of list) {
        let otherId = null;

        for (const member of conversation.members) {
          if (member.toString() !== req.user.id) {
            otherId = member;
            break;
          }
        }

        let otherUser = null;

        if (otherId) {
          otherUser = await users.findOne({
            _id: otherId
          });
        }

        result.push({
          id: conversation._id.toString(),
          lastMessage:
            conversation.lastMessage || "",
          lastMessageAt:
            conversation.lastMessageAt || null,
          updatedAt:
            conversation.updatedAt,
          user:
            otherUser
              ? publicUser(otherUser)
              : null
        });
      }

      res.json({
        success: true,
        conversations: result
      });

    } catch (error) {
      console.error(
        "RECENT CHATS ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Could not load chats"
      });
    }
  }
);

/* =========================
   CHAT HISTORY
========================= */

app.get(
  "/api/conversations/:conversationId/messages",
  auth,
  async function (req, res) {
    try {
      const conversationId =
        req.params.conversationId;

      if (!validId(conversationId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid conversation ID"
        });
      }

      const conversation =
        await conversations.findOne({
          _id: new ObjectId(conversationId),
          members: new ObjectId(req.user.id)
        });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      const list = await messages
        .find({
          conversationId:
            new ObjectId(conversationId)
        })
        .sort({
          createdAt: 1
        })
        .limit(200)
        .toArray();

      const output = list
        .filter(function (message) {
          return (
            message.conversationId &&
            message.senderId &&
            message.text !== undefined
          );
        })
        .map(function (message) {
          return {
            id: message._id.toString(),
            conversationId:
              message.conversationId.toString(),
            senderId:
              message.senderId.toString(),
            text: message.text,
            createdAt:
              message.createdAt
          };
        });

      res.json({
        success: true,
        messages: output
      });

    } catch (error) {
      console.error(
        "HISTORY ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Could not load messages"
      });
    }
  }
);

/* =========================
   SEND MESSAGE
========================= */

app.post(
  "/api/conversations/:conversationId/messages",
  auth,
  async function (req, res) {
    try {
      const conversationId =
        req.params.conversationId;

      const text = String(
        req.body.text || ""
      ).trim();

      if (!validId(conversationId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid conversation ID"
        });
      }

      if (!text) {
        return res.status(400).json({
          success: false,
          message: "Message cannot be empty"
        });
      }

      const conversation =
        await conversations.findOne({
          _id: new ObjectId(conversationId),
          members: new ObjectId(req.user.id)
        });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      const now = new Date();

      const newMessage = {
        conversationId:
          new ObjectId(conversationId),
        senderId:
          new ObjectId(req.user.id),
        text: text,
        createdAt: now
      };

      const result =
        await messages.insertOne(
          newMessage
        );

      await conversations.updateOne(
        {
          _id:
            new ObjectId(conversationId)
        },
        {
          $set: {
            lastMessage: text,
            lastMessageAt: now,
            updatedAt: now
          }
        }
      );

      const output = {
        id: result.insertedId.toString(),
        conversationId: conversationId,
        senderId: req.user.id,
        text: text,
        createdAt: now
      };

      io.to(
        "conversation:" + conversationId
      ).emit(
        "newMessage",
        output
      );

      res.status(201).json({
        success: true,
        message: output
      });

    } catch (error) {
      console.error(
        "SEND MESSAGE ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Could not send message"
      });
    }
  }
);

/* =========================
   SOCKET.IO
========================= */

io.on("connection", function (socket) {

  console.log(
    "Socket connected:",
    socket.id
  );

  socket.on(
    "authenticate",
    function (token) {
      try {
        const decoded = jwt.verify(
          token,
          JWT_SECRET
        );

        socket.user = decoded;

        socket.join(
          "user:" + decoded.id
        );

        io.emit(
          "userOnline",
          decoded.id
        );

      } catch (error) {
        socket.emit(
          "authError",
          "Invalid token"
        );
      }
    }
  );

  socket.on(
    "joinConversation",
    function (conversationId) {
      if (!socket.user) {
        return;
      }

      if (!validId(conversationId)) {
        return;
      }

      socket.join(
        "conversation:" + conversationId
      );
    }
  );

  socket.on(
    "leaveConversation",
    function (conversationId) {
      socket.leave(
        "conversation:" + conversationId
      );
    }
  );

  /* Old frontend compatibility */

  socket.on(
    "join",
    function (username) {
      socket.username = username;
    }
  );

  socket.on(
    "sendMessage",
    async function (data) {
      try {

        if (
          socket.user &&
          data &&
          data.conversationId &&
          data.text
        ) {

          const conversationId =
            data.conversationId;

          const text = String(
            data.text
          ).trim();

          if (!validId(conversationId)) {
            return;
          }

          if (!text) {
            return;
          }

          const conversation =
            await conversations.findOne({
              _id:
                new ObjectId(
                  conversationId
                ),
              members:
                new ObjectId(
                  socket.user.id
                )
            });

          if (!conversation) {
            return;
          }

          const now = new Date();

          const message = {
            conversationId:
              new ObjectId(
                conversationId
              ),
            senderId:
              new ObjectId(
                socket.user.id
              ),
            text: text,
            createdAt: now
          };

          const result =
            await messages.insertOne(
              message
            );

          await conversations.updateOne(
            {
              _id:
                new ObjectId(
                  conversationId
                )
            },
            {
              $set: {
                lastMessage: text,
                lastMessageAt: now,
                updatedAt: now
              }
            }
          );

          io.to(
            "conversation:" +
              conversationId
          ).emit(
            "newMessage",
            {
              id:
                result.insertedId.toString(),
              conversationId:
                conversationId,
              senderId:
                socket.user.id,
              text: text,
              createdAt: now
            }
          );

          return;
        }

      } catch (error) {
        console.error(
          "SOCKET ERROR:",
          error
        );
      }
    }
  );

  socket.on(
    "disconnect",
    function () {
      console.log(
        "Socket disconnected:",
        socket.id
      );
    }
  );
});

/* =========================
   START
========================= */

connectDatabase()
  .then(function () {

    server.listen(
      PORT,
      "0.0.0.0",
      function () {
        console.log(
          "TELESUPAR server running on port " +
          PORT
        );
      }
    );

  })
  .catch(function (error) {

    console.error(
      "MongoDB connection failed:",
      error
    );

    process.exit(1);
  });
