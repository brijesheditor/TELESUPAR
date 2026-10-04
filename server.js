const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

/* =========================================
   MIDDLEWARE
========================================= */

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

/* =========================================
   SOCKET.IO
========================================= */

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
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

const client =
    new MongoClient(
        MONGODB_URI
    );

/* =========================================
   ONLINE USERS
========================================= */

const onlineUsers =
    new Map();

/*
    userId -> Set(socketId)
*/

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

    return {
        id:
            user._id.toString(),

        username:
            user.username,

        displayName:
            user.displayName ||
            user.username,

        email:
            user.email,

        createdAt:
            user.createdAt
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
            message: "Login required"
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
                    new Date()
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
                        publicUser
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
                        await conversations
                            .insertOne(
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
                                message.conversationId
                                    .toString(),

                            senderId:
                                message.senderId
                                    .toString(),

                            text:
                                message.text ||
                                "",

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

                    seenAt: {
                        $exists: false
                    }
                },

                {
                    $set: {
                        seenAt: now
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

            /*
                Tell sender their messages
                have been seen.
            */

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
                        seenAt: now,
                        seenBy: myId
                    }
                );
            }

            res.json({
                success: true,
                seenAt: now
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

            /*
                Increment receiver unread
            */

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
                    },

                    $setOnInsert: {

                        [`unreadCounts.${senderId}`]:
                            0
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
                Send to conversation room
            */

            io.to(
                "conversation:" +
                conversationId
            ).emit(
                "newMessage",
                output
            );

            /*
                Also notify receiver's
                personal room.
            */

            io.to(
                "user:" +
                receiverId
            ).emit(
                "conversationUpdated",
                {
                    conversationId,
                    message: output
                }
            );

            /*
                Tell sender delivered
                if receiver online.
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
   SOCKET.IO
========================================= */

io.on(
    "connection",
    function(socket) {

        console.log(
            "Socket connected:",
            socket.id
        );

        /* ================================
           AUTHENTICATE
        ================================= */

        socket.on(
            "authenticate",
            function(token) {

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

                    if (
                        !onlineUsers.has(
                            userId
                        )
                    ) {

                        onlineUsers.set(
                            userId,
                            new Set()
                        );
                    }

                    onlineUsers
                        .get(userId)
                        .add(
                            socket.id
                        );

                    socket.join(
                        "user:" +
                        userId
                    );

                    io.emit(
                        "userOnline",
                        userId
                    );

                } catch (error) {

                    socket.emit(
                        "authError",
                        "Invalid token"
                    );
                }

            }
        );

        /* ================================
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
                        Opening chat means
                        mark received messages
                        as seen.
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

                            seenAt: {
                                $exists: false
                            }
                        },

                        {
                            $set: {
                                seenAt: now
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
                                seenAt: now,
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

        /* ================================
           LEAVE CONVERSATION
        ================================= */

        socket.on(
            "leaveConversation",
            function(
                conversationId
            ) {

                socket.leave(
                    "conversation:" +
                    conversationId
                );

            }
        );

        /* ================================
           OLD JOIN COMPATIBILITY
        ================================= */

        socket.on(
            "join",
            function(username) {

                socket.username =
                    username;

            }
        );

        /* ================================
           OLD SEND COMPATIBILITY
        ================================= */

        socket.on(
            "sendMessage",
            async function(data) {

                /*
                    Old frontend won't be
                    used anymore.

                    Kept only so old clients
                    don't crash the server.
                */

                if (
                    !data ||
                    !data.conversationId ||
                    !data.text
                ) {
                    return;
                }

                try {

                    if (!socket.user) {
                        return;
                    }

                    const conversationId =
                        data.conversationId;

                    const text =
                        String(
                            data.text
                        ).trim();

                    if (
                        !validId(
                            conversationId
                        ) ||
                        !text
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

                    const receiverObjectId =
                        conversation.members.find(
                            function(member) {

                                return (
                                    member.toString() !==
                                    socket.user.id
                                );
                            }
                        );

                    if (!receiverObjectId) {
                        return;
                    }

                    const receiverId =
                        receiverObjectId.toString();

                    const now =
                        new Date();

                    const receiverOnline =
                        isUserOnline(
                            receiverId
                        );

                    const message = {

                        conversationId:
                            new ObjectId(
                                conversationId
                            ),

                        senderId:
                            new ObjectId(
                                socket.user.id
                            ),

                        text,

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
                            message
                        );

                    const unread =
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
                                    unread + 1
                            }
                        }
                    );

                    const output = {

                        id:
                            result.insertedId.toString(),

                        conversationId,

                        senderId:
                            socket.user.id,

                        receiverId,

                        text,

                        createdAt:
                            now,

                        deliveredAt:
                            receiverOnline
                                ? now
                                : null,

                        seenAt:
                            null
                    };

                    io.to(
                        "conversation:" +
                        conversationId
                    ).emit(
                        "newMessage",
                        output
                    );

                    io.to(
                        "user:" +
                        receiverId
                    ).emit(
                        "conversationUpdated",
                        {
                            conversationId,
                            message: output
                        }
                    );

                } catch (error) {

                    console.error(
                        "OLD SOCKET ERROR:",
                        error
                    );
                }
            }
        );

        /* ================================
           DISCONNECT
        ================================= */

        socket.on(
            "disconnect",
            function() {

                if (
                    socket.user &&
                    socket.user.id
                ) {

                    const userId =
                        socket.user.id;

                    const sockets =
                        onlineUsers.get(
                            userId
                        );

                    if (sockets) {

                        sockets.delete(
                            socket.id
                        );

                        if (
                            sockets.size ===
                            0
                        ) {

                            onlineUsers.delete(
                                userId
                            );

                            io.emit(
                                "userOffline",
                                userId
                            );
                        }
                    }
                }

                console.log(
                    "Socket disconnected:",
                    socket.id
                );
            }
        );

    }
);

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
