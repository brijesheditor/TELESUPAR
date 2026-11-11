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

    const result = allPosts.map(post => ({
      id: post._id.toString(),
      caption: post.caption || "",
      mediaUrl: post.mediaUrl,
      mediaType: post.mediaType,
      createdAt: post.createdAt,
      likesCount: (post.likes || []).length,

      // REAL COMMENT COUNT
      commentsCount:
        commentCountMap.get(post._id.toString()) || 0,

      likedByMe: (post.likes || []).some(
        id => id.toString() === req.user.id
      ),

      user: authorMap.get(post.userId.toString()) || null
    })).filter(post => post.user);

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

// 2. GET COMMENTS
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

      const allComments = await comments.find({
        postId: postObjectId
      })
        .sort({ createdAt: 1 })
        .limit(100)
        .toArray();

      const userIds = [
        ...new Set(
          allComments.map(c => c.userId.toString())
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

      const result = allComments.map(c => ({
        id: c._id.toString(),
        text: c.text,
        createdAt: c.createdAt,
        user: authorMap.get(c.userId.toString()) || null,
        isMine: c.userId.toString() === req.user.id
      }));

      res.json({
        success: true,
        comments: result,
        count: result.length
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

// 3. DELETE MY COMMENT
app.delete(
  "/api/posts/:postId/comments/:commentId",
  auth,
  async (req, res) => {
    try {
      const { postId, commentId } = req.params;
      const userObjectId = new ObjectId(req.user.id);

      if (!validId(postId) || !validId(commentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid ID"
        });
      }

      const postObjectId = new ObjectId(postId);
      const commentObjectId = new ObjectId(commentId);

      const result = await comments.deleteOne({
        _id: commentObjectId,
        postId: postObjectId,
        userId: userObjectId
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Comment not found or not yours"
        });
      }

      // Remove related notification, if any
      await notifications.deleteOne({
        actorId: userObjectId,
        postId: postObjectId,
        commentId: commentObjectId,
        type: "post_comment"
      });

      res.json({
        success: true,
        message: "Comment deleted"
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

    const [actors, relatedPosts, relatedStories, unreadCount] =
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
        : null
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

                query.$or = [

                    {
                        username: {
                            $regex:
                                search,
                            $options:
                                "i"
                        }
                    },

                    {
                        displayName: {
                            $regex:
                                search,
                            $options:
                                "i"
                        }
                    }
                ];
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
                                message.text ||
                                "",
                          storyReply:
    message.storyReply || null,
                          
                          attachment:
                               message.attachment ||
                               null,

                            createdAt:
                                message.createdAt,

                            deliveredAt:
                                message.deliveredAt ||
                                null,

                            seenAt:
                                message.seenAt ||
                                null
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
