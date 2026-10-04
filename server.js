const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing");
}

if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing");
}

const client = new MongoClient(MONGODB_URI);

let db;
let users;
let messages;
let conversations;

/* =========================
   DATABASE
========================= */

async function connectDB() {
  await client.connect();

  db = client.db("telesupar");

  users = db.collection("users");
  messages = db.collection("messages");
  conversations = db.collection("conversations");

  await users.createIndex({ username: 1 }, { unique: true });
  await users.createIndex({ email: 1 }, { unique: true });

  await conversations.createIndex(
    { memberKey: 1 },
    { unique: true }
  );

  await conversations.createIndex({
    members: 1,
    updatedAt: -1
  });

  console.log("MongoDB connected successfully");
}

/* =========================
   HELPERS
========================= */

function createToken(user) {
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

function safeUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName || user.username,
    email: user.email,
    createdAt: user.createdAt
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* =========================
   AUTH MIDDLEWARE
========================= */

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required"
    });
  }

  const token = header.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
}

/* =========================
   HEALTH
========================= */

app.get("/", (req, res) => {
  res.json({
    name: "TELESUPAR API",
    status: "running"
  });
});

app.get("/api/health", async (req, res) => {
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

app.post("/api/register", async (req, res) => {
  try {
    const {
      username,
      displayName,
      email,
      password
    } = req.body;

    if (!username || !displayName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    const cleanUsername = username
      .trim()
      .toLowerCase();

    const cleanEmail = email
      .trim()
      .toLowerCase();

    const cleanDisplayName = displayName.trim();

    if (cleanUsername.length < 3) {
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

    const existingUser = await users.findOne({
      $or: [
        { username: cleanUsername },
        { email: cleanEmail }
      ]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Username or email already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(
      password,
      12
    );

    const newUser = {
      username: cleanUsername,
      displayName: cleanDisplayName,
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date()
    };

    const result = await users.insertOne(newUser);

    newUser._id = result.insertedId;

    const token = createToken(newUser);

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      user: safeUser(newUser)
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

app.post("/api/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const cleanEmail = email
      .trim()
      .toLowerCase();

    const user = await users.findOne({
      email: cleanEmail
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const token = createToken(user);

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: safeUser(user)
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
   CURRENT USER
========================= */

app.get("/api/me", auth, async (req, res) => {
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
      user: safeUser(user)
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not load profile"
    });
  }
});

/* =========================
   SEARCH / REAL USERS
========================= */

app.get("/api/users", auth, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();

    const query = {
      _id: {
        $ne: new ObjectId(req.user.id)
      }
    };

    if (search) {
      const safeSearch = escapeRegex(search);

      query.$or = [
        {
          username: {
            $regex: safeSearch,
            $options: "i"
          }
        },
        {
          displayName: {
            $regex: safeSearch,
            $options: "i"
          }
        }
      ];
    }

    const result = await users
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
      users: result.map(safeUser)
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
   CREATE / GET CONVERSATION
========================= */

app.post(
  "/api/conversations/:userId",
  auth,
  async (req, res) => {
    try {
      const myId = req.user.id;
      const otherId = req.params.userId;

      if (!ObjectId.isValid(otherId)) {
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

      const sortedIds = [
        myId,
        otherId
      ].sort();

      const memberKey = sortedIds.join(":");

      const now = new Date();

      const conversation =
        await conversations.findOneAndUpdate(
          {
            memberKey
          },
          {
            $setOnInsert: {
              memberKey,
              members: sortedIds.map(
                id => new ObjectId(id)
              ),
              createdAt: now,
              updatedAt: now,
              lastMessage: "",
              lastMessageAt: null
            }
          },
          {
            upsert: true,
            returnDocument: "after"
          }
        );

      res.json({
        success: true,
        conversation: {
          id: conversation._id.toString(),
          memberKey: conversation.memberKey,
          members: conversation.members.map(
            id => id.toString()
          ),
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          lastMessage: conversation.lastMessage || "",
          lastMessageAt:
            conversation.lastMessageAt || null,
          otherUser: safeUser(otherUser)
        }
      });

    } catch (error) {
      console.error(
        "CREATE CONVERSATION ERROR:",
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
  async (req, res) => {
    try {
      const myObjectId =
        new ObjectId(req.user.id);

      const conversationList =
        await conversations
          .find({
            members: myObjectId
          })
          .sort({
            updatedAt: -1
          })
          .limit(50)
          .toArray();

      if (conversationList.length === 0) {
        return res.json({
          success: true,
          conversations: []
        });
      }

      const otherIds = [];

      for (const conversation of conversationList) {
        const other = conversation.members.find(
          id => id.toString() !== req.user.id
        );

        if (other) {
          otherIds.push(other);
        }
      }

      const otherUsers =
        await users
          .find({
            _id: {
              $in: otherIds
            }
          })
          .project({
            password: 0
          })
          .toArray();

      const userMap = new Map();

      for (const user of otherUsers) {
        userMap.set(
          user._id.toString(),
          safeUser(user)
        );
      }

      const result = conversationList.map(
        conversation => {
          const otherId =
            conversation.members.find(
              id =>
                id.toString() !==
                req.user.id
            );

          return {
            id: conversation._id.toString(),
            lastMessage:
              conversation.lastMessage || "",
            lastMessageAt:
              conversation.lastMessageAt ||
              null,
            updatedAt:
              conversation.updatedAt,
            user:
              otherId
                ? userMap.get(
                    otherId.toString()
                  )
                : null
          };
        }
      );

      res.json({
        success: true,
        conversations: result
      });

    } catch (error) {
      console.error(
        "CONVERSATIONS ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Could not load conversations"
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
  async (req, res) => {
    try {
      const conversationId =
        req.params.conversationId;

      if (!ObjectId.isValid(conversationId)) {
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

      const chatMessages =
        await messages
          .find({
            conversationId:
              new ObjectId(conversationId)
          })
          .sort({
            createdAt: 1
          })
          .limit(200)
          .toArray();

      res.json({
        success: true,
        messages: chatMessages.map(
          message => ({
            id: message._id.toString(),
            conversationId:
              message.conversationId.toString(),
            senderId:
              message.senderId.toString(),
            text: message.text || "",
            createdAt:
              message.createdAt
          })
        )
      });

    } catch (error) {
      console.error(
        "CHAT HISTORY ERROR:",
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
   SEND MESSAGE API
========================= */

app.post(
  "/api/conversations/:conversationId/messages",
  auth,
  async (req, res) => {
    try {
      const conversationId =
        req.params.conversationId;

      const text = String(
        req.body.text || ""
      ).trim();

      if (!ObjectId.isValid(conversationId)) {
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

      if (text.length > 5000) {
        return res.status(400).json({
          success: false,
          message: "Message is too long"
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
        text,
        createdAt: now
      };

      const result =
        await messages.insertOne(
          newMessage
        );

      await conversations.updateOne(
        {
          _id: new ObjectId(conversationId)
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
        conversationId,
        senderId: req.user.id,
        text,
        createdAt: now
      };

      io.to(
        `conversation:${conversationId}`
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

const onlineUsers = new Map();

io.on("connection", socket => {
  console.log(
    "Socket connected:",
    socket.id
  );

  /* New authenticated connection */

  socket.on("authenticate", token => {
    try {
      const decoded = jwt.verify(
        token,
        JWT_SECRET
      );

      socket.user = decoded;

      const userRoom =
        `user:${decoded.id}`;

      socket.join(userRoom);

      onlineUsers.set(
        decoded.id,
        socket.id
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
  });

  /* Join a conversation room */

  socket.on(
    "joinConversation",
    conversationId => {
      if (!socket.user) return;

      socket.join(
        `conversation:${conversationId}`
      );
    }
  );

  /* Leave conversation */

  socket.on(
    "leaveConversation",
    conversationId => {
      socket.leave(
        `conversation:${conversationId}`
      );
    }
  );

  /* Compatibility with old frontend */

  socket.on("join", username => {
    socket.username = username;

    console.log(
      `${username} joined socket`
    );
const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is missing");
}

if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing");
}

const client = new MongoClient(MONGODB_URI);

let db;
let users;
let messages;
let conversations;

/* =========================
   DATABASE
========================= */

async function connectDB() {
  await client.connect();

  db = client.db("telesupar");

  users = db.collection("users");
  messages = db.collection("messages");
  conversations = db.collection("conversations");

  await users.createIndex({ username: 1 }, { unique: true });
  await users.createIndex({ email: 1 }, { unique: true });

  await conversations.createIndex(
    { memberKey: 1 },
    { unique: true }
  );

  await conversations.createIndex({
    members: 1,
    updatedAt: -1
  });

  console.log("MongoDB connected successfully");
}

/* =========================
   HELPERS
========================= */

function createToken(user) {
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

function safeUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName || user.username,
    email: user.email,
    createdAt: user.createdAt
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* =========================
   AUTH MIDDLEWARE
========================= */

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required"
    });
  }

  const token = header.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
}

/* =========================
   HEALTH
========================= */

app.get("/", (req, res) => {
  res.json({
    name: "TELESUPAR API",
    status: "running"
  });
});

app.get("/api/health", async (req, res) => {
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

app.post("/api/register", async (req, res) => {
  try {
    const {
      username,
      displayName,
      email,
      password
    } = req.body;

    if (!username || !displayName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    const cleanUsername = username
      .trim()
      .toLowerCase();

    const cleanEmail = email
      .trim()
      .toLowerCase();

    const cleanDisplayName = displayName.trim();

    if (cleanUsername.length < 3) {
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

    const existingUser = await users.findOne({
      $or: [
        { username: cleanUsername },
        { email: cleanEmail }
      ]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Username or email already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(
      password,
      12
    );

    const newUser = {
      username: cleanUsername,
      displayName: cleanDisplayName,
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date()
    };

    const result = await users.insertOne(newUser);

    newUser._id = result.insertedId;

    const token = createToken(newUser);

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      user: safeUser(newUser)
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

app.post("/api/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const cleanEmail = email
      .trim()
      .toLowerCase();

    const user = await users.findOne({
      email: cleanEmail
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const token = createToken(user);

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: safeUser(user)
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
   CURRENT USER
========================= */

app.get("/api/me", auth, async (req, res) => {
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
      user: safeUser(user)
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Could not load profile"
    });
  }
});

/* =========================
   SEARCH / REAL USERS
========================= */

app.get("/api/users", auth, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();

    const query = {
      _id: {
        $ne: new ObjectId(req.user.id)
      }
    };

    if (search) {
      const safeSearch = escapeRegex(search);

      query.$or = [
        {
          username: {
            $regex: safeSearch,
            $options: "i"
          }
        },
        {
          displayName: {
            $regex: safeSearch,
            $options: "i"
          }
        }
      ];
    }

    const result = await users
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
      users: result.map(safeUser)
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
   CREATE / GET CONVERSATION
========================= */

app.post(
  "/api/conversations/:userId",
  auth,
  async (req, res) => {
    try {
      const myId = req.user.id;
      const otherId = req.params.userId;

      if (!ObjectId.isValid(otherId)) {
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

      const sortedIds = [
        myId,
        otherId
      ].sort();

      const memberKey = sortedIds.join(":");

      const now = new Date();

      const conversation =
        await conversations.findOneAndUpdate(
          {
            memberKey
          },
          {
            $setOnInsert: {
              memberKey,
              members: sortedIds.map(
                id => new ObjectId(id)
              ),
              createdAt: now,
              updatedAt: now,
              lastMessage: "",
              lastMessageAt: null
            }
          },
          {
            upsert: true,
            returnDocument: "after"
          }
        );

      res.json({
        success: true,
        conversation: {
          id: conversation._id.toString(),
          memberKey: conversation.memberKey,
          members: conversation.members.map(
            id => id.toString()
          ),
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          lastMessage: conversation.lastMessage || "",
          lastMessageAt:
            conversation.lastMessageAt || null,
          otherUser: safeUser(otherUser)
        }
      });

    } catch (error) {
      console.error(
        "CREATE CONVERSATION ERROR:",
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
  async (req, res) => {
    try {
      const myObjectId =
        new ObjectId(req.user.id);

      const conversationList =
        await conversations
          .find({
            members: myObjectId
          })
          .sort({
            updatedAt: -1
          })
          .limit(50)
          .toArray();

      if (conversationList.length === 0) {
        return res.json({
          success: true,
          conversations: []
        });
      }

      const otherIds = [];

      for (const conversation of conversationList) {
        const other = conversation.members.find(
          id => id.toString() !== req.user.id
        );

        if (other) {
          otherIds.push(other);
        }
      }

      const otherUsers =
        await users
          .find({
            _id: {
              $in: otherIds
            }
          })
          .project({
            password: 0
          })
          .toArray();

      const userMap = new Map();

      for (const user of otherUsers) {
        userMap.set(
          user._id.toString(),
          safeUser(user)
        );
      }

      const result = conversationList.map(
        conversation => {
          const otherId =
            conversation.members.find(
              id =>
                id.toString() !==
                req.user.id
            );

          return {
            id: conversation._id.toString(),
            lastMessage:
              conversation.lastMessage || "",
            lastMessageAt:
              conversation.lastMessageAt ||
              null,
            updatedAt:
              conversation.updatedAt,
            user:
              otherId
                ? userMap.get(
                    otherId.toString()
                  )
                : null
          };
        }
      );

      res.json({
        success: true,
        conversations: result
      });

    } catch (error) {
      console.error(
        "CONVERSATIONS ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Could not load conversations"
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
  async (req, res) => {
    try {
      const conversationId =
        req.params.conversationId;

      if (!ObjectId.isValid(conversationId)) {
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

      const chatMessages =
        await messages
          .find({
            conversationId:
              new ObjectId(conversationId)
          })
          .sort({
            createdAt: 1
          })
          .limit(200)
          .toArray();

      res.json({
        success: true,
        messages: chatMessages.map(
          message => ({
            id: message._id.toString(),
            conversationId:
              message.conversationId.toString(),
            senderId:
              message.senderId.toString(),
            text: message.text || "",
            createdAt:
              message.createdAt
          })
        )
      });

    } catch (error) {
      console.error(
        "CHAT HISTORY ERROR:",
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
   SEND MESSAGE API
========================= */

app.post(
  "/api/conversations/:conversationId/messages",
  auth,
  async (req, res) => {
    try {
      const conversationId =
        req.params.conversationId;

      const text = String(
        req.body.text || ""
      ).trim();

      if (!ObjectId.isValid(conversationId)) {
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

      if (text.length > 5000) {
        return res.status(400).json({
          success: false,
          message: "Message is too long"
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
        text,
        createdAt: now
      };

      const result =
        await messages.insertOne(
          newMessage
        );

      await conversations.updateOne(
        {
          _id: new ObjectId(conversationId)
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
        conversationId,
        senderId: req.user.id,
        text,
        createdAt: now
      };

      io.to(
        `conversation:${conversationId}`
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

const onlineUsers = new Map();

io.on("connection", socket => {
  console.log(
    "Socket connected:",
    socket.id
  );

  /* New authenticated connection */

  socket.on("authenticate", token => {
    try {
      const decoded = jwt.verify(
        token,
        JWT_SECRET
      );

      socket.user = decoded;

      const userRoom =
        `user:${decoded.id}`;

      socket.join(userRoom);

      onlineUsers.set(
        decoded.id,
        socket.id
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
  });

  /* Join a conversation room */

  socket.on(
    "joinConversation",
    conversationId => {
      if (!socket.user) return;

      socket.join(
        `conversation:${conversationId}`
      );
    }
  );

  /* Leave conversation */

  socket.on(
    "leaveConversation",
    conversationId => {
      socket.leave(
        `conversation:${conversationId}`
      );
    }
  );

  /* Compatibility with old frontend */

  socket.on("join", username => {
    socket.username = username;

    console.log(
      `${username} joined socket`
    );
  });

  /* Old message format compatibility */

  socket.on(
    "sendMessage",
    async data => {
      try {

        /*
          NEW FORMAT:
          {
            conversationId,
            text
          }
        */

        if (
          data &&
          data.conversationId &&
          data.text &&
          socket.user
        ) {
          const conversationId =
            data.conversationId;

          const text = String(
            data.text
          ).trim();

          if (!text) return;

          if (!ObjectId.isValid(
            conversationId
          )) {
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

          if (!conversation) return;

          const now = new Date();

          const newMessage = {
            conversationId:
              new ObjectId(
                conversationId
              ),
            senderId:
              new ObjectId(
                socket.user.id
              ),
            text,
            createdAt: now
          };

          const result =
            await messages.insertOne(
              newMessage
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

          const output = {
            id:
              result.insertedId.toString(),
            conversationId,
            senderId:
              socket.user.id,
            text,
            createdAt: now
          };

          io.to(
            `conversation:${conversationId}`
          ).emit(
            "newMessage",
            output
          );

          return;
        }

        /*
          OLD FORMAT
        */

        if (
          data &&
          data.username &&
          data.message
        ) {
          const oldMessage = {
            username: data.username,
            message: data.message,
            time: new Date()
          };

          await messages.insertOne(
            oldMessage
          );

          io.emit(
            "receiveMessage",
            oldMessage
          );
        }

      } catch (error) {
        console.error(
          "SOCKET MESSAGE ERROR:",
          error
        );
      }
    }
  );

  socket.on("disconnect", () => {
    console.log(
      "Socket disconnected:",
      socket.id
    );

    if (socket.user) {
      onlineUsers.delete(
        socket.user.id
      );

      io.emit(
        "userOffline",
        socket.user.id
      );
    }
  });
});

/* =========================
   START SERVER
========================= */

connectDB()
  .then(() => {
    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `TELESUPAR server running on port ${PORT}`
        );
      }
    );
  })
  .catch(error => {
    console.error(
      "MongoDB connection failed:",
      error
    );

    process.exit(1);
  });
