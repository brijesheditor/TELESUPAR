const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const { Server } = require("socket.io");
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const { Readable } = require("stream");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});


const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 25 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",

      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/3gpp",

      "application/pdf",
      "text/plain",
      "application/zip",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("This file type is not allowed"));
    }
  }
});

function uploadToCloudinary(file) {
  return new Promise((resolve, reject) => {
    const isImage = file.mimetype.startsWith("image/");
    const isVideo = file.mimetype.startsWith("video/");

    const resourceType = isImage
      ? "image"
      : isVideo
        ? "video"
        : "raw";

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "telesupar",
        resource_type: resourceType,
        type: "upload"
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    Readable.from(file.buffer).pipe(stream);
  });
}

const app = express();
const server = http.createServer(app);

/* =========================================
   MIDDLEWARE
========================================= */

app.use(cors());

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);

/* =========================================
   SOCKET.IO
========================================= */

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },

    pingInterval: 25000,
    pingTimeout: 20000
});

/* =========================================
   CONFIG
========================================= */

const PORT =
    process.env.PORT || 3000;

const MONGODB_URI =
    process.env.MONGODB_URI;

const JWT_SECRET =
    process.env.JWT_SECRET;

/* =========================================
   DATABASE
========================================= */

let db;
let users;
let messages;
let conversations;
let stories;
let posts;
let notifications;
let comments;
let follows;
let groups;

const client =
    new MongoClient(
        MONGODB_URI
    );

/* =========================================
   ONLINE USERS
========================================= */

/*
    userId -> Set(socketId)

    Example:

    {
        "abc123": Set(
            ["socket1", "socket2"]
        )
    }

    This supports multiple tabs/devices.
*/

const onlineUsers =
    new Map();

/* =========================================
   DATABASE CONNECTION
========================================= */


async function connectDatabase() {

    await client.connect();

    db =
        client.db("telesupar");

    users =
        db.collection("users");

    messages =
        db.collection("messages");

    conversations =
        db.collection("conversations");

    stories =
        db.collection("stories");

  posts = db.collection("posts");

  notifications = db.collection("notifications");

  comments = db.collection("comments");

  follows = db.collection("follows");

  groups = db.collection("groups");
await groups.createIndex({ updatedAt: -1 });
  

await notifications.createIndex({
  recipientId: 1,
  createdAt: -1
});

await notifications.createIndex({
  recipientId: 1,
  read: 1
});

// COMMENTS INDEXES
await comments.createIndex({
  postId: 1,
  createdAt: -1
});

await comments.createIndex({
  userId: 1
});
  
await posts.createIndex({ createdAt: -1 });

    await users.createIndex(
        {
            username: 1
        },
        {
            unique: true
        }
    );

    await users.createIndex(
        {
            email: 1
        },
        {
            unique: true
        }
    );

    await conversations.createIndex(
        {
            memberKey: 1
        },
        {
            unique: true
        }
    );

    await messages.createIndex({
        conversationId: 1,
        createdAt: 1
    });

    // Stories expire automatically after 24 hours
    await stories.createIndex(
        {
            expiresAt: 1
        },
        {
            expireAfterSeconds: 0
        }
    );

    // Find active stories quickly
    await stories.createIndex({
        userId: 1,
        expiresAt: 1
    });

  // FOLLOWS INDEXES
await follows.createIndex(
  {
    followerId: 1,
    followingId: 1
  },
  {
    unique: true
  }
);

await follows.createIndex({
  followingId: 1,
  createdAt: -1
});

await follows.createIndex({
  followerId: 1,
  createdAt: -1
});

    console.log(
        "MongoDB connected successfully"
    );
}


/* =========================================
   TOKEN
========================================= */

function makeToken(user) {

    return jwt.sign(
        {
            id:
                user._id.toString(),

            username:
                user.username,

            email:
                user.email
        },

        JWT_SECRET,

        {
            expiresIn: "30d"
        }
    );
}

/* =========================================
   PUBLIC USER
========================================= */

function publicUser(user) {

    if (!user) {
        return null;
    }

    const userId =
        user._id.toString();

    return {

        id:
            userId,

        username:
            user.username,

        displayName:
            user.displayName ||
            user.username,

        email:
            user.email,

      bio:
        user.bio || "",
avatar:
  user.avatar || "",

        createdAt:
            user.createdAt,

        isOnline:
            isUserOnline(userId),

        lastSeen:
            user.lastSeen ||
            null
    };
}

function publicProfileUser(user) {
    if (!user) return null;

    const userId = user._id.toString();

    return {
        id: userId,
        username: user.username || "",
        displayName: user.displayName || user.username || "User",
        bio: user.bio || "",
        avatar: user.avatar || "",
        createdAt: user.createdAt || null,
        isOnline: isUserOnline(userId),
        lastSeen: user.lastSeen || null
    };
}

/* =========================================
   AUTH
========================================= */

function auth(
    req,
    res,
    next
) {

    const header =
        req.headers.authorization ||
        "";

    if (
        !header.startsWith(
            "Bearer "
        )
    ) {

        return res.status(401).json({
            success: false,
            message:
                "Login required"
        });
    }

    const token =
        header.substring(7);

    try {

        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );

        req.user =
            decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message:
                "Invalid or expired token"
        });
    }
}

/* =========================================
   VALID OBJECT ID
========================================= */

function validId(id) {

    return ObjectId.isValid(id);
}

/* =========================================
   ONLINE CHECK
========================================= */

function isUserOnline(
    userId
) {

    const sockets =
        onlineUsers.get(
            String(userId)
        );

    return !!(
        sockets &&
        sockets.size > 0
    );
}

/* =========================================
   ADD ONLINE SOCKET
========================================= */

function addOnlineSocket(
    userId,
    socketId
) {

    const id =
        String(userId);

    let sockets =
        onlineUsers.get(id);

    const wasOffline =
        !sockets ||
        sockets.size === 0;

    if (!sockets) {

        sockets =
            new Set();

        onlineUsers.set(
            id,
            sockets
        );
    }

    sockets.add(
        socketId
    );

    return wasOffline;
}

/* =========================================
   REMOVE ONLINE SOCKET
========================================= */

function removeOnlineSocket(
    userId,
    socketId
) {

    const id =
        String(userId);

    const sockets =
        onlineUsers.get(id);

    if (!sockets) {
        return false;
    }

    sockets.delete(
        socketId
    );

    if (
        sockets.size === 0
    ) {

        onlineUsers.delete(id);

        return true;
    }

    return false;
}

/* =========================================
   SAVE LAST SEEN
========================================= */

async function saveLastSeen(
    userId
) {

    if (!users) return;

    try {

        const now =
            new Date();

        await users.updateOne(
            {
                _id:
                    new ObjectId(
                        userId
                    )
            },

            {
                $set: {
                    lastSeen:
                        now
                }
            }
        );

        return now;

    } catch (error) {

        console.error(
            "LAST SEEN ERROR:",
            error
        );

        return null;
    }
}

/* =========================================
   BROADCAST ONLINE
========================================= */

function broadcastUserOnline(
    userId
) {

    io.emit(
        "userOnline",
        String(userId)
    );
}

/* =========================================
   BROADCAST OFFLINE
========================================= */

async function broadcastUserOffline(
    userId
) {

    const lastSeen =
        await saveLastSeen(
            userId
        );

    io.emit(
        "userOffline",
        {
            userId:
                String(userId),

            lastSeen
        }
    );
}

/* =========================================
   HOME
========================================= */

app.get(
    "/",
    function(req, res) {

        res.json({
            name: "TELESUPAR",
            status: "running"
        });

    }
);

/* =========================================
   HEALTH
========================================= */

app.get(
    "/api/health",
    async function(req, res) {

        try {

            await db.command({
                ping: 1
            });

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

    }
);

/* =========================================
   REGISTER
========================================= */

app.post(
    "/api/register",
    async function(req, res) {

        try {

            const username =
                String(
                    req.body.username ||
                    ""
                )
                    .trim()
                    .toLowerCase();

            const displayName =
                String(
                    req.body.displayName ||
                    ""
                ).trim();

            const email =
                String(
                    req.body.email ||
                    ""
                )
                    .trim()
                    .toLowerCase();

            const password =
                String(
                    req.body.password ||
                    ""
                );

            if (
                !username ||
                !displayName ||
                !email ||
                !password
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "All fields are required"
                });
            }

            if (
                username.length < 3
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Username must be at least 3 characters"
                });
            }

            if (
                password.length < 6
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Password must be at least 6 characters"
                });
            }

            const existing =
                await users.findOne({
                    $or: [
                        {
                            username
                        },
                        {
                            email
                        }
                    ]
                });

            if (existing) {

                return res.status(409).json({
                    success: false,
                    message:
                        "Username or email already exists"
                });
            }

            const hashedPassword =
                await bcrypt.hash(
                    password,
                    12
                );

            const user = {

                username,

                displayName,

                email,

                password:
                    hashedPassword,

                createdAt:
                    new Date(),

                lastSeen:
                    null
            };

            const result =
                await users.insertOne(
                    user
                );

            user._id =
                result.insertedId;

            const token =
                makeToken(user);

            res.status(201).json({

                success: true,

                message:
                    "Account created successfully",

                token,

                user:
                    publicUser(user)
            });

        } catch (error) {

            console.error(
                "REGISTER ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Registration failed"
            });
        }

    }
);

/* =========================================
   LOGIN
========================================= */

app.post(
    "/api/login",
    async function(req, res) {

        try {

            const email =
                String(
                    req.body.email ||
                    ""
                )
                    .trim()
                    .toLowerCase();

            const password =
                String(
                    req.body.password ||
                    ""
                );

            if (
                !email ||
                !password
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Email and password are required"
                });
            }

            const user =
                await users.findOne({
                    email
                });

            if (!user) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid email or password"
                });
            }

            const match =
                await bcrypt.compare(
                    password,
                    user.password
                );

            if (!match) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid email or password"
                });
            }

            const token =
                makeToken(user);

            res.json({

                success: true,

                message:
                    "Login successful",

                token,

                user:
                    publicUser(user)
            });

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Login failed"
            });
        }

    }
);

/* =========================================
   MY PROFILE
========================================= */

app.get(
    "/api/me",
    auth,
    async function(req, res) {

        try {

            const user =
                await users.findOne({
                    _id:
                        new ObjectId(
                            req.user.id
                        )
                });

            if (!user) {

                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });
            }

            res.json({

                success: true,

                user:
                    publicUser(user)
            });

        } catch (error) {

            console.error(
                "ME ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not load profile"
            });
        }

    }
);

/* =================================
   UPDATE MY PROFILE
================================= */

app.patch("/api/me", auth, async function(req, res) {
  try {
    const displayName = String(req.body.displayName || "").trim();
    const bio = String(req.body.bio || "").trim();

    if (displayName.length < 2 || displayName.length > 40) {
      return res.status(400).json({
        success: false,
        message: "Name must be 2-40 characters"
      });
    }

    if (bio.length > 160) {
      return res.status(400).json({
        success: false,
        message: "Bio must be under 160 characters"
      });
    }

    await users.updateOne(
      { _id: new ObjectId(req.user.id) },
      {
        $set: {
          displayName,
          bio
        }
      }
    );

    const user = await users.findOne({
      _id: new ObjectId(req.user.id)
    });

    res.json({
      success: true,
      message: "Profile updated",
      user: publicUser(user)
    });

  } catch (error) {
    console.error("PROFILE UPDATE ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Could not update profile"
    });
  }
});


/* =================================
   PROFILE PHOTO UPLOAD
================================= */

app.post(
  "/api/me/avatar",
  auth,
  upload.single("file"),
  async function(req, res) {
    try {
      if (!req.file || !req.file.mimetype.startsWith("image/")) {
        return res.status(400).json({
          success: false,
          message: "Please select an image"
        });
      }

      const uploaded = await uploadToCloudinary(req.file);

      await users.updateOne(
        { _id: new ObjectId(req.user.id) },
        {
          $set: {
            avatar: uploaded.secure_url
          }
        }
      );

      const user = await users.findOne({
        _id: new ObjectId(req.user.id)
      });

      res.json({
        success: true,
        message: "Profile photo updated",
        user: publicUser(user)
      });

    } catch (error) {
      console.error("AVATAR ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Photo upload failed"
      });
    }
  }
);


app.post(
  "/api/stories",
  auth,
  upload.single("file"),
  async function(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please select a photo or video"
        });
      }

      const mimeType = req.file.mimetype;

      if (
        !mimeType.startsWith("image/") &&
        !mimeType.startsWith("video/")
      ) {
        return res.status(400).json({
          success: false,
          message: "Only photos and videos are allowed in stories"
        });
      }

      const caption = String(
        req.body.caption || ""
      ).trim().slice(0, 200);

      const uploaded =
        await uploadToCloudinary(req.file);

      const now = new Date();

      const story = {
        userId: new ObjectId(req.user.id),
        mediaUrl: uploaded.secure_url,
        publicId: uploaded.public_id,
        resourceType: uploaded.resource_type,
        mimeType: mimeType,
        fileName: req.file.originalname,
        size: req.file.size,
        caption: caption,
        likes: [],
        views: [],
        createdAt: now,
        expiresAt: new Date(
          now.getTime() + 24 * 60 * 60 * 1000
        )
      };

      const result = await stories.insertOne(story);

      return res.status(201).json({
        success: true,
        message: "Story uploaded successfully",
        story: {
          id: result.insertedId.toString(),
          mediaUrl: story.mediaUrl,
          resourceType: story.resourceType,
          caption: story.caption,
          createdAt: story.createdAt,
          expiresAt: story.expiresAt,
          likesCount: 0,
          viewsCount: 0
        }
      });

    } catch (error) {
      console.error("STORY UPLOAD ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Story upload failed"
      });
    }
  }
);


// =====================================
// STORY VIEW API
// =====================================

app.post(
  "/api/stories/:storyId/view",
  auth,
  async function(req, res) {
    try {
      const storyId = req.params.storyId;
      const viewerId = req.user.id;

      if (!validId(storyId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid story ID"
        });
      }

      const now = new Date();

      const story = await stories.findOne({
        _id: new ObjectId(storyId),
        expiresAt: { $gt: now }
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          message: "Story not found or expired"
        });
      }

      // Owner's own view is not counted
      if (story.userId.toString() === viewerId) {
        return res.json({
          success: true,
          counted: false
        });
      }

      await stories.updateOne(
        {
          _id: new ObjectId(storyId),
          expiresAt: { $gt: now },
          "views.userId": {
            $ne: new ObjectId(viewerId)
          }
        },
        {
          $push: {
            views: {
              userId: new ObjectId(viewerId),
              viewedAt: now
            }
          }
        }
      );

      const updatedStory = await stories.findOne({
        _id: new ObjectId(storyId)
      });

      return res.json({
        success: true,
        counted: true,
        viewsCount: updatedStory?.views?.length || 0
      });

    } catch (error) {
      console.error("STORY VIEW ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not record story view"
      });
    }
  }
);


// =====================================
// STORY LIKE / UNLIKE API
// =====================================
// STORY LIKE / UNLIKE + NOTIFICATION
app.post(
  "/api/stories/:storyId/like",
  auth,
  async function(req, res) {
    try {
      const storyId = req.params.storyId;
      const userId = req.user.id;

      if (!validId(storyId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid story ID"
        });
      }

      const storyObjectId = new ObjectId(storyId);
      const actorObjectId = new ObjectId(userId);

      const story = await stories.findOne({
        _id: storyObjectId,
        expiresAt: { $gt: new Date() }
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          message: "Story not found or expired"
        });
      }

      if (story.userId.toString() === userId) {
        return res.status(400).json({
          success: false,
          message: "You cannot like your own story"
        });
      }

      const alreadyLiked = (story.likes || []).some(
        id => id.toString() === userId
      );

      if (alreadyLiked) {
        await stories.updateOne(
          { _id: storyObjectId },
          { $pull: { likes: actorObjectId } }
        );

        // Unlike karne par us like ki notification hata do
        await notifications.deleteOne({
          recipientId: story.userId,
          actorId: actorObjectId,
          storyId: storyObjectId,
          type: "story_like"
        });
      } else {
        await stories.updateOne(
          {
            _id: storyObjectId,
            expiresAt: { $gt: new Date() }
          },
          { $addToSet: { likes: actorObjectId } }
        );

        // Story owner ko notification
        await notifications.insertOne({
          recipientId: story.userId,
          actorId: actorObjectId,
          storyId: storyObjectId,
          type: "story_like",
          read: false,
          createdAt: new Date()
        });
      }

      const updatedStory = await stories.findOne({
        _id: storyObjectId
      });

      return res.json({
        success: true,
        liked: !alreadyLiked,
        likesCount: updatedStory?.likes?.length || 0
      });

    } catch (error) {
      console.error("STORY LIKE ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not update story like"
      });
    }
  }
);

// =====================================
// STORY VIEWERS LIST API
// Only story owner can see viewers
// =====================================

app.get(
  "/api/stories/:storyId/viewers",
  auth,
  async function(req, res) {
    try {
      const storyId = req.params.storyId;
      const ownerId = req.user.id;

      if (!validId(storyId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid story ID"
        });
      }

      const story = await stories.findOne({
        _id: new ObjectId(storyId),
        userId: new ObjectId(ownerId),
        expiresAt: { $gt: new Date() }
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          message: "Story not found or access denied"
        });
      }

      const views = story.views || [];

      const viewerIds = views.map(
        view => view.userId
      );

      const viewerUsers = await users.find({
        _id: { $in: viewerIds }
      }).toArray();

      const viewerMap = new Map(
        viewerUsers.map(user => [
          user._id.toString(),
          publicProfileUser(user)
        ])
      );

      const viewers = views.map(view => ({
        user: viewerMap.get(
          view.userId.toString()
        ) || null,
        viewedAt: view.viewedAt
      })).filter(view => view.user !== null);

      return res.json({
        success: true,
        viewsCount: views.length,
        viewers
      });

    } catch (error) {
      console.error("STORY VIEWERS ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not load story viewers"
      });
    }
  }
);

// =====================================
// STORY LIKES LIST API
// Only story owner can see who liked
// =====================================

app.get(
  "/api/stories/:storyId/likes",
  auth,
  async function(req, res) {
    try {
      const storyId = req.params.storyId;
      const ownerId = req.user.id;

      if (!validId(storyId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid story ID"
        });
      }

      const story = await stories.findOne({
        _id: new ObjectId(storyId),
        userId: new ObjectId(ownerId),
        expiresAt: { $gt: new Date() }
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          message: "Story not found or access denied"
        });
      }

      const likeIds = story.likes || [];

      const likedUsers = await users.find({
        _id: { $in: likeIds }
      }).toArray();

      const likes = likedUsers.map(user =>
        publicProfileUser(user)
      );

      return res.json({
        success: true,
        likesCount: likeIds.length,
        likes
      });

    } catch (error) {
      console.error("STORY LIKES ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not load story likes"
      });
    }
  }
);

// =====================================
// STORIES FEED API
// Returns my stories and other users' active stories
// =====================================

app.get(
  "/api/stories/feed",
  auth,
  async function(req, res) {
    try {
      const myId = req.user.id;
      const now = new Date();

      // Get active stories from the last 24 hours
      const allStories = await stories.find({
        expiresAt: { $gt: now }
      })
      .sort({ createdAt: 1 })
      .limit(500)
      .toArray();

      // Collect user IDs
      const userIds = [
        ...new Set(
          allStories.map(story =>
            story.userId.toString()
          )
        )
      ];

      // Load public user profiles
      const storyUsers = await users.find({
        _id: {
          $in: userIds.map(id => new ObjectId(id))
        }
      }).toArray();

      const userMap = new Map(
        storyUsers.map(user => [
          user._id.toString(),
          publicProfileUser(user)
        ])
      );

      // Prepare story data
      const grouped = new Map();

      for (const story of allStories) {
        const userId = story.userId.toString();

        if (!grouped.has(userId)) {
          grouped.set(userId, []);
        }

        const likes = story.likes || [];
        const views = story.views || [];

        grouped.get(userId).push({
          id: story._id.toString(),
          mediaUrl: story.mediaUrl,
          resourceType: story.resourceType,
          mimeType: story.mimeType,
          caption: story.caption || "",
          createdAt: story.createdAt,
          expiresAt: story.expiresAt,
          likesCount: likes.length,
          viewsCount: views.length,
          likedByMe: likes.some(
            id => id.toString() === myId
          ),
          viewedByMe: views.some(
            view => view.userId.toString() === myId
          )
        });
      }

      const myStories = grouped.get(myId) || [];

      const otherUsers = [];

      for (const [userId, userStories] of grouped) {
        if (userId === myId) continue;

        const user = userMap.get(userId);
        if (!user) continue;

        otherUsers.push({
          user,
          stories: userStories
        });
      }

      // Most recently updated users first
      otherUsers.sort((a, b) => {
        const aTime = new Date(
          a.stories[a.stories.length - 1].createdAt
        ).getTime();

        const bTime = new Date(
          b.stories[b.stories.length - 1].createdAt
        ).getTime();

        return bTime - aTime;
      });

      return res.json({
        success: true,
        myStories,
        users: otherUsers
      });

    } catch (error) {
      console.error("STORIES FEED ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not load stories feed"
      });
    }
  }
);


// =====================================
// DELETE MY STORY API
// Only story owner can delete
// =====================================

app.delete(
  "/api/stories/:storyId",
  auth,
  async function(req, res) {
    try {
      const storyId = req.params.storyId;
      const userId = req.user.id;

      if (!validId(storyId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid story ID"
        });
      }

      // Find only my own active story
      const story = await stories.findOne({
        _id: new ObjectId(storyId),
        userId: new ObjectId(userId),
        expiresAt: { $gt: new Date() }
      });

      if (!story) {
        return res.status(404).json({
          success: false,
          message: "Story not found or access denied"
        });
      }

      // Delete media from Cloudinary
      if (story.publicId) {
        await cloudinary.uploader.destroy(
          story.publicId,
          {
            resource_type: story.resourceType || "image",
            type: "upload",
            invalidate: true
          }
        );
      }

      // Delete story from MongoDB
      await stories.deleteOne({
        _id: new ObjectId(storyId),
        userId: new ObjectId(userId)
      });

      return res.json({
        success: true,
        message: "Story deleted successfully",
        storyId: storyId
      });

    } catch (error) {
      console.error("STORY DELETE ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not delete story"
      });
    }
  }
);




/* =========================================
   TELESUPAR POSTS API
========================================= */


// GET ALL POSTS
app.get("/api/posts/feed", auth, async (req, res) => {
  try {
    const myId = req.user.id;
    const allPosts = await posts.find({})
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    // GET COMMENT COUNTS FOR ALL POSTS
    const postIds = allPosts.map(post => post._id);

    const commentCounts = await comments.aggregate([
      {
        $match: {
          postId: { $in: postIds }
        }
      },
      {
        $group: {
          _id: "$postId",
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const commentCountMap = new Map(
      commentCounts.map(item => [
        item._id.toString(),
        item.count
      ])
    );

    const ids = [...new Set(
      allPosts.map(post => post.userId.toString())
    )];

    const authors = await users.find({
      _id: { $in: ids.map(id => new ObjectId(id)) }
    }).toArray();

    const authorMap = new Map(
      authors.map(user => [
        user._id.toString(),
        publicProfileUser(user)
      ])
    );

    // Fetch follow status for current user with these authors
    const authorObjectIds = ids.map(id => new ObjectId(id));
    const myFollows = await follows.find({
      followerId: new ObjectId(myId),
      followingId: { $in: authorObjectIds }
    }).toArray();

    const followingSet = new Set(
      myFollows.map(f => f.followingId.toString())
    );

    const result = allPosts.map(post => {
      const authorId = post.userId.toString();
      return {
        id: post._id.toString(),
        caption: post.caption || "",
        mediaUrl: post.mediaUrl,
        mediaType: post.mediaType,
        createdAt: post.createdAt,
        likesCount: (post.likes || []).length,
        commentsCount: commentCountMap.get(post._id.toString()) || 0,
        likedByMe: (post.likes || []).some(id => id.toString() === myId),
        isFollowing: authorId === myId ? true : followingSet.has(authorId),
        isMyPost: authorId === myId,
        user: authorMap.get(authorId) || null
      };
    }).filter(post => post.user);

    res.json({
      success: true,
      posts: result
    });

  } catch (error) {
    console.error("POST FEED ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Could not load posts"
    });
  }
});



// CREATE POST
app.post(
  "/api/posts",
  auth,
  upload.single("file"),
  async (req, res) => {
    try {
      const caption = String(req.body.caption || "")
        .trim()
        .slice(0, 2200);

      if (!req.file && !caption) {
        return res.status(400).json({
          success: false,
          message: "Add a photo, video or caption"
        });
      }

      let mediaUrl = "";
      let mediaType = "";

      if (req.file) {
        const type = req.file.mimetype;

        if (!type.startsWith("image/") &&
            !type.startsWith("video/")) {
          return res.status(400).json({
            success: false,
            message: "Only photos and videos are allowed"
          });
        }

        const uploaded = await uploadToCloudinary(req.file);
        mediaUrl = uploaded.secure_url;
        mediaType = type.startsWith("video/") ? "video" : "image";
      }

      const post = {
        userId: new ObjectId(req.user.id),
        caption,
        mediaUrl,
        mediaType,
        likes: [],
        createdAt: new Date()
      };

      const saved = await posts.insertOne(post);

      res.status(201).json({
        success: true,
        message: "Post published",
        post: {
          id: saved.insertedId.toString(),
          caption,
          mediaUrl,
          mediaType,
          createdAt: post.createdAt
        }
      });
    } catch (error) {
      console.error("CREATE POST ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Could not publish post"
      });
    }
  }
);


/* =====================================
   COMMENTS SYSTEM
===================================== */

// 1. CREATE COMMENT
app.post(
  "/api/posts/:postId/comments",
  auth,
  async (req, res) => {
    try {
      const postId = req.params.postId;
      const userId = req.user.id;

      if (!validId(postId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid post ID"
        });
      }

      const text = String(req.body.text || "")
        .trim()
        .slice(0, 500);

      if (!text) {
        return res.status(400).json({
          success: false,
          message: "Comment cannot be empty"
        });
      }

      const postObjectId = new ObjectId(postId);
      const userObjectId = new ObjectId(userId);

      const post = await posts.findOne({
        _id: postObjectId
      });

      if (!post) {
        return res.status(404).json({
          success: false,
          message: "Post not found"
        });
      }

      const comment = {
        postId: postObjectId,
        userId: userObjectId,
        text,
        createdAt: new Date()
      };

      const saved = await comments.insertOne(comment);

      // Notify post owner
      if (post.userId.toString() !== userId) {
        await notifications.insertOne({
          recipientId: post.userId,
          actorId: userObjectId,
          postId: postObjectId,
          commentId: saved.insertedId,
          commentText: text,
          type: "post_comment",
          read: false,
          createdAt: new Date()
        });
      }

      const user = await users.findOne({
        _id: userObjectId
      });

      res.status(201).json({
        success: true,
        message: "Comment added",
        comment: {
          id: saved.insertedId.toString(),
          text,
          createdAt: comment.createdAt,
          user: publicProfileUser(user)
        }
      });

    } catch (error) {
      console.error("CREATE COMMENT ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Could not add comment"
      });
    }
  }
);


 // REPLY TO COMMENT
app.post(
  "/api/posts/:postId/comments/:commentId/replies",
  auth,
  async (req, res) => {
    try {
      const { postId, commentId } = req.params;
      const userId = req.user.id;

      if (!validId(postId) || !validId(commentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid ID"
        });
      }

      const text = String(req.body.text || "")
        .trim()
        .slice(0, 500);

      if (!text) {
        return res.status(400).json({
          success: false,
          message: "Reply cannot be empty"
        });
      }

      const postObjectId = new ObjectId(postId);
      const commentObjectId = new ObjectId(commentId);
      const userObjectId = new ObjectId(userId);

      const parentComment = await comments.findOne({
        _id: commentObjectId,
        postId: postObjectId
      });

      if (!parentComment) {
        return res.status(404).json({
          success: false,
          message: "Comment not found"
        });
      }

      // Keep replies attached to top-level comments
      if (parentComment.parentCommentId) {
        return res.status(400).json({
          success: false,
          message: "Reply to the original comment"
        });
      }

      const reply = {
        postId: postObjectId,
        userId: userObjectId,
        parentCommentId: commentObjectId,
        text,
        createdAt: new Date()
      };

      const saved = await comments.insertOne(reply);

      // Notify original comment author
      if (parentComment.userId.toString() !== userId) {
        await notifications.insertOne({
          recipientId: parentComment.userId,
          actorId: userObjectId,
          postId: postObjectId,
          commentId: commentObjectId,
          replyId: saved.insertedId,
          commentText: text,
          type: "post_comment_reply",
          read: false,
          createdAt: new Date()
        });
      }

      const user = await users.findOne({
        _id: userObjectId
      });

      res.status(201).json({
        success: true,
        message: "Reply added",
        reply: {
          id: saved.insertedId.toString(),
          parentCommentId: commentObjectId.toString(),
          text,
          createdAt: reply.createdAt,
          user: publicProfileUser(user)
        }
      });

    } catch (error) {
      console.error("CREATE REPLY ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Could not add reply"
      });
    }
  }
);

 // GET COMMENTS WITH REPLIES
app.get(
  "/api/posts/:postId/comments",
  auth,
  async (req, res) => {
    try {
      const postId = req.params.postId;

      if (!validId(postId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid post ID"
        });
      }

      const postObjectId = new ObjectId(postId);

      const post = await posts.findOne({
        _id: postObjectId
      });

      if (!post) {
        return res.status(404).json({
          success: false,
          message: "Post not found"
        });
      }

      // Fetch original comments
      const allComments = await comments.find({
        postId: postObjectId,
        parentCommentId: { $exists: false }
      })
        .sort({ createdAt: 1 })
        .limit(100)
        .toArray();

      // Fetch replies for these comments
      const parentIds = allComments.map(c => c._id);

      const allReplies = parentIds.length
        ? await comments.find({
            postId: postObjectId,
            parentCommentId: { $in: parentIds }
          })
          .sort({ createdAt: 1 })
          .toArray()
        : [];

      // Collect all user IDs
      const userIds = [
        ...new Set(
          [...allComments, ...allReplies]
            .map(c => c.userId.toString())
        )
      ];

      const authors = await users.find({
        _id: {
          $in: userIds.map(id => new ObjectId(id))
        }
      }).toArray();

      const authorMap = new Map(
        authors.map(user => [
          user._id.toString(),
          publicProfileUser(user)
        ])
      );

      // Format replies
      const replyMap = new Map();

      allReplies.forEach(reply => {
        const parentId = reply.parentCommentId.toString();

        if (!replyMap.has(parentId)) {
          replyMap.set(parentId, []);
        }

        replyMap.get(parentId).push({
          id: reply._id.toString(),
          text: reply.text,
          createdAt: reply.createdAt,
          user: authorMap.get(reply.userId.toString()) || null,
          isMine: reply.userId.toString() === req.user.id
        });
      });

      // Format original comments
      const result = allComments.map(c => ({
        id: c._id.toString(),
        text: c.text,
        createdAt: c.createdAt,
        user: authorMap.get(c.userId.toString()) || null,
        isMine: c.userId.toString() === req.user.id,
        replies: replyMap.get(c._id.toString()) || []
      }));

      res.json({
        success: true,
        comments: result,
        count: allComments.length,
        repliesCount: allReplies.length
      });

    } catch (error) {
      console.error("GET COMMENTS ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Could not load comments"
      });
    }
  }
);


 // EDIT MY COMMENT OR REPLY
app.patch(
  "/api/posts/:postId/comments/:commentId",
  auth,
  async (req, res) => {
    try {
      const { postId, commentId } = req.params;

      if (!validId(postId) || !validId(commentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid ID"
        });
      }

      const text = String(req.body.text || "")
        .trim()
        .slice(0, 500);

      if (!text) {
        return res.status(400).json({
          success: false,
          message: "Comment cannot be empty"
        });
      }

      const result = await comments.updateOne(
        {
          _id: new ObjectId(commentId),
          postId: new ObjectId(postId),
          userId: new ObjectId(req.user.id)
        },
        {
          $set: {
            text,
            editedAt: new Date()
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Comment not found or not yours"
        });
      }

      res.json({
        success: true,
        message: "Comment updated"
      });

    } catch (error) {
      console.error("EDIT COMMENT ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Could not edit comment"
      });
    }
  }
);

 // DELETE MY COMMENT + ALL REPLIES
app.delete(
  "/api/posts/:postId/comments/:commentId",
  auth,
  async (req, res) => {
    try {
      const { postId, commentId } = req.params;

      if (!validId(postId) || !validId(commentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid ID"
        });
      }

      const postObjectId = new ObjectId(postId);
      const commentObjectId = new ObjectId(commentId);
      const userObjectId = new ObjectId(req.user.id);

      // Find original comment or reply owned by current user
      const comment = await comments.findOne({
        _id: commentObjectId,
        postId: postObjectId,
        userId: userObjectId
      });

      if (!comment) {
        return res.status(404).json({
          success: false,
          message: "Comment not found or not yours"
        });
      }

      let deletedIds = [commentObjectId];

      // If original comment, collect all its replies
      if (!comment.parentCommentId) {
        const replies = await comments.find({
          postId: postObjectId,
          parentCommentId: commentObjectId
        }).project({ _id: 1 }).toArray();

        deletedIds = [
          commentObjectId,
          ...replies.map(reply => reply._id)
        ];

        // Delete original comment and all replies
        await comments.deleteMany({
          postId: postObjectId,
          $or: [
            { _id: commentObjectId },
            { parentCommentId: commentObjectId }
          ]
        });

      } else {
        // Delete only selected reply
        await comments.deleteOne({
          _id: commentObjectId,
          postId: postObjectId,
          userId: userObjectId
        });
      }

      // Remove notifications related to deleted comments/replies
      await notifications.deleteMany({
        postId: postObjectId,
        $or: [
          { commentId: { $in: deletedIds } },
          { replyId: { $in: deletedIds } }
        ]
      });

      res.json({
        success: true,
        message: "Comment and related replies deleted",
        deletedCount: deletedIds.length
      });

    } catch (error) {
      console.error("DELETE COMMENT ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Could not delete comment"
      });
    }
  }
);


// LIKE / UNLIKE POST
app.post("/api/posts/:postId/like", auth, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.id;

    if (!validId(postId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid post ID"
      });
    }

    const post = await posts.findOne({
      _id: new ObjectId(postId)
    });

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Post not found"
      });
    }

    const alreadyLiked = (post.likes || []).some(
      id => id.toString() === userId
    );

    if (alreadyLiked) {
      await posts.updateOne(
        { _id: new ObjectId(postId) },
        { $pull: { likes: new ObjectId(userId) } }
      );

      await notifications.deleteOne({
        recipientId: post.userId,
        actorId: new ObjectId(userId),
        postId: new ObjectId(postId),
        type: "post_like"
      });

    } else {
      await posts.updateOne(
        { _id: new ObjectId(postId) },
        { $addToSet: { likes: new ObjectId(userId) } }
      );

      // Don't notify users about their own likes
      if (post.userId.toString() !== userId) {
        await notifications.insertOne({
          recipientId: post.userId,
          actorId: new ObjectId(userId),
          postId: new ObjectId(postId),
          type: "post_like",
          read: false,
          createdAt: new Date()
        });
      }
    }

    const updated = await posts.findOne({
      _id: new ObjectId(postId)
    });

    res.json({
      success: true,
      liked: !alreadyLiked,
      likesCount: (updated.likes || []).length
    });

  } catch (error) {
    console.error("POST LIKE ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Could not update like"
    });
  }
});

/* =================================
   NOTIFICATIONS API
================================= */

// GET MY NOTIFICATIONS
app.get("/api/notifications", auth, async (req, res) => {
  try {
    const recipientId = new ObjectId(req.user.id);

    const items = await notifications.find({
      recipientId
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    const actorIds = [
      ...new Set(
        items
          .filter(n => n.actorId)
          .map(n => n.actorId.toString())
      )
    ];

    const postIds = [
      ...new Set(
        items
          .filter(n => n.postId)
          .map(n => n.postId.toString())
      )
    ];

    const storyIds = [
      ...new Set(
        items
          .filter(n => n.storyId)
          .map(n => n.storyId.toString())
      )
    ];

    const commentIds = [
  ...new Set(
    items
      .filter(n => n.commentId)
      .map(n => n.commentId.toString())
  )
];

    const [actors, relatedPosts, relatedStories, relatedComments, unreadCount] =
      await Promise.all([
        users.find({
          _id: {
            $in: actorIds.map(id => new ObjectId(id))
          }
        }).toArray(),

        posts.find({
          _id: {
            $in: postIds.map(id => new ObjectId(id))
          }
        }).toArray(),

        stories.find({
          _id: {
            $in: storyIds.map(id => new ObjectId(id))
          }
        }).toArray(),

        comments.find({
  _id: {
    $in: commentIds.map(id => new ObjectId(id))
  }
}).toArray(),

        notifications.countDocuments({
          recipientId,
          read: false
        })
      ]);

    const actorMap = new Map(
      actors.map(user => [
        user._id.toString(),
        publicProfileUser(user)
      ])
    );

    const postMap = new Map(
      relatedPosts.map(post => [
        post._id.toString(),
        {
          id: post._id.toString(),
          caption: post.caption || "",
          mediaUrl: post.mediaUrl || ""
        }
      ])
    );

    const storyMap = new Map(
      relatedStories.map(story => [
        story._id.toString(),
        {
          id: story._id.toString(),
          mediaUrl: story.mediaUrl || "",
          caption: story.caption || "",
          expiresAt: story.expiresAt
        }
      ])
    );

    const commentMap = new Map(
  relatedComments.map(comment => [
    comment._id.toString(),
    comment.text || ""
  ])
);

    
const result = items.map(n => ({
  id: n._id.toString(),
  type: n.type,
  read: !!n.read,
  createdAt: n.createdAt,

  actor: n.actorId
    ? actorMap.get(n.actorId.toString()) || null
    : null,

  post: n.postId
    ? postMap.get(n.postId.toString()) || null
    : null,

  story: n.storyId
    ? storyMap.get(n.storyId.toString()) || null
    : null,

  commentId: n.commentId
    ? n.commentId.toString()
    : null,

  replyId: n.replyId
    ? n.replyId.toString()
    : null,

  commentText: n.commentText || "",

  parentCommentText: n.commentId
    ? commentMap.get(n.commentId.toString()) || ""
    : ""
}));


    res.json({
      success: true,
      notifications: result,
      unreadCount
    });

  } catch (error) {
    console.error("NOTIFICATIONS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not load notifications"
    });
  }
});

// MARK ALL NOTIFICATIONS AS READ
app.patch("/api/notifications/read", auth, async (req, res) => {
  try {
    const recipientId = new ObjectId(req.user.id);

    await notifications.updateMany(
      {
        recipientId,
        read: false
      },
      {
        $set: {
          read: true,
          readAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: "Notifications marked as read"
    });

  } catch (error) {
    console.error("MARK READ ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not mark notifications as read"
    });
  }
});


/* =========================================
   USER SEARCH
========================================= */

app.get(
    "/api/users",
    auth,
    async function(req, res) {

        try {

            const search =
                String(
                    req.query.search ||
                    ""
                ).trim();

            const query = {

                _id: {
                    $ne:
                        new ObjectId(
                            req.user.id
                        )
                }
            };

            
if (search) {
    const safeSearch = search.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );

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

    // EXACT USER ID SEARCH
    if (ObjectId.isValid(search)) {
        query.$or.unshift({
            _id: new ObjectId(search)
        });
    }
}


            const list =
                await users
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

                users:
    list.map(
        publicProfileUser
    )
            });

        } catch (error) {

            console.error(
                "USERS ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not load users"
            });
        }

    }
);

/* =========================================
   PUBLIC USER PROFILE
========================================= */

app.get(
    "/api/users/:userId/profile",
    auth,
    async function(req, res) {

        try {

            const userId = String(
                req.params.userId || ""
            );

            if (!ObjectId.isValid(userId)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid user ID"
                });
            }

            const user = await users.findOne({
                _id: new ObjectId(userId)
            });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }

            const profile = publicProfileUser(user);

            return res.json({
                success: true,
                profile: profile
            });

        } catch (error) {

            console.error(
                "PUBLIC PROFILE ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Could not load profile"
            });
        }
    }
);

// =====================================
// FOLLOW / UNFOLLOW SYSTEM V1
// =====================================

// FOLLOW USER
app.post("/api/users/:userId/follow", auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const myId = new ObjectId(req.user.id);

    if (!validId(targetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const followingId = new ObjectId(targetId);

    if (myId.equals(followingId)) {
      return res.status(400).json({
        success: false,
        message: "You cannot follow yourself"
      });
    }

    const targetUser = await users.findOne({
      _id: followingId
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const result = await follows.updateOne(
      {
        followerId: myId,
        followingId: followingId
      },
      {
        $setOnInsert: {
          followerId: myId,
          followingId: followingId,
          createdAt: new Date()
        }
      },
      {
        upsert: true
      }
    );

    // SEND NOTIFICATION ONLY FOR A NEW FOLLOW
    if (result.upsertedCount > 0) {
      await notifications.insertOne({
        recipientId: followingId,
        actorId: myId,
        type: "new_follow",
        read: false,
        createdAt: new Date()
      });
    }

    const followersCount = await follows.countDocuments({
      followingId: followingId
    });

    const followingCount = await follows.countDocuments({
      followerId: followingId
    });

    return res.json({
      success: true,
      following: true,
      followersCount,
      followingCount,
      message: "User followed successfully"
    });

  } catch (error) {
    console.error("FOLLOW ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Follow failed"
    });
  }
});


// UNFOLLOW USER
app.delete("/api/users/:userId/follow", auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const myId = new ObjectId(req.user.id);

    if (!validId(targetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const followingId = new ObjectId(targetId);

    const targetUser = await users.findOne({
      _id: followingId
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    await follows.deleteOne({
      followerId: myId,
      followingId: followingId
    });

    const followersCount = await follows.countDocuments({
      followingId: followingId
    });

    const followingCount = await follows.countDocuments({
      followerId: followingId
    });

    return res.json({
      success: true,
      following: false,
      followersCount,
      followingCount,
      message: "User unfollowed successfully"
    });

  } catch (error) {
    console.error("UNFOLLOW ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unfollow failed"
    });
  }
});


// FOLLOW STATUS
app.get("/api/users/:userId/follow-status", auth, async (req, res) => {
  try {
    const targetId = req.params.userId;
    const myId = new ObjectId(req.user.id);

    if (!validId(targetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const followingId = new ObjectId(targetId);

    const targetUser = await users.findOne({
      _id: followingId
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const [
      isFollowing,
      followsYou,
      followersCount,
      followingCount
    ] = await Promise.all([
      follows.findOne({
        followerId: myId,
        followingId: followingId
      }),

      follows.findOne({
        followerId: followingId,
        followingId: myId
      }),

      follows.countDocuments({
        followingId: followingId
      }),

      follows.countDocuments({
        followerId: followingId
      })
    ]);

    return res.json({
      success: true,
      following: !!isFollowing,
      followsYou: !!followsYou,
      followersCount,
      followingCount
    });

  } catch (error) {
    console.error("FOLLOW STATUS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not get follow status"
    });
  }
});


// GET FOLLOWERS
app.get("/api/users/:userId/followers", auth, async (req, res) => {
  try {
    const targetId = req.params.userId;

    if (!validId(targetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const userId = new ObjectId(targetId);

    const targetUser = await users.findOne({
      _id: userId
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const records = await follows.find({
      followingId: userId
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    const userIds = records.map(item => item.followerId);

    const followerUsers = await users.find({
      _id: { $in: userIds }
    }).toArray();

    const userMap = new Map(
      followerUsers.map(user => [
        user._id.toString(),
        publicProfileUser(user)
      ])
    );

    const result = records
      .map(item => userMap.get(item.followerId.toString()))
      .filter(Boolean);

    return res.json({
      success: true,
      count: result.length,
      users: result
    });

  } catch (error) {
    console.error("GET FOLLOWERS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not get followers"
    });
  }
});


// GET FOLLOWING
app.get("/api/users/:userId/following", auth, async (req, res) => {
  try {
    const targetId = req.params.userId;

    if (!validId(targetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const userId = new ObjectId(targetId);

    const targetUser = await users.findOne({
      _id: userId
    });

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const records = await follows.find({
      followerId: userId
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    const userIds = records.map(item => item.followingId);

    const followingUsers = await users.find({
      _id: { $in: userIds }
    }).toArray();

    const userMap = new Map(
      followingUsers.map(user => [
        user._id.toString(),
        publicProfileUser(user)
      ])
    );

    const result = records
      .map(item => userMap.get(item.followingId.toString()))
      .filter(Boolean);

    return res.json({
      success: true,
      count: result.length,
      users: result
    });

  } catch (error) {
    console.error("GET FOLLOWING ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not get following"
    });
  }
});

/* =========================================
   CREATE / GET CONVERSATION
========================================= */

app.post(
    "/api/conversations/:userId",
    auth,
    async function(req, res) {

        try {

            const myId =
                req.user.id;

            const otherId =
                req.params.userId;

            if (
                !validId(
                    otherId
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid user ID"
                });
            }

            if (
                myId === otherId
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "You cannot chat with yourself"
                });
            }

            const otherUser =
                await users.findOne({
                    _id:
                        new ObjectId(
                            otherId
                        )
                });

            if (!otherUser) {

                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });
            }

            const ids = [
                myId,
                otherId
            ].sort();

            const memberKey =
                ids.join(":");

            let conversation =
                await conversations.findOne({
                    memberKey
                });

            if (!conversation) {

                const newConversation = {

                    memberKey,

                    members: [

                        new ObjectId(
                            ids[0]
                        ),

                        new ObjectId(
                            ids[1]
                        )
                    ],

                    lastMessage:
                        "",

                    lastMessageAt:
                        null,

                    updatedAt:
                        new Date(),

                    createdAt:
                        new Date(),

                    unreadCounts: {

                        [ids[0]]: 0,

                        [ids[1]]: 0
                    }
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
                            memberKey
                        });

                    if (!conversation) {
                        throw insertError;
                    }
                }
            }

            const myUnread =
                Number(
                    conversation
                        .unreadCounts?.[myId] ||
                    0
                );

            const responseUser =
                publicUser(
                    otherUser
                );

            res.json({

                success: true,

                conversation: {

                    _id:
                        conversation._id.toString(),

                    id:
                        conversation._id.toString(),

                    members:
                        conversation.members.map(
                            function(id) {
                                return id.toString();
                            }
                        ),

                    lastMessage:
                        conversation.lastMessage ||
                        "",

                    lastMessageAt:
                        conversation.lastMessageAt ||
                        null,

                    updatedAt:
                        conversation.updatedAt,

                    unreadCount:
                        myUnread,

                    otherUser:
                        responseUser,

                    user:
                        responseUser
                }
            });

        } catch (error) {

            console.error(
                "CONVERSATION ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not create conversation"
            });
        }

    }
);

/* =========================================
   RECENT CHATS
========================================= */

app.get(
    "/api/conversations",
    auth,
    async function(req, res) {

        try {

            const myId =
                req.user.id;

            const myObjectId =
                new ObjectId(
                    myId
                );

            const list =
                await conversations
                    .find({
                        members:
                            myObjectId
                    })
                    .sort({
                        updatedAt: -1
                    })
                    .limit(100)
                    .toArray();

            const result = [];

            for (
                const conversation
                of list
            ) {

                let otherObjectId =
                    null;

                for (
                    const member
                    of conversation.members
                ) {

                    if (
                        member.toString() !==
                        myId
                    ) {

                        otherObjectId =
                            member;

                        break;
                    }
                }

                if (!otherObjectId) {
                    continue;
                }

                const otherUser =
                    await users.findOne({
                        _id:
                            otherObjectId
                    });

                if (!otherUser) {
                    continue;
                }

                const unreadCount =
                    Number(
                        conversation
                            .unreadCounts?.[myId] ||
                        0
                    );

                result.push({

                    id:
                        conversation._id.toString(),

                    _id:
                        conversation._id.toString(),

                    members:
                        conversation.members.map(
                            function(id) {
                                return id.toString();
                            }
                        ),

                    lastMessage:
                        conversation.lastMessage ||
                        "",

                    lastMessageAt:
                        conversation.lastMessageAt ||
                        null,

                    updatedAt:
                        conversation.updatedAt,

                    unreadCount,

                    otherUser:
                        publicUser(
                            otherUser
                        ),

                    user:
                        publicUser(
                            otherUser
                        )
                });
            }

            res.json({

                success: true,

                conversations:
                    result
            });

        } catch (error) {

            console.error(
                "RECENT CHATS ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not load chats"
            });
        }

    }
);

/* =========================================
   MESSAGE HISTORY
========================================= */

app.get(
    "/api/conversations/:conversationId/messages",
    auth,
    async function(req, res) {

        try {

            const conversationId =
                req.params.conversationId;

            if (
                !validId(
                    conversationId
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid conversation ID"
                });
            }

            const conversation =
                await conversations.findOne({

                    _id:
                        new ObjectId(
                            conversationId
                        ),

                    members:
                        new ObjectId(
                            req.user.id
                        )
                });

            if (!conversation) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Conversation not found"
                });
            }

            const list =
                await messages
                    .find({
                        conversationId:
                            new ObjectId(
                                conversationId
                            )
                    })
                    .sort({
                        createdAt: 1
                    })
                    .limit(500)
                    .toArray();

            const output =
                list.map(
                    function(message) {

                        return {

                            id:
                                message._id.toString(),

                            conversationId:
                                message.conversationId.toString(),

                            senderId:
                                message.senderId.toString(),

                            text:
                                message.deletedAt
                                ? ""
                                : (message.text || ""),
                          storyReply:
                                message.storyReply ||
                                null,
                          
                          attachment:
                                message.deletedAt
                                ? null
                                : (message.attachment || null),

                            createdAt:
                                message.createdAt,

                            deliveredAt:
                                message.deliveredAt ||
                                null,

                            seenAt:
                                message.seenAt ||
                                null,

                            editedAt:
                                message.editedAt ||
                                null,

                            deletedAt:
                                message.deletedAt ||
                                null,

                            reactions:
                                message.reactions ||
                                []
                      
                        };
                    }
                );

            res.json({

                success: true,

                messages:
                    output
            });

        } catch (error) {

            console.error(
                "HISTORY ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not load messages"
            });
        }

    }
);

/* =========================================
   MARK CONVERSATION AS READ
========================================= */

app.post(
    "/api/conversations/:conversationId/read",
    auth,
    async function(req, res) {

        try {

            const conversationId =
                req.params.conversationId;

            const myId =
                req.user.id;

            if (
                !validId(
                    conversationId
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid conversation ID"
                });
            }

            const conversation =
                await conversations.findOne({

                    _id:
                        new ObjectId(
                            conversationId
                        ),

                    members:
                        new ObjectId(
                            myId
                        )
                });

            if (!conversation) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Conversation not found"
                });
            }

            const now =
                new Date();

            /*
                IMPORTANT FIX:

                Old code used:

                seenAt: {
                    $exists: false
                }

                But messages are created
                with seenAt: null.

                So we now explicitly
                search for null.
            */

            await messages.updateMany(

                {
                    conversationId:
                        new ObjectId(
                            conversationId
                        ),

                    senderId: {
                        $ne:
                            new ObjectId(
                                myId
                            )
                    },

                    $or: [

                        {
                            seenAt:
                                null
                        },

                        {
                            seenAt: {
                                $exists:
                                    false
                            }
                        }
                    ]
                },

                {
                    $set: {
                        seenAt:
                            now
                    }
                }
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

                        [`unreadCounts.${myId}`]:
                            0
                    }
                }
            );

            const otherId =
                conversation.members.find(
                    function(member) {

                        return (
                            member.toString() !==
                            myId
                        );
                    }
                );

            if (otherId) {

                io.to(
                    "user:" +
                    otherId.toString()
                ).emit(
                    "messagesSeen",
                    {

                        conversationId,

                        seenAt:
                            now,

                        seenBy:
                            myId
                    }
                );
            }

            res.json({

                success: true,

                seenAt:
                    now
            });

        } catch (error) {

            console.error(
                "READ ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not mark messages as read"
            });
        }

    }
);

/* =========================================
   SEND MESSAGE
========================================= */

app.post(
    "/api/conversations/:conversationId/messages",
    auth,
    async function(req, res) {

        try {

            const conversationId =
                req.params.conversationId;

            const text =
                String(
                    req.body.text ||
                    ""
                ).trim();
          const storyReplyInput = req.body.storyReply || null;

            if (
                !validId(
                    conversationId
                )
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid conversation ID"
                });
            }

            if (!text) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Message cannot be empty"
                });
            }

            if (text.length > 5000) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Message is too long"
                });
            }

            const conversation =
                await conversations.findOne({

                    _id:
                        new ObjectId(
                            conversationId
                        ),

                    members:
                        new ObjectId(
                            req.user.id
                        )
                });

            if (!conversation) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Conversation not found"
                });
            }

            const senderId =
                req.user.id;

            const receiverObjectId =
                conversation.members.find(
                    function(member) {

                        return (
                            member.toString() !==
                            senderId
                        );
                    }
                );

            if (!receiverObjectId) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Receiver not found"
                });
            }

            const receiverId =
                receiverObjectId.toString();

          let storyReply = null;

if (storyReplyInput) {
    const storyId = String(storyReplyInput.storyId || "");

    if (!validId(storyId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid story ID"
        });
    }

    const story = await stories.findOne({
        _id: new ObjectId(storyId),
        expiresAt: { $gt: new Date() }
    });

    if (!story) {
        return res.status(404).json({
            success: false,
            message: "Story not found or expired"
        });
    }

    const ownerId = story.userId.toString();

    if (ownerId === senderId || receiverId !== ownerId) {
        return res.status(403).json({
            success: false,
            message: "Invalid story reply recipient"
        });
    }

    storyReply = {
        storyId: story._id.toString(),
        ownerId,
        mediaUrl: story.mediaUrl,
        mimeType: story.mimeType,
        resourceType: story.resourceType,
        caption: story.caption || ""
    };
}

            const now =
                new Date();

            const receiverOnline =
                isUserOnline(
                    receiverId
                );

            const newMessage = {

                conversationId:
                    new ObjectId(
                        conversationId
                    ),

                senderId:
                    new ObjectId(
                        senderId
                    ),

                text,

              storyReply,

                createdAt:
                    now,

                deliveredAt:
                    receiverOnline
                        ? now
                        : null,

                seenAt:
                    null
            };

            const result =
                await messages.insertOne(
                    newMessage
                );

            const currentUnread =
                Number(
                    conversation
                        .unreadCounts?.[
                            receiverId
                        ] ||
                    0
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

                        lastMessage:
                            text,

                        lastMessageAt:
                            now,

                        updatedAt:
                            now,

                        [`unreadCounts.${receiverId}`]:
                            currentUnread + 1
                    }
                }
            );

            const output = {

                id:
                    result.insertedId.toString(),

                conversationId,

                senderId,

                receiverId,

                text,

              storyReply,

                createdAt:
                    now,

                deliveredAt:
                    receiverOnline
                        ? now
                        : null,

                seenAt:
                    null
            };

            /*
                Send real message.
            */

            io.to(
                "conversation:" +
                conversationId
            ).emit(
                "newMessage",
                output
            );

            /*
                Update receiver home.
            */

            io.to(
                "user:" +
                receiverId
            ).emit(
                "conversationUpdated",
                {
                    conversationId,

                    message:
                        output
                }
            );

            /*
                Delivered event.
            */

            if (receiverOnline) {

                io.to(
                    "user:" +
                    senderId
                ).emit(
                    "messageDelivered",
                    {

                        messageId:
                            output.id,

                        conversationId,

                        deliveredAt:
                            now
                    }
                );
            }

            res.status(201).json({

                success: true,

                message:
                    output
            });

        } catch (error) {

            console.error(
                "SEND MESSAGE ERROR:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Could not send message"
            });
        }

    }
);



/* =========================================
   TELESUPAR - CHAT MESSAGE ACTION APIs
   EDIT / DELETE / REACTION
========================================= */

// EDIT MESSAGE
app.patch(
  "/api/conversations/:conversationId/messages/:messageId",
  auth,
  async function (req, res) {
    try {
      const { conversationId, messageId } = req.params;
      const myId = req.user.id;
      const text = String(req.body.text || "").trim();

      if (!validId(conversationId) || !validId(messageId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid conversation or message ID"
        });
      }

      if (!text || text.length > 4000) {
        return res.status(400).json({
          success: false,
          message: "Message must contain 1-4000 characters"
        });
      }

      const conversation = await conversations.findOne({
        _id: new ObjectId(conversationId),
        members: new ObjectId(myId)
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      const message = await messages.findOne({
        _id: new ObjectId(messageId),
        conversationId: new ObjectId(conversationId),
        senderId: new ObjectId(myId),
        deletedAt: { $exists: false }
      });

      if (!message) {
        return res.status(404).json({
          success: false,
          message: "Message not found or you cannot edit it"
        });
      }

      if (message.attachment) {
        return res.status(400).json({
          success: false,
          message: "Attachment messages cannot be edited"
        });
      }

      const now = new Date();

      await messages.updateOne(
        {
          _id: new ObjectId(messageId),
          conversationId: new ObjectId(conversationId),
          senderId: new ObjectId(myId),
          deletedAt: { $exists: false }
        },
        {
          $set: {
            text,
            editedAt: now
          }
        }
      );

      // Update chat preview only if this was the latest preview.
      await conversations.updateOne(
        {
          _id: new ObjectId(conversationId),
          lastMessage: message.text
        },
        {
          $set: {
            lastMessage: text,
            updatedAt: now
          }
        }
      );

      const output = {
        messageId,
        conversationId,
        text,
        editedAt: now
      };

      io.to("conversation:" + conversationId).emit(
        "messageEdited",
        output
      );

      return res.json({
        success: true,
        message: output
      });

    } catch (error) {
      console.error("EDIT MESSAGE ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not edit message"
      });
    }
  }
);


// DELETE MESSAGE
app.delete(
  "/api/conversations/:conversationId/messages/:messageId",
  auth,
  async function (req, res) {
    try {
      const { conversationId, messageId } = req.params;
      const myId = req.user.id;

      if (!validId(conversationId) || !validId(messageId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid conversation or message ID"
        });
      }

      const conversation = await conversations.findOne({
        _id: new ObjectId(conversationId),
        members: new ObjectId(myId)
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      const message = await messages.findOne({
        _id: new ObjectId(messageId),
        conversationId: new ObjectId(conversationId),
        senderId: new ObjectId(myId),
        deletedAt: { $exists: false }
      });

      if (!message) {
        return res.status(404).json({
          success: false,
          message: "Message not found or you cannot delete it"
        });
      }

      const now = new Date();

      // Soft delete: keep the record, but hide its original content.
      await messages.updateOne(
        {
          _id: new ObjectId(messageId),
          conversationId: new ObjectId(conversationId),
          senderId: new ObjectId(myId),
          deletedAt: { $exists: false }
        },
        {
          $set: {
            text: "",
            attachment: null,
            storyReply: null,
            deletedAt: now,
            reactions: []
          }
        }
      );

      await conversations.updateOne(
        {
          _id: new ObjectId(conversationId),
          lastMessage: message.text
        },
        {
          $set: {
            lastMessage: "Message deleted",
            updatedAt: now
          }
        }
      );

      const output = {
        messageId,
        conversationId,
        deletedAt: now
      };

      io.to("conversation:" + conversationId).emit(
        "messageDeleted",
        output
      );

      return res.json({
        success: true,
        message: output
      });

    } catch (error) {
      console.error("DELETE MESSAGE ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not delete message"
      });
    }
  }
);


// REACT TO MESSAGE
app.post(
  "/api/conversations/:conversationId/messages/:messageId/reactions",
  auth,
  async function (req, res) {
    try {
      const { conversationId, messageId } = req.params;
      const myId = req.user.id;

      const allowedReactions = [
        "❤️",
        "😂",
        "😮",
        "😢",
        "❤️‍🩹",
        "💯",
        "👍",
        "🔥"
      ];

      const emoji = String(req.body.emoji || "");

      if (!validId(conversationId) || !validId(messageId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid conversation or message ID"
        });
      }

      if (!allowedReactions.includes(emoji)) {
        return res.status(400).json({
          success: false,
          message: "Reaction is not allowed"
        });
      }

      const conversation = await conversations.findOne({
        _id: new ObjectId(conversationId),
        members: new ObjectId(myId)
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      const message = await messages.findOne({
        _id: new ObjectId(messageId),
        conversationId: new ObjectId(conversationId),
        deletedAt: { $exists: false }
      });

      if (!message) {
        return res.status(404).json({
          success: false,
          message: "Message not found"
        });
      }

      const reactions = Array.isArray(message.reactions)
        ? message.reactions.map(item => ({
            userId: String(item.userId),
            emoji: String(item.emoji)
          }))
        : [];

      const existingIndex = reactions.findIndex(
        item => item.userId === myId
      );

      let action;

      if (existingIndex !== -1) {
        if (reactions[existingIndex].emoji === emoji) {
          // Tap the same emoji again to remove your reaction.
          reactions.splice(existingIndex, 1);
          action = "removed";
        } else {
          // Change your existing reaction.
          reactions[existingIndex].emoji = emoji;
          action = "updated";
        }
      } else {
        reactions.push({
          userId: myId,
          emoji
        });
        action = "added";
      }

      await messages.updateOne(
        {
          _id: new ObjectId(messageId),
          conversationId: new ObjectId(conversationId),
          deletedAt: { $exists: false }
        },
        {
          $set: {
            reactions
          }
        }
      );

      const output = {
        messageId,
        conversationId,
        reactions,
        action
      };

      io.to("conversation:" + conversationId).emit(
        "messageReactionUpdated",
        output
      );

      return res.json({
        success: true,
        message: output
      });

    } catch (error) {
      console.error("MESSAGE REACTION ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not update reaction"
      });
    }
  }
);



/* =========================================
   TELESUPAR PHOTO / FILE UPLOAD
========================================= */

app.post(
  "/api/conversations/:conversationId/attachments",
  auth,
  upload.single("file"),
  async function(req, res) {
    try {
      const conversationId = req.params.conversationId;
      const senderId = req.user.id;

      if (!validId(conversationId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid conversation ID"
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Please select a file"
        });
      }

      const conversation = await conversations.findOne({
        _id: new ObjectId(conversationId),
        members: new ObjectId(senderId)
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found"
        });
      }

      const receiverObjectId = conversation.members.find(
        member => member.toString() !== senderId
      );

      if (!receiverObjectId) {
        return res.status(400).json({
          success: false,
          message: "Receiver not found"
        });
      }

      const receiverId = receiverObjectId.toString();

      const uploaded = await uploadToCloudinary(req.file);
      const now = new Date();
      const receiverOnline = isUserOnline(receiverId);

      const attachment = {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        resourceType: uploaded.resource_type,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      };

      const newMessage = {
        conversationId: new ObjectId(conversationId),
        senderId: new ObjectId(senderId),
        text: "",
        attachment,
        createdAt: now,
        deliveredAt: receiverOnline ? now : null,
        seenAt: null
      };

      const result = await messages.insertOne(newMessage);

      const lastMessage = req.file.mimetype.startsWith("image/")
        ? "📷 Photo"
        : "📎 " + req.file.originalname;

      const currentUnread = Number(
        conversation.unreadCounts?.[receiverId] || 0
      );

      await conversations.updateOne(
        { _id: new ObjectId(conversationId) },
        {
          $set: {
            lastMessage,
            lastMessageAt: now,
            updatedAt: now,
            [`unreadCounts.${receiverId}`]: currentUnread + 1
          }
        }
      );

      const output = {
        id: result.insertedId.toString(),
        conversationId,
        senderId,
        receiverId,
        text: "",
        attachment,
        createdAt: now,
        deliveredAt: receiverOnline ? now : null,
        seenAt: null
      };

      io.to("conversation:" + conversationId).emit(
        "newMessage",
        output
      );

      io.to("user:" + receiverId).emit(
        "conversationUpdated",
        {
          conversationId,
          message: output
        }
      );

      if (receiverOnline) {
        io.to("user:" + senderId).emit(
          "messageDelivered",
          {
            messageId: output.id,
            conversationId,
            deliveredAt: now
          }
        );
      }

      return res.status(201).json({
        success: true,
        message: output
      });

    } catch (error) {
      console.error("ATTACHMENT UPLOAD ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Attachment upload failed"
      });
    }
  }
);



/* =========================================
   PRIVATE PROFILE CONTENT
   Only shared chat members can access
========================================= */

app.get(
  "/api/users/:userId/private-content",
  auth,
  async function(req, res) {
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
        return res.json({
          success: true,
          media: [],
          files: [],
          links: []
        });
      }

      // Only conversations shared by both users
      const sharedChats = await conversations.find({
        members: {
          $all: [
            new ObjectId(myId),
            new ObjectId(otherId)
          ]
        }
      }).toArray();

      if (!sharedChats.length) {
        return res.json({
          success: true,
          media: [],
          files: [],
          links: []
        });
      }

      const chatIds = sharedChats.map(chat => chat._id);

      const chatMessages = await messages.find({
        conversationId: { $in: chatIds }
      })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

      const media = [];
      const files = [];
      const links = [];

      for (const message of chatMessages) {
        const attachment = message.attachment;

        if (attachment && attachment.url) {
          const mime = String(
            attachment.mimeType || ""
          ).toLowerCase();

          const item = {
            url: attachment.url,
            fileName: attachment.fileName || "Attachment",
            mimeType: mime,
            createdAt: message.createdAt,
            senderId: message.senderId.toString()
          };

          if (
            mime.startsWith("image/") ||
            mime.startsWith("video/")
          ) {
            media.push(item);
          } else {
            files.push(item);
          }
        }

        const text = String(message.text || "");
        const foundLinks = text.match(
          /https?:\/\/[^\s<>"']+/gi
        ) || [];

        for (const url of foundLinks) {
          links.push({
            url,
            createdAt: message.createdAt,
            senderId: message.senderId.toString()
          });
        }
      }

      return res.json({
        success: true,
        media,
        files,
        links
      });

    } catch (error) {
      console.error(
        "PRIVATE PROFILE CONTENT ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Could not load private content"
      });
    }
  }
);


/* =========================================
   TELESUPAR CHANNELS API
   Official Channel + Secure Join/Create
========================================= */

const OFFICIAL_CHANNEL_KEY = "TELESUPAR_OFFICIAL";

/* ---------- ADMIN CHECK ---------- */

function isRoomAdmin(room, userId) {
  const uid = String(userId || "");

  if (!uid) return false;
  if (String(room.ownerId || "") === uid) return true;

  const admins = Array.isArray(room.admins)
    ? room.admins.map(String)
    : [];

  return admins.includes(uid);
}

/* ---------- OFFICIAL CHANNEL ---------- */

async function ensureOfficialChannel() {
  const username = String(
    process.env.TELESUPAR_CHANNEL_OWNER_USERNAME || ""
  ).trim().replace(/^@/, "");

  if (!username) {
    throw new Error("Official channel owner is not configured");
  }

  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const owner = await users.findOne({
    username: {
      $regex: `^@?${escaped}$`,
      $options: "i"
    }
  });

  if (!owner) {
    throw new Error(
      `Official owner @${username} was not found in database`
    );
  }

  const ownerId = owner._id.toString();

  let official = await groups.findOne({
    $or: [
      { systemKey: OFFICIAL_CHANNEL_KEY },
      { isOfficial: true }
    ]
  });

  const now = new Date();

  if (!official) {
    const doc = {
      systemKey: OFFICIAL_CHANNEL_KEY,
      isOfficial: true,
      name: "TELESUPAR OFFICIAL",
      type: "channel",
      description: "Official TELESUPAR announcements and updates",
      logo: "",
      isPrivate: false,
      ownerId,
      admins: [ownerId],
      members: [ownerId],
      allowMemberMessages: false,
      posts: [],
      createdAt: now,
      updatedAt: now
    };

    const result = await groups.insertOne(doc);

    doc._id = result.insertedId;
    official = doc;
  } else {
    await groups.updateOne(
      { _id: official._id },
      {
        $set: {
          systemKey: OFFICIAL_CHANNEL_KEY,
          isOfficial: true,
          name: "TELESUPAR OFFICIAL",
          type: "channel",
          ownerId,
          allowMemberMessages: false,
          updatedAt: now
        },
        $addToSet: {
          admins: ownerId,
          members: ownerId
        }
      }
    );

    official = await groups.findOne({
      _id: official._id
    });
  }

  return official;
}

/* ---------- MEMBERSHIP ---------- */

function hasJoinedOfficialChannel(userId, official) {
  const uid = String(userId || "");

  return (
    String(official?.ownerId || "") === uid ||
    (Array.isArray(official?.admins) &&
      official.admins.map(String).includes(uid)) ||
    (Array.isArray(official?.members) &&
      official.members.map(String).includes(uid))
  );
}

function isChannelMember(room, userId) {
  const uid = String(userId || "");

  return (
    isRoomAdmin(room, uid) ||
    (Array.isArray(room.members) &&
      room.members.map(String).includes(uid))
  );
}

async function canAccessChannel(room, userId) {
  const isOfficial =
    room.isOfficial === true ||
    room.systemKey === OFFICIAL_CHANNEL_KEY;

  if (isOfficial) return true;

  const official = await ensureOfficialChannel();

  return hasJoinedOfficialChannel(userId, official);
}

/* ---------- SERIALIZE CHANNEL ---------- */

function serializeRoom(room, myId) {
  const uid = String(myId || "");
  const ownerId = String(room.ownerId || "");

  const admins = Array.isArray(room.admins)
    ? room.admins.map(String)
    : [ownerId].filter(Boolean);

  const members = Array.isArray(room.members)
    ? room.members.map(String)
    : [];

  const isOwner = ownerId === uid;
  const isAdmin = isRoomAdmin(room, uid);
  const isMember = members.includes(uid) || isAdmin;

  const isOfficial =
    room.isOfficial === true ||
    room.systemKey === OFFICIAL_CHANNEL_KEY;

  const canViewPosts =
    isOfficial || isMember;

  const posts = canViewPosts && Array.isArray(room.posts)
    ? room.posts.map(post => {
        const likesUsers = Array.isArray(post.likesUsers)
          ? post.likesUsers.map(String)
          : [];

        const fireUsers = Array.isArray(post.fireUsers)
          ? post.fireUsers.map(String)
          : [];

        return {
          id: String(post.id),
          text: post.text || "",
          image: post.image || "",
          video: post.video || "",
          mediaType: post.mediaType || "",
          authorName: post.authorName || "Admin",
          authorId: String(post.authorId || ""),
          views: Number(post.views) || 0,
          likes: likesUsers.length,
          fire: fireUsers.length,
          likedByMe: likesUsers.includes(uid),
          firedByMe: fireUsers.includes(uid),
          reactions: post.reactions || {},
          myReaction: (
          Array.isArray(post.reactionUsers)
          ? post.reactionUsers.find(
          item => String(item.userId) === uid
          )?.reaction || ""
          : ""
           ),
          silent: Boolean(post.silent),
          poll: post.poll ? {
            question: post.poll.question || "",
            options: Array.isArray(post.poll.options) ? post.poll.options : [],
            myVote: (Array.isArray(post.poll.voters)
              ? (post.poll.voters.find(v => String(v.userId) === uid)?.optionIndex ?? "")
              : (post.poll.myVote ?? ""))
          } : null,
          time: post.time || "",
          createdAt: post.createdAt || null
        };
      })
    : [];

  return {
    id: room._id.toString(),
    type: "channel",
    name: room.name || "Untitled Channel",
    description: room.description || "",
    logo: room.logo || "",
    isPrivate: Boolean(room.isPrivate),
    isOfficial,
    systemKey: isOfficial ? OFFICIAL_CHANNEL_KEY : "",
    ownerId,
    admins,
    members,
    memberCount: members.length,
    isOwner,
    isAdmin,
    isMember,
    canPost: isAdmin,
    posts,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  };
}


/* ---------- CHANNEL MEMBER PROFILES ---------- */

async function getChannelMemberProfiles(room) {
  const ids = [
    ...new Set([
      ...(Array.isArray(room.members) ? room.members : []),
      ...(Array.isArray(room.admins) ? room.admins : []),
      room.ownerId
    ].filter(Boolean).map(String))
  ];

  const validIds = ids.filter(id => validId(id));

  if (!validIds.length) return [];

  const objectIds = validIds.map(id => new ObjectId(id));

  const userDocs = await users.find(
    { _id: { $in: objectIds } },
    {
      projection: {
        username: 1,
        displayName: 1,
        name: 1,
        avatar: 1,
        profilePic: 1,
        photo: 1
      }
    }
  ).toArray();

  const userMap = new Map(
    userDocs.map(user => [String(user._id), user])
  );

  return ids.map(id => {
    const user = userMap.get(id);
    if (!user) return null;

    const isOwner = String(room.ownerId || "") === id;
    const isAdmin = isOwner ||
      (Array.isArray(room.admins) &&
       room.admins.map(String).includes(id));

    return {
      id,
      username: user.username || "",
      name: user.displayName || user.name || user.username || "User",
      displayName: user.displayName || user.name || user.username || "User",
      avatar: user.avatar || user.profilePic || user.photo || "",
      role: isOwner ? "Creator" : (isAdmin ? "Admin" : "Member")
    };
  }).filter(Boolean);
}

/* ---------- GET CHANNEL SUBSCRIBERS ---------- */

app.get("/api/groups/:groupId/members", auth, async function (req, res) {
  try {
    const { groupId } = req.params;
    const myId = String(req.user.id);

    if (!validId(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid channel ID"
      });
    }

    const room = await groups.findOne({
      _id: new ObjectId(groupId),
      type: "channel"
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Channel not found"
      });
    }

    if (!isRoomAdmin(room, myId)) {
      return res.status(403).json({
        success: false,
        message: "Only channel admins can view subscribers"
      });
    }

    const members = await getChannelMemberProfiles(room);

    return res.json({
      success: true,
      members,
      admins: members.filter(member =>
        member.role === "Admin" || member.role === "Creator"
      )
    });

  } catch (error) {
    console.error("CHANNEL MEMBERS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load channel subscribers"
    });
  }
});


/* ---------- GET CHANNELS ---------- */

app.get("/api/groups", auth, async function (req, res) {
  try {
    const myId = String(req.user.id);

    await ensureOfficialChannel();

    const list = await groups
      .find({ type: "channel" })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(100)
      .toArray();

    return res.json({
      success: true,
      groups: list.map(room => serializeRoom(room, myId))
    });

  } catch (error) {
    console.error("GET CHANNELS ERROR:", error);

    return res.status(503).json({
      success: false,
      message: "TELESUPAR OFFICIAL channel unavailable. Check owner account configuration."
    });
  }
});

/* ---------- CREATE CHANNEL ---------- */

app.post("/api/groups", auth, async function (req, res) {
  try {
    const myId = String(req.user.id);

    const name = String(req.body.name || "")
      .trim()
      .slice(0, 80);

    const description = String(req.body.description || "")
      .trim()
      .slice(0, 500);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Channel name is required"
      });
    }

    const official = await ensureOfficialChannel();

    if (!hasJoinedOfficialChannel(myId, official)) {
      return res.status(403).json({
        success: false,
        message: "Join TELESUPAR OFFICIAL before creating another channel"
      });
    }

    const now = new Date();

    const doc = {
      name,
      description,
      type: "channel",
      isOfficial: false,
      ownerId: myId,
      admins: [myId],
      members: [myId],
      logo: String(req.body.logo || "").slice(0, 2000),
      isPrivate: Boolean(req.body.isPrivate),
      allowMemberMessages: false,
      posts: [],
      createdAt: now,
      updatedAt: now
    };

    const result = await groups.insertOne(doc);

    doc._id = result.insertedId;

    return res.status(201).json({
      success: true,
      group: serializeRoom(doc, myId)
    });

  } catch (error) {
    console.error("CREATE CHANNEL ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not create channel"
    });
  }
});

/* ---------- JOIN CHANNEL ---------- */

app.post("/api/groups/:groupId/join", auth, async function (req, res) {
  try {
    const groupId = req.params.groupId;
    const myId = String(req.user.id);

    if (!validId(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid channel ID"
      });
    }

    const target = await groups.findOne({
      _id: new ObjectId(groupId),
      type: "channel"
    });

    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Channel not found"
      });
    }

    const isOfficial =
      target.isOfficial === true ||
      target.systemKey === OFFICIAL_CHANNEL_KEY;

    if (!isOfficial) {
      const official = await ensureOfficialChannel();

      if (!hasJoinedOfficialChannel(myId, official)) {
        return res.status(403).json({
          success: false,
          message: "Join TELESUPAR OFFICIAL before joining another channel"
        });
      }
    }

    await groups.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $addToSet: { members: myId },
        $set: { updatedAt: new Date() }
      }
    );

    const updated = await groups.findOne({
      _id: new ObjectId(groupId)
    });

    return res.json({
      success: true,
      group: serializeRoom(updated, myId)
    });

  } catch (error) {
    console.error("JOIN CHANNEL ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not join channel"
    });
  }
});


/* ---------- LEAVE CHANNEL ---------- */

app.delete("/api/groups/:groupId/leave", auth, async function (req, res) {
  try {
    const { groupId } = req.params;
    const myId = String(req.user.id);

    if (!validId(groupId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid channel ID"
      });
    }

    const room = await groups.findOne({
      _id: new ObjectId(groupId),
      type: "channel"
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Channel not found"
      });
    }

    const isOfficial =
      room.isOfficial === true ||
      room.systemKey === OFFICIAL_CHANNEL_KEY;

    if (isOfficial && String(room.ownerId) === myId) {
      return res.status(403).json({
        success: false,
        message: "Official channel owner cannot leave"
      });
    }

    if (String(room.ownerId || "") === myId) {
      return res.status(403).json({
        success: false,
        message: "Channel owner must transfer ownership or delete the channel"
      });
    }

    await groups.updateOne(
      { _id: new ObjectId(groupId) },
      {
        $pull: {
          members: myId,
          admins: myId
        },
        $set: {
          updatedAt: new Date()
        }
      }
    );

    const updated = await groups.findOne({
      _id: new ObjectId(groupId)
    });

    return res.json({
      success: true,
      group: serializeRoom(updated, myId),
      message: "You left the channel"
    });

  } catch (error) {
    console.error("LEAVE CHANNEL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Could not leave channel"
    });
  }
});


/* ---------- PUBLISH CHANNEL POST ---------- */

app.post(
  "/api/groups/:groupId/posts",
  auth,
  upload.single("file"),
  async function (req, res) {
    try {
      const groupId = req.params.groupId;
      const myId = String(req.user.id);

      if (!validId(groupId)) {
        return res.status(400).json({ success: false, message: "Invalid channel ID" });
      }

      const room = await groups.findOne({
        _id: new ObjectId(groupId),
        type: "channel"
      });

      if (!room) {
        return res.status(404).json({ success: false, message: "Channel not found" });
      }

      if (!await canAccessChannel(room, myId)) {
        return res.status(403).json({ success: false, message: "Join TELESUPAR OFFICIAL first" });
      }

      if (!isRoomAdmin(room, myId)) {
        return res.status(403).json({ success: false, message: "Only channel owner or admins can publish" });
      }

      const text = String(req.body?.text || "").trim().slice(0, 2000);
      let image = "";
      let video = "";
      let mediaType = "";

      if (req.file) {
        if (!req.file.mimetype.startsWith("image/") && !req.file.mimetype.startsWith("video/")) {
          return res.status(400).json({ success: false, message: "Only image or video can be posted in a channel" });
        }
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
          return res.status(503).json({ success: false, message: "Media storage is not configured on server" });
        }
        const uploaded = await uploadToCloudinary(req.file);
        if (req.file.mimetype.startsWith("image/")) {
          image = uploaded.secure_url;
          mediaType = "image";
        } else if (req.file.mimetype.startsWith("video/")) {
          video = uploaded.secure_url;
          mediaType = "video";
        } else {
          return res.status(400).json({ success: false, message: "Only image or video can be posted in a channel" });
        }
      }

      let poll = null;
      if (req.body?.poll) {
        try {
          poll = typeof req.body.poll === "string" ? JSON.parse(req.body.poll) : req.body.poll;
        } catch (_) {
          return res.status(400).json({ success: false, message: "Invalid poll data" });
        }
      }

      if (poll) {
        const question = String(poll.question || "").trim().slice(0, 240);
        const labels = Array.isArray(poll.options)
          ? poll.options.map(option => String(typeof option === "string" ? option : option.label || "").trim()).filter(Boolean).slice(0, 8)
          : [];
        if (!question || labels.length < 2) {
          return res.status(400).json({ success: false, message: "Poll needs a question and at least two options" });
        }
        poll = {
          question,
          options: labels.map(label => ({ label, votes: 0 })),
          voters: []
        };
      }

      if (!text && !image && !video && !poll) {
        return res.status(400).json({ success: false, message: "Post cannot be empty" });
      }

      const actor = await users.findOne({ _id: new ObjectId(myId) });
      const now = new Date();
      const post = {
        id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        text,
        image,
        video,
        mediaType,
        poll,
        authorName: actor?.displayName || actor?.username || req.user.username || "Admin",
        authorId: myId,
        views: 0,
        viewers: [],
        likesUsers: [],
        fireUsers: [],
        reactions: {},
        silent: String(req.body?.silent || "false") === "true",
        time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        createdAt: now
      };

      await groups.updateOne(
        { _id: new ObjectId(groupId) },
        { $push: { posts: post }, $set: { updatedAt: now } }
      );

      const updated = await groups.findOne({ _id: new ObjectId(groupId) });
      return res.status(201).json({ success: true, group: serializeRoom(updated, myId) });
    } catch (error) {
      console.error("CHANNEL POST ERROR:", error);
      return res.status(500).json({ success: false, message: "Could not publish channel post" });
    }
  }
);

/* ---------- RECORD UNIQUE POST VIEW ---------- */
app.post("/api/groups/:groupId/posts/:postId/view", auth, async function (req, res) {
  try {
    const { groupId, postId } = req.params;
    const myId = String(req.user.id);
    if (!validId(groupId)) return res.status(400).json({ success: false, message: "Invalid channel ID" });

    const room = await groups.findOne({ _id: new ObjectId(groupId), type: "channel" });
    if (!room) return res.status(404).json({ success: false, message: "Channel not found" });
    if (!await canAccessChannel(room, myId)) return res.status(403).json({ success: false, message: "Join TELESUPAR OFFICIAL first" });
    if (!isChannelMember(room, myId)) return res.status(403).json({ success: false, message: "Join this channel first" });

    const post = (room.posts || []).find(item => String(item.id) === String(postId));
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    if (String(post.authorId || "") !== myId) {
      // Older posts did not store unique viewers; reset their unverified legacy count once.
      if (!Array.isArray(post.viewers)) {
        await groups.updateOne(
          { _id: new ObjectId(groupId), posts: { $elemMatch: { id: String(postId), viewers: { $exists: false } } } },
          { $set: { "posts.$.viewers": [], "posts.$.views": 0 } }
        );
      }
      await groups.updateOne(
        {
          _id: new ObjectId(groupId),
          posts: { $elemMatch: { id: String(postId), viewers: { $ne: myId } } }
        },
        {
          $addToSet: { "posts.$.viewers": myId },
          $inc: { "posts.$.views": 1 }
        }
      );
    }

    const updated = await groups.findOne({ _id: new ObjectId(groupId) });
    return res.json({ success: true, group: serializeRoom(updated, myId) });
  } catch (error) {
    console.error("CHANNEL VIEW ERROR:", error);
    return res.status(500).json({ success: false, message: "Could not record post view" });
  }
});

/* ---------- PERSIST POLL VOTE ---------- */
app.post("/api/groups/:groupId/posts/:postId/vote", auth, async function (req, res) {
  try {
    const { groupId, postId } = req.params;
    const myId = String(req.user.id);
    const optionIndex = Number(req.body?.optionIndex);
    if (!validId(groupId) || !Number.isInteger(optionIndex) || optionIndex < 0) {
      return res.status(400).json({ success: false, message: "Invalid poll vote" });
    }

    const room = await groups.findOne({ _id: new ObjectId(groupId), type: "channel" });
    if (!room) return res.status(404).json({ success: false, message: "Channel not found" });
    if (!await canAccessChannel(room, myId) || !isChannelMember(room, myId)) {
      return res.status(403).json({ success: false, message: "Join this channel first" });
    }

    const postIndex = (room.posts || []).findIndex(item => String(item.id) === String(postId));
    if (postIndex < 0 || !room.posts[postIndex].poll) {
      return res.status(404).json({ success: false, message: "Poll not found" });
    }

    const posts = room.posts;
    const poll = posts[postIndex].poll;
    if (!Array.isArray(poll.options) || optionIndex >= poll.options.length) {
      return res.status(400).json({ success: false, message: "Poll option not found" });
    }

    const voters = Array.isArray(poll.voters) ? poll.voters : [];
    const oldVote = voters.find(vote => String(vote.userId) === myId);
    if (oldVote && Number(oldVote.optionIndex) === optionIndex) {
      poll.voters = voters.filter(vote => String(vote.userId) !== myId);
    } else {
      poll.voters = voters.filter(vote => String(vote.userId) !== myId);
      poll.voters.push({ userId: myId, optionIndex });
    }

    poll.options = poll.options.map((option, idx) => ({
      ...option,
      votes: poll.voters.filter(vote => Number(vote.optionIndex) === idx).length
    }));

    posts[postIndex] = { ...posts[postIndex], poll };
    await groups.updateOne(
      { _id: new ObjectId(groupId) },
      { $set: { posts, updatedAt: new Date() } }
    );

    const updated = await groups.findOne({ _id: new ObjectId(groupId) });
    return res.json({ success: true, group: serializeRoom(updated, myId) });
  } catch (error) {
    console.error("CHANNEL POLL VOTE ERROR:", error);
    return res.status(500).json({ success: false, message: "Could not save poll vote" });
  }
});

/* ---------- DELETE CHANNEL POST ---------- */
app.delete("/api/groups/:groupId/posts/:postId", auth, async function (req, res) {
  try {
    const { groupId, postId } = req.params;
    const myId = String(req.user.id);
    if (!validId(groupId)) return res.status(400).json({ success: false, message: "Invalid channel ID" });

    const room = await groups.findOne({ _id: new ObjectId(groupId), type: "channel" });
    if (!room) return res.status(404).json({ success: false, message: "Channel not found" });
    if (!isRoomAdmin(room, myId)) return res.status(403).json({ success: false, message: "Only channel owner/admin can delete broadcasts" });
    if (!(room.posts || []).some(post => String(post.id) === String(postId))) {
      return res.status(404).json({ success: false, message: "Broadcast not found" });
    }

    await groups.updateOne(
      { _id: new ObjectId(groupId) },
      { $pull: { posts: { id: String(postId) } }, $set: { updatedAt: new Date() } }
    );
    const updated = await groups.findOne({ _id: new ObjectId(groupId) });
    return res.json({ success: true, group: serializeRoom(updated, myId) });
  } catch (error) {
    console.error("DELETE CHANNEL POST ERROR:", error);
    return res.status(500).json({ success: false, message: "Could not delete broadcast" });
  }
});

/* ---------- UPLOAD CHANNEL LOGO ---------- */
app.post("/api/groups/:groupId/logo", auth, upload.single("file"), async function (req, res) {
  try {
    const { groupId } = req.params;
    const myId = String(req.user.id);
    if (!validId(groupId)) return res.status(400).json({ success: false, message: "Invalid channel ID" });
    if (!req.file || !req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ success: false, message: "Please select an image" });
    }
    const room = await groups.findOne({ _id: new ObjectId(groupId), type: "channel" });
    if (!room) return res.status(404).json({ success: false, message: "Channel not found" });
    if (!isRoomAdmin(room, myId)) return res.status(403).json({ success: false, message: "Only channel owner/admin can change logo" });
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(503).json({ success: false, message: "Media storage is not configured on server" });
    }
    const uploaded = await uploadToCloudinary(req.file);
    await groups.updateOne({ _id: new ObjectId(groupId) }, { $set: { logo: uploaded.secure_url, updatedAt: new Date() } });
    const updated = await groups.findOne({ _id: new ObjectId(groupId) });
    return res.json({ success: true, group: serializeRoom(updated, myId) });
  } catch (error) {
    console.error("CHANNEL LOGO UPLOAD ERROR:", error);
    return res.status(500).json({ success: false, message: "Could not upload channel logo" });
  }
});

/* ---------- UPDATE CHANNEL SETTINGS ---------- */
app.patch("/api/groups/:groupId/settings", auth, async function (req, res) {
  try {
    const { groupId } = req.params;
    const myId = String(req.user.id);
    if (!validId(groupId)) return res.status(400).json({ success: false, message: "Invalid channel ID" });
    const room = await groups.findOne({ _id: new ObjectId(groupId), type: "channel" });
    if (!room) return res.status(404).json({ success: false, message: "Channel not found" });
    if (!isRoomAdmin(room, myId)) return res.status(403).json({ success: false, message: "Only channel owner/admin can edit settings" });

    const set = { updatedAt: new Date() };
    if (typeof req.body.name === "string") set.name = req.body.name.trim().slice(0, 80);
    if (typeof req.body.description === "string") set.description = req.body.description.trim().slice(0, 500);
    if (typeof req.body.isPrivate === "boolean") set.isPrivate = req.body.isPrivate;
    if (typeof req.body.logo === "string" && !req.body.logo.startsWith("data:")) set.logo = req.body.logo.slice(0, 2000);
    if (!set.name && typeof req.body.name === "string") return res.status(400).json({ success: false, message: "Channel name is required" });

    await groups.updateOne({ _id: new ObjectId(groupId) }, { $set: set });
    const updated = await groups.findOne({ _id: new ObjectId(groupId) });
    return res.json({ success: true, group: serializeRoom(updated, myId) });
  } catch (error) {
    console.error("CHANNEL SETTINGS ERROR:", error);
    return res.status(500).json({ success: false, message: "Could not update channel settings" });
  }
});

/* ---------- DELETE CHANNEL ---------- */
app.delete("/api/groups/:groupId", auth, async function (req, res) {
  try {
    const { groupId } = req.params;
    const myId = String(req.user.id);
    if (!validId(groupId)) return res.status(400).json({ success: false, message: "Invalid channel ID" });

    const room = await groups.findOne({ _id: new ObjectId(groupId), type: "channel" });
    if (!room) return res.status(404).json({ success: false, message: "Channel not found" });
    if (room.isOfficial === true || room.systemKey === OFFICIAL_CHANNEL_KEY) {
      return res.status(403).json({ success: false, message: "TELESUPAR OFFICIAL cannot be deleted" });
    }
    if (String(room.ownerId || "") !== myId) {
      return res.status(403).json({ success: false, message: "Only the channel owner can delete this channel" });
    }

    await groups.deleteOne({ _id: new ObjectId(groupId) });
    return res.json({ success: true, message: "Channel deleted" });
  } catch (error) {
    console.error("DELETE CHANNEL ERROR:", error);
    return res.status(500).json({ success: false, message: "Could not delete channel" });
  }
});


/* ---------- PERSIST CHANNEL REACTIONS ---------- */

app.post(
  "/api/groups/:groupId/posts/:postId/react",
  auth,
  async function (req, res) {
    try {
      const { groupId, postId } = req.params;
      const myId = String(req.user.id);
      const reaction = String(req.body?.reaction || "").trim();

      const allowed = ["❤️", "👍", "👎", "🔥", "🥰", "👏", "❤️‍🩹", "👀", "💯", "😁"];

      if (!validId(groupId) || !allowed.includes(reaction)) {
        return res.status(400).json({
          success: false,
          message: "Invalid reaction"
        });
      }

      const room = await groups.findOne({
        _id: new ObjectId(groupId),
        type: "channel"
      });

      if (!room) {
        return res.status(404).json({
          success: false,
          message: "Channel not found"
        });
      }

      if (!await canAccessChannel(room, myId) ||
          !isChannelMember(room, myId)) {
        return res.status(403).json({
          success: false,
          message: "Join this channel first"
        });
      }

      const posts = Array.isArray(room.posts) ? room.posts : [];
      const postIndex = posts.findIndex(
        post => String(post.id) === String(postId)
      );

      if (postIndex < 0) {
        return res.status(404).json({
          success: false,
          message: "Post not found"
        });
      }

      const post = { ...posts[postIndex] };
      const reactionUsers = Array.isArray(post.reactionUsers)
        ? post.reactionUsers
        : [];

      const previous = reactionUsers.find(
        item => String(item.userId) === myId
      );

      let nextUsers = reactionUsers.filter(
        item => String(item.userId) !== myId
      );

      const removing = previous && previous.reaction === reaction;

      if (!removing) {
        nextUsers.push({
          userId: myId,
          reaction
        });
      }

      const counts = {};
      nextUsers.forEach(item => {
        counts[item.reaction] = (counts[item.reaction] || 0) + 1;
      });

      post.reactionUsers = nextUsers;
      post.reactions = counts;
      post.myReaction = removing ? "" : reaction;

      posts[postIndex] = post;

      await groups.updateOne(
        { _id: new ObjectId(groupId) },
        {
          $set: {
            posts,
            updatedAt: new Date()
          }
        }
      );

      const updated = await groups.findOne({
        _id: new ObjectId(groupId)
      });

      return res.json({
        success: true,
        group: serializeRoom(updated, myId)
      });

    } catch (error) {
      console.error("CHANNEL REACTION ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "Could not save reaction"
      });
    }
  }
);




/* =========================================
   SOCKET.IO
========================================= */

io.on(
    "connection",
    function(socket) {

        console.log(
            "Socket connected:",
            socket.id
        );

        /* =================================
           AUTHENTICATE
        ================================= */

        socket.on(
            "authenticate",
            async function(token) {

                try {

                    const decoded =
                        jwt.verify(
                            token,
                            JWT_SECRET
                        );

                    socket.user =
                        decoded;

                    const userId =
                        decoded.id;

                    /*
                        Prevent duplicate
                        authentication on
                        same socket.
                    */

                    if (
                        socket.authenticated
                    ) {
                        return;
                    }

                    socket.authenticated =
                        true;

                    const becameOnline =
                        addOnlineSocket(
                            userId,
                            socket.id
                        );

                    socket.join(
                        "user:" +
                        userId
                    );

                    /*
                        Update last online
                        information.
                    */

                    await users.updateOne(

                        {
                            _id:
                                new ObjectId(
                                    userId
                                )
                        },

                        {
                            $set: {
                                lastSeen:
                                    null
                            }
                        }
                    );

                    /*
                        Only broadcast online
                        when first connection
                        appears.
                    */

                    if (becameOnline) {

                        broadcastUserOnline(
                            userId
                        );
                    }

                    socket.emit(
                        "presence",
                        {

                            userId,

                            online:
                                true,

                            lastSeen:
                                null
                        }
                    );

                } catch (error) {

                    console.error(
                        "SOCKET AUTH ERROR:",
                        error
                    );

                    socket.emit(
                        "authError",
                        "Invalid token"
                    );

                    socket.disconnect(
                        true
                    );
                }

            }
        );

        /* =================================
           JOIN CONVERSATION
        ================================= */

        socket.on(
            "joinConversation",
            async function(
                conversationId
            ) {

                try {

                    if (
                        !socket.user ||
                        !socket.authenticated ||
                        !validId(
                            conversationId
                        )
                    ) {
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

                    socket.join(
                        "conversation:" +
                        conversationId
                    );

                    /*
                        Opening a chat means
                        incoming messages are seen.
                    */

                    const now =
                        new Date();

                    await messages.updateMany(

                        {
                            conversationId:
                                new ObjectId(
                                    conversationId
                                ),

                            senderId: {
                                $ne:
                                    new ObjectId(
                                        socket.user.id
                                    )
                            },

                            $or: [

                                {
                                    seenAt:
                                        null
                                },

                                {
                                    seenAt: {
                                        $exists:
                                            false
                                    }
                                }
                            ]
                        },

                        {
                            $set: {
                                seenAt:
                                    now
                            }
                        }
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

                                [`unreadCounts.${socket.user.id}`]:
                                    0
                            }
                        }
                    );

                    const otherId =
                        conversation.members.find(
                            function(member) {

                                return (
                                    member.toString() !==
                                    socket.user.id
                                );
                            }
                        );

                    if (otherId) {

                        io.to(
                            "user:" +
                            otherId.toString()
                        ).emit(
                            "messagesSeen",
                            {

                                conversationId,

                                seenAt:
                                    now,

                                seenBy:
                                    socket.user.id
                            }
                        );
                    }

                } catch (error) {

                    console.error(
                        "JOIN CHAT ERROR:",
                        error
                    );
                }

            }
        );

        /* =================================
           LEAVE
        ================================= */

        socket.on(
            "leaveConversation",
            function(
                conversationId
            ) {

                if (
                    validId(
                        conversationId
                    )
                ) {

                    socket.leave(
                        "conversation:" +
                        conversationId
                    );
                }

            }
        );

        /* =================================
           TYPING
        ================================= */

        socket.on(
            "typing",
            async function(data) {

                try {

                    if (
                        !socket.user ||
                        !socket.authenticated ||
                        !data ||
                        !validId(
                            data.conversationId
                        )
                    ) {
                        return;
                    }

                    const conversation =
                        await conversations.findOne({

                            _id:
                                new ObjectId(
                                    data.conversationId
                                ),

                            members:
                                new ObjectId(
                                    socket.user.id
                                )
                        });

                    if (!conversation) {
                        return;
                    }

                    const otherId =
                        conversation.members.find(
                            function(member) {

                                return (
                                    member.toString() !==
                                    socket.user.id
                                );
                            }
                        );

                    if (!otherId) {
                        return;
                    }

                    io.to(
                        "user:" +
                        otherId.toString()
                    ).emit(
                        "typing",
                        {

                            conversationId:
                                data.conversationId,

                            userId:
                                socket.user.id,

                            isTyping:
                                data.isTyping === true
                        }
                    );

                } catch (error) {

                    console.error(
                        "TYPING ERROR:",
                        error
                    );
                }

            }
        );

        /* =================================
           DISCONNECT
        ================================= */

        socket.on(
            "disconnect",
            async function(
                reason
            ) {

                if (
                    socket.user &&
                    socket.user.id &&
                    socket.authenticated
                ) {

                    const userId =
                        socket.user.id;

                    const becameOffline =
                        removeOnlineSocket(
                            userId,
                            socket.id
                        );

                    /*
                        Only mark offline when
                        the LAST socket closes.
                    */

                    if (becameOffline) {

                        await broadcastUserOffline(
                            userId
                        );
                    }
                }

                console.log(
                    "Socket disconnected:",
                    socket.id,
                    reason
                );
            }
        );

    }
);


// DELETE READ NOTIFICATIONS AFTER 48 HOURS
async function cleanupReadNotifications() {
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const result = await notifications.deleteMany({
      read: true,
      readAt: { $lte: cutoff }
    });

    if (result.deletedCount > 0) {
      console.log(
        `Deleted ${result.deletedCount} old read notifications`
      );
    }
  } catch (error) {
    console.error("NOTIFICATION CLEANUP ERROR:", error);
  }
}

// Run cleanup every hour
setInterval(cleanupReadNotifications, 60 * 60 * 1000);

// Also run once after server starts
cleanupReadNotifications();

/* =========================================
   START SERVER
========================================= */

connectDatabase()
    .then(
        function() {

            server.listen(
                PORT,
                "0.0.0.0",
                function() {

                    console.log(
                        "TELESUPAR server running on port " +
                        PORT
                    );

                }
            );

        }
    )
    .catch(
        function(error) {

            console.error(
                "MongoDB connection failed:",
                error
            );

            process.exit(1);
        }
    );
