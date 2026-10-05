const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "telesupar_secret_change_me";

if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI is missing");
    process.exit(1);
}

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

app.use(
    cors({
        origin: "*"
    })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));


/* =========================================================
   MONGODB
========================================================= */

const client = new MongoClient(MONGODB_URI);

let db;
let users;
let messages;
let conversations;


/* =========================================================
   ONLINE USERS
========================================================= */

const onlineUsers = new Map();


/* =========================================================
   HELPERS
========================================================= */

function validId(id) {
    return ObjectId.isValid(id);
}


function makeToken(user) {
    return jwt.sign(
        {
            id: user._id.toString(),
            email: user.email
        },
        JWT_SECRET,
        {
            expiresIn: "30d"
        }
    );
}


function authMiddleware(req, res, next) {

    try {

        const header = req.headers.authorization || "";

        if (!header.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const token = header.substring(7);

        const decoded = jwt.verify(
            token,
            JWT_SECRET
        );

        req.userId = decoded.id;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });

    }
}


function safeUser(user) {

    if (!user) {
        return null;
    }

    return {
        id: user._id.toString(),
        username: user.username || "",
        displayName:
            user.displayName ||
            user.username ||
            "",
        email: user.email || "",
        avatar: user.avatar || "",
        createdAt: user.createdAt || null
    };
}


function conversationIdForUsers(userA, userB) {

    const ids = [
        userA.toString(),
        userB.toString()
    ].sort();

    return ids.join("_");
}


/* =========================================================
   HEALTH
========================================================= */

app.get("/", (req, res) => {

    res.json({
        success: true,
        app: "TELESUPAR",
        message: "TELESUPAR backend is running"
    });

});


app.get("/api/health", (req, res) => {

    res.json({
        success: true,
        message: "TELESUPAR API is healthy",
        time: new Date()
    });

});


/* =========================================================
   REGISTER
========================================================= */

app.post("/api/register", async (req, res) => {

    try {

        const {
            username,
            displayName,
            email,
            password
        } = req.body;

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

        const cleanUsername =
            String(username)
                .trim()
                .toLowerCase();

        const cleanEmail =
            String(email)
                .trim()
                .toLowerCase();

        if (password.length < 6) {

            return res.status(400).json({
                success: false,
                message:
                    "Password must be at least 6 characters"
            });

        }

        const existingUser =
            await users.findOne({
                $or: [
                    {
                        email:
                            cleanEmail
                    },
                    {
                        username:
                            cleanUsername
                    }
                ]
            });

        if (existingUser) {

            return res.status(409).json({
                success: false,
                message:
                    "Email or username already exists"
            });

        }

        const hashedPassword =
            await bcrypt.hash(
                password,
                10
            );

        const now = new Date();

        const newUser = {

            username:
                cleanUsername,

            displayName:
                String(displayName).trim(),

            email:
                cleanEmail,

            password:
                hashedPassword,

            avatar: "",

            createdAt:
                now,

            updatedAt:
                now
        };

        const result =
            await users.insertOne(
                newUser
            );

        const createdUser =
            await users.findOne({
                _id:
                    result.insertedId
            });

        const token =
            makeToken(
                createdUser
            );

        return res.status(201).json({

            success: true,

            message:
                "Registration successful",

            token,

            user:
                safeUser(
                    createdUser
                )
        });

    } catch (error) {

        console.error(
            "REGISTER ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Registration failed"
        });

    }

});


/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;

        if (!email || !password) {

            return res.status(400).json({
                success: false,
                message:
                    "Email and password are required"
            });

        }

        const user =
            await users.findOne({
                email:
                    String(email)
                        .trim()
                        .toLowerCase()
            });

        if (!user) {

            return res.status(401).json({
                success: false,
                message:
                    "Invalid email or password"
            });

        }

        const passwordOK =
            await bcrypt.compare(
                password,
                user.password
            );

        if (!passwordOK) {

            return res.status(401).json({
                success: false,
                message:
                    "Invalid email or password"
            });

        }

        const token =
            makeToken(user);

        return res.json({

            success: true,

            message:
                "Login successful",

            token,

            user:
                safeUser(user)
        });

    } catch (error) {

        console.error(
            "LOGIN ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Login failed"
        });

    }

});


/* =========================================================
   ME
========================================================= */

app.get(
    "/api/me",
    authMiddleware,
    async (req, res) => {

        try {

            if (!validId(req.userId)) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid user"
                });

            }

            const user =
                await users.findOne({
                    _id:
                        new ObjectId(
                            req.userId
                        )
                });

            if (!user) {

                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });

            }

            return res.json({
                success: true,
                user:
                    safeUser(user)
            });

        } catch (error) {

            console.error(
                "ME ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Could not load profile"
            });

        }

    }
);


/* =========================================================
   USERS SEARCH
========================================================= */

app.get(
    "/api/users",
    authMiddleware,
    async (req, res) => {

        try {

            const q =
                String(
                    req.query.q || ""
                )
                    .trim();

            if (!q) {

                return res.json({
                    success: true,
                    users: []
                });

            }

            const regex =
                new RegExp(
                    q.replace(
                        /[.*+?^${}()|[\]\\]/g,
                        "\\$&"
                    ),
                    "i"
                );

            const result =
                await users
                    .find({
                        _id: {
                            $ne:
                                new ObjectId(
                                    req.userId
                                )
                        },
                        $or: [
                            {
                                username:
                                    regex
                            },
                            {
                                displayName:
                                    regex
                            },
                            {
                                email:
                                    regex
                            }
                        ]
                    })
                    .limit(30)
                    .toArray();

            return res.json({

                success: true,

                users:
                    result.map(
                        safeUser
                    )

            });

        } catch (error) {

            console.error(
                "USERS ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Could not search users"
            });

        }

    }
);


/* =========================================================
   GET / CREATE CONVERSATION
========================================================= */

app.post(
    "/api/conversations",
    authMiddleware,
    async (req, res) => {

        try {

            const {
                userId
            } = req.body;

            if (!userId || !validId(userId)) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid user ID"
                });

            }

            if (userId === req.userId) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Cannot chat with yourself"
                });

            }

            const currentUserId =
                new ObjectId(
                    req.userId
                );

            const otherUserId =
                new ObjectId(
                    userId
                );

            const otherUser =
                await users.findOne({
                    _id:
                        otherUserId
                });

            if (!otherUser) {

                return res.status(404).json({
                    success: false,
                    message:
                        "User not found"
                });

            }

            let conversation =
                await conversations.findOne({
                    members: {
                        $all: [
                            currentUserId,
                            otherUserId
                        ]
                    }
                });

            if (!conversation) {

                const now =
                    new Date();

                const result =
                    await conversations.insertOne({

                        members: [
                            currentUserId,
                            otherUserId
                        ],

                        createdBy:
                            currentUserId,

                        createdAt:
                            now,

                        updatedAt:
                            now,

                        lastMessage:
                            "",

                        lastMessageAt:
                            null,

                        unreadCounts: {
                            [req.userId]: 0,
                            [userId]: 0
                        }

                    });

                conversation =
                    await conversations.findOne({
                        _id:
                            result.insertedId
                    });

            }

            return res.json({

                success: true,

                conversation: {
                    id:
                        conversation._id.toString(),

                    members:
                        conversation.members.map(
                            id => id.toString()
                        ),

                    createdAt:
                        conversation.createdAt,

                    updatedAt:
                        conversation.updatedAt,

                    lastMessage:
                        conversation.lastMessage ||
                        "",

                    lastMessageAt:
                        conversation.lastMessageAt ||
                        null
                },

                user:
                    safeUser(
                        otherUser
                    )

            });

        } catch (error) {

            console.error(
                "CREATE CONVERSATION ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Could not start conversation"
            });

        }

    }
);


/* =========================================================
   GET USER CONVERSATIONS
========================================================= */

app.get(
    "/api/conversations/:userId",
    authMiddleware,
    async (req, res) => {

        try {

            const userId =
                req.params.userId;

            if (
                !validId(userId) ||
                userId !== req.userId
            ) {

                return res.status(403).json({
                    success: false,
                    message:
                        "Invalid user"
                });

            }

            const currentUserId =
                new ObjectId(
                    req.userId
                );

            const list =
                await conversations
                    .find({
                        members:
                            currentUserId
                    })
                    .sort({
                        updatedAt: -1
                    })
                    .toArray();

            const output = [];

            for (
                const conversation
                of list
            ) {

                const otherId =
                    conversation.members
                        .find(
                            id =>
                                id.toString() !==
                                req.userId
                        );

                if (!otherId) {
                    continue;
                }

                const otherUser =
                    await users.findOne({
                        _id:
                            otherId
                    });

                if (!otherUser) {
                    continue;
                }

                const unread =
                    conversation
                        .unreadCounts?.[
                            req.userId
                        ] || 0;

                output.push({

                    id:
                        conversation._id.toString(),

                    conversationId:
                        conversation._id.toString(),

                    user:
                        safeUser(
                            otherUser
                        ),

                    lastMessage:
                        conversation.lastMessage ||
                        "",

                    lastMessageAt:
                        conversation.lastMessageAt ||
                        null,

                    unreadCount:
                        unread,

                    updatedAt:
                        conversation.updatedAt

                });

            }

            return res.json({

                success: true,

                conversations:
                    output

            });

        } catch (error) {

            console.error(
                "CONVERSATIONS ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Could not load conversations"
            });

        }

    }
);


/* =========================================================
   GET MESSAGES
   IMPORTANT: REPLY DATA INCLUDED
========================================================= */

app.get(
    "/api/conversations/:conversationId/messages",
    authMiddleware,
    async (req, res) => {

        try {

            const conversationId =
                req.params.conversationId;

            if (!validId(conversationId)) {

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
                            req.userId
                        )
                });

            if (!conversation) {

                return res.status(403).json({
                    success: false,
                    message:
                        "You are not a member of this conversation"
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
                    .limit(1000)
                    .toArray();

            const output =
                list.map(message => ({

                    id:
                        message._id.toString(),

                    conversationId:
                        message.conversationId.toString(),

                    senderId:
                        message.senderId.toString(),

                    text:
                        message.text || "",

                    /*
                     * REPLY FEATURE
                     */
                    replyTo:
                        message.replyTo ||
                        null,

                    createdAt:
                        message.createdAt,

                    deliveredAt:
                        message.deliveredAt ||
                        null,

                    seenAt:
                        message.seenAt ||
                        null

                }));

            return res.json({

                success: true,

                messages:
                    output

            });

        } catch (error) {

            console.error(
                "GET MESSAGES ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Could not load messages"
            });

        }

    }
);


/* =========================================================
   SEND MESSAGE
   WITH SECURE REPLY VALIDATION
========================================================= */

app.post(
    "/api/conversations/:conversationId/messages",
    authMiddleware,
    async (req, res) => {

        try {

            const conversationId =
                req.params.conversationId;

            const text =
                String(
                    req.body.text || ""
                ).trim();

            if (!validId(conversationId)) {

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
                            req.userId
                        )
                });

            if (!conversation) {

                return res.status(403).json({
                    success: false,
                    message:
                        "Conversation not found"
                });

            }

            const senderId =
                req.userId;

            const receiverObjectId =
                conversation.members.find(
                    id =>
                        id.toString() !==
                        senderId
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


            /* =====================================================
               REPLY VALIDATION
            ===================================================== */

            let replyTo = null;

            if (req.body.replyTo) {

                const requestedReply =
                    req.body.replyTo;

                const replyMessageId =
                    requestedReply.messageId;

                if (
                    !replyMessageId ||
                    !validId(
                        replyMessageId
                    )
                ) {

                    return res.status(400).json({
                        success: false,
                        message:
                            "Invalid reply message"
                    });

                }

                const originalMessage =
                    await messages.findOne({

                        _id:
                            new ObjectId(
                                replyMessageId
                            ),

                        conversationId:
                            new ObjectId(
                                conversationId
                            )

                    });

                if (!originalMessage) {

                    return res.status(400).json({
                        success: false,
                        message:
                            "Reply message not found"
                    });

                }

                replyTo = {

                    messageId:
                        originalMessage._id
                            .toString(),

                    senderId:
                        originalMessage.senderId
                            .toString(),

                    text:
                        String(
                            originalMessage.text ||
                            ""
                        ).substring(
                            0,
                            1000
                        )

                };

            }


            /* =====================================================
               MESSAGE CREATE
            ===================================================== */

            const now =
                new Date();

            const receiverOnline =
                onlineUsers.has(
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

                replyTo,

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


            /* =====================================================
               UPDATE CONVERSATION
            ===================================================== */

            const unreadUpdate = {};

            unreadUpdate[
                `unreadCounts.${receiverId}`
            ] = 1;

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
                            now

                    },

                    $inc: unreadUpdate

                }

            );


            /* =====================================================
               OUTPUT
            ===================================================== */

            const output = {

                id:
                    result.insertedId.toString(),

                conversationId,

                senderId,

                receiverId,

                text,

                replyTo,

                createdAt:
                    now,

                deliveredAt:
                    receiverOnline
                        ? now
                        : null,

                seenAt:
                    null

            };


            /* =====================================================
               REALTIME NEW MESSAGE
            ===================================================== */

            io.to(
                `user:${receiverId}`
            ).emit(
                "newMessage",
                output
            );

            io.to(
                `conversation:${conversationId}`
            ).emit(
                "newMessage",
                output
            );


            /* =====================================================
               CONVERSATION UPDATE
            ===================================================== */

            io.to(
                `user:${receiverId}`
            ).emit(
                "conversationUpdated",
                {
                    conversationId,
                    lastMessage:
                        text,
                    lastMessageAt:
                        now,
                    unreadCount:
                        undefined
                }
            );


            /* =====================================================
               DELIVERED
            ===================================================== */

            if (receiverOnline) {

                io.to(
                    `user:${senderId}`
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


            return res.status(201).json({

                success: true,

                message:
                    output

            });

        } catch (error) {

            console.error(
                "SEND MESSAGE ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Could not send message"
            });

        }

    }
);


/* =========================================================
   MARK CONVERSATION READ
========================================================= */

app.post(
    "/api/conversations/:conversationId/read",
    authMiddleware,
    async (req, res) => {

        try {

            const conversationId =
                req.params.conversationId;

            if (!validId(conversationId)) {

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
                            req.userId
                        )
                });

            if (!conversation) {

                return res.status(403).json({
                    success: false,
                    message:
                        "Conversation not found"
                });

            }

            const now =
                new Date();

            const result =
                await messages.updateMany(

                    {
                        conversationId:
                            new ObjectId(
                                conversationId
                            ),

                        senderId: {
                            $ne:
                                new ObjectId(
                                    req.userId
                                )
                        },

                        seenAt:
                            null

                    },

                    {
                        $set: {
                            seenAt:
                                now,
                            deliveredAt:
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
                        [
                            `unreadCounts.${req.userId}`
                        ]: 0
                    }

                }

            );


            if (result.modifiedCount > 0) {

                io.to(
                    `conversation:${conversationId}`
                ).emit(
                    "messagesSeen",
                    {
                        conversationId,
                        seenAt:
                            now,
                        userId:
                            req.userId
                    }
                );

            }

            return res.json({

                success: true,

                modified:
                    result.modifiedCount,

                seenAt:
                    now

            });

        } catch (error) {

            console.error(
                "READ ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Could not mark messages as read"
            });

        }

    }
);


/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
    "connection",
    (socket) => {

        console.log(
            "🔌 Socket connected:",
            socket.id
        );


        /* =====================================================
           AUTHENTICATE SOCKET
        ===================================================== */

        socket.on(
            "authenticate",
            async (data) => {

                try {

                    const token =
                        data?.token;

                    if (!token) {

                        socket.emit(
                            "authError",
                            {
                                message:
                                    "Token required"
                            }
                        );

                        return;
                    }

                    const decoded =
                        jwt.verify(
                            token,
                            JWT_SECRET
                        );

                    const userId =
                        decoded.id;

                    if (
                        !validId(
                            userId
                        )
                    ) {

                        socket.emit(
                            "authError",
                            {
                                message:
                                    "Invalid user"
                            }
                        );

                        return;
                    }

                    socket.userId =
                        userId;

                    onlineUsers.set(
                        userId,
                        socket.id
                    );

                    socket.join(
                        `user:${userId}`
                    );


                    const user =
                        await users.findOne({
                            _id:
                                new ObjectId(
                                    userId
                                )
                        });

                    socket.emit(
                        "authenticated",
                        {
                            success: true,
                            user:
                                safeUser(user)
                        }
                    );


                    io.emit(
                        "userOnline",
                        {
                            userId
                        }
                    );


                    console.log(
                        "🟢 User online:",
                        userId
                    );

                } catch (error) {

                    console.error(
                        "SOCKET AUTH ERROR:",
                        error
                    );

                    socket.emit(
                        "authError",
                        {
                            message:
                                "Socket authentication failed"
                        }
                    );

                }

            }
        );


        /* =====================================================
           JOIN CONVERSATION
        ===================================================== */

        socket.on(
            "joinConversation",
            async (conversationId) => {

                try {

                    if (
                        !socket.userId ||
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
                                    socket.userId
                                )

                        });

                    if (!conversation) {
                        return;
                    }

                    socket.join(
                        `conversation:${conversationId}`
                    );


                    /* =============================================
                       MARK RECEIVED MESSAGES DELIVERED
                    ============================================= */

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
                                        socket.userId
                                    )
                            },

                            deliveredAt:
                                null

                        },

                        {
                            $set: {
                                deliveredAt:
                                    now
                            }
                        }

                    );


                    /* =============================================
                       MARK AS SEEN
                    ============================================= */

                    const seenResult =
                        await messages.updateMany(

                            {
                                conversationId:
                                    new ObjectId(
                                        conversationId
                                    ),

                                senderId: {
                                    $ne:
                                        new ObjectId(
                                            socket.userId
                                        )
                                },

                                seenAt:
                                    null

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
                                [
                                    `unreadCounts.${socket.userId}`
                                ]: 0
                            }
                        }

                    );


                    if (
                        seenResult.modifiedCount >
                        0
                    ) {

                        io.to(
                            `conversation:${conversationId}`
                        ).emit(
                            "messagesSeen",
                            {
                                conversationId,
                                userId:
                                    socket.userId,
                                seenAt:
                                    now
                            }
                        );

                    }

                } catch (error) {

                    console.error(
                        "JOIN CONVERSATION ERROR:",
                        error
                    );

                }

            }
        );


        /* =====================================================
           LEAVE CONVERSATION
        ===================================================== */

        socket.on(
            "leaveConversation",
            (conversationId) => {

                if (
                    validId(
                        conversationId
                    )
                ) {

                    socket.leave(
                        `conversation:${conversationId}`
                    );

                }

            }
        );


        /* =====================================================
           TYPING
        ===================================================== */

        socket.on(
            "typing",
            (data) => {

                try {

                    if (
                        !socket.userId ||
                        !data?.conversationId
                    ) {
                        return;
                    }

                    socket.to(
                        `conversation:${data.conversationId}`
                    ).emit(
                        "typing",
                        {
                            userId:
                                socket.userId,
                            conversationId:
                                data.conversationId,
                            typing:
                                data.typing !== false
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


        /* =====================================================
           DISCONNECT
        ===================================================== */

        socket.on(
            "disconnect",
            () => {

                if (socket.userId) {

                    const currentSocket =
                        onlineUsers.get(
                            socket.userId
                        );

                    if (
                        currentSocket ===
                        socket.id
                    ) {

                        onlineUsers.delete(
                            socket.userId
                        );

                        io.emit(
                            "userOffline",
                            {
                                userId:
                                    socket.userId
                            }
                        );

                    }

                    console.log(
                        "🔴 User offline:",
                        socket.userId
                    );

                }

                console.log(
                    "🔌 Socket disconnected:",
                    socket.id
                );

            }
        );

    }
);


/* =========================================================
   DATABASE START
========================================================= */

async function startServer() {

    try {

        await client.connect();

        db =
            client.db();

        users =
            db.collection(
                "users"
            );

        messages =
            db.collection(
                "messages"
            );

        conversations =
            db.collection(
                "conversations"
            );


        /* =====================================================
           INDEXES
        ===================================================== */

        await users.createIndex(
            {
                email: 1
            },
            {
                unique: true
            }
        );

        await users.createIndex(
            {
                username: 1
            },
            {
                unique: true
            }
        );

        await messages.createIndex({
            conversationId: 1,
            createdAt: 1
        });

        await conversations.createIndex({
            members: 1
        });

        await conversations.createIndex({
            updatedAt: -1
        });


        server.listen(
            PORT,
            () => {

                console.log(
                    `🚀 TELESUPAR server running on port ${PORT}`
                );

            }
        );

    } catch (error) {

        console.error(
            "❌ DATABASE CONNECTION ERROR:",
            error
        );

        process.exit(1);

    }

}

startServer();
