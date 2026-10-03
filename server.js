const express = require("express");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient } = require("mongodb");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

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

/* =========================
   BASIC MIDDLEWARE
========================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, ".")));


/* =========================
   MONGODB CONNECTION
========================= */

async function connectMongoDB() {

    try {

        if (!MONGODB_URI) {
            throw new Error(
                "MONGODB_URI environment variable is missing."
            );
        }

        if (!JWT_SECRET) {
            throw new Error(
                "JWT_SECRET environment variable is missing."
            );
        }

        const client = new MongoClient(MONGODB_URI);

        await client.connect();

        db = client.db("telesupar");

        users = db.collection("users");

        messages = db.collection("messages");

        await users.createIndex(
            { username: 1 },
            { unique: true }
        );

        await users.createIndex(
            { email: 1 },
            { unique: true }
        );

        await messages.createIndex({
            createdAt: -1
        });

        console.log(
            "===================================="
        );

        console.log(
            "MongoDB connected successfully"
        );

        console.log(
            "Database: telesupar"
        );

        console.log(
            "===================================="
        );

    } catch (error) {

        console.error(
            "MongoDB connection failed:"
        );

        console.error(error.message);

        process.exit(1);
    }
}


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

        if (
            !username ||
            !displayName ||
            !email ||
            !password
        ) {

            return res.status(400).json({
                success: false,
                message: "All fields are required."
            });
        }

        const cleanUsername =
            username.trim().toLowerCase();

        const cleanName =
            displayName.trim();

        const cleanEmail =
            email.trim().toLowerCase();


        if (cleanUsername.length < 3) {

            return res.status(400).json({
                success: false,
                message:
                    "Username must be at least 3 characters."
            });
        }


        if (password.length < 6) {

            return res.status(400).json({
                success: false,
                message:
                    "Password must be at least 6 characters."
            });
        }


        const existingUser =
            await users.findOne({
                $or: [
                    {
                        username:
                            cleanUsername
                    },
                    {
                        email:
                            cleanEmail
                    }
                ]
            });


        if (existingUser) {

            if (
                existingUser.username ===
                cleanUsername
            ) {

                return res.status(409).json({
                    success: false,
                    message:
                        "Username already exists."
                });
            }


            return res.status(409).json({
                success: false,
                message:
                    "Email already exists."
            });
        }


        const passwordHash =
            await bcrypt.hash(password, 12);


        const newUser = {

            username:
                cleanUsername,

            displayName:
                cleanName,

            email:
                cleanEmail,

            passwordHash:

                passwordHash,

            createdAt:
                new Date()
        };


        const result =
            await users.insertOne(newUser);


        const token =
            jwt.sign(
                {
                    id:
                        result.insertedId.toString(),

                    username:
                        cleanUsername
                },

                JWT_SECRET,

                {
                    expiresIn:
                        "7d"
                }
            );


        res.status(201).json({

            success: true,

            message:
                "Account created successfully.",

            token,

            user: {

                id:
                    result.insertedId.toString(),

                username:
                    cleanUsername,

                displayName:
                    cleanName,

                email:
                    cleanEmail
            }

        });


    } catch (error) {

        console.error(
            "Register error:",
            error
        );


        if (
            error.code === 11000
        ) {

            return res.status(409).json({

                success: false,

                message:
                    "Username or email already exists."
            });
        }


        res.status(500).json({

            success: false,

            message:
                "Server error while creating account."
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

                message:
                    "Email and password are required."
            });
        }


        const cleanEmail =
            email.trim().toLowerCase();


        const user =
            await users.findOne({
                email:
                    cleanEmail
            });


        if (!user) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid email or password."
            });
        }


        const passwordCorrect =
            await bcrypt.compare(
                password,
                user.passwordHash
            );


        if (!passwordCorrect) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid email or password."
            });
        }


        const token =
            jwt.sign(

                {
                    id:
                        user._id.toString(),

                    username:
                        user.username
                },

                JWT_SECRET,

                {
                    expiresIn:
                        "7d"
                }
            );


        res.json({

            success: true,

            message:
                "Login successful.",

            token,

            user: {

                id:
                    user._id.toString(),

                username:
                    user.username,

                displayName:
                    user.displayName,

                email:
                    user.email
            }

        });


    } catch (error) {

        console.error(
            "Login error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Server error while logging in."
        });
    }
});


/* =========================
   CHECK CURRENT USER
========================= */

app.get("/api/me", async (req, res) => {

    try {

        const auth =
            req.headers.authorization;


        if (
            !auth ||
            !auth.startsWith("Bearer ")
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Not logged in."
            });
        }


        const token =
            auth.substring(7);


        const decoded =
            jwt.verify(
                token,
                JWT_SECRET
            );


        const { ObjectId } =
            require("mongodb");


        const user =
            await users.findOne({

                _id:
                    new ObjectId(
                        decoded.id
                    )

            });


        if (!user) {

            return res.status(404).json({

                success: false,

                message:
                    "User not found."
            });
        }


        res.json({

            success: true,

            user: {

                id:
                    user._id.toString(),

                username:
                    user.username,

                displayName:
                    user.displayName,

                email:
                    user.email,

                createdAt:
                    user.createdAt
            }

        });


    } catch (error) {

        res.status(401).json({

            success: false,

            message:
                "Invalid or expired token."
        });
    }
});


/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {

    res.json({

        success: true,

        server:
            "TELESUPAR",

        mongodb:
            db ? "connected" : "not connected",

        time:
            new Date().toISOString()
    });
});


/* =========================
   SOCKET.IO
========================= */

const onlineUsers =
    new Map();


io.on("connection", (socket) => {

    console.log(
        "Socket connected:",
        socket.id
    );


    socket.on("join", (username) => {

        if (!username) return;

        onlineUsers.set(
            socket.id,
            username
        );


        io.emit(
            "onlineUsers",
            Array.from(
                onlineUsers.values()
            )
        );


        socket.broadcast.emit(
            "userOnline",
            {
                username:
                    username
            }
        );
    });


    socket.on(
        "sendMessage",
        async (data) => {

            if (
                !data ||
                !data.message
            ) {
                return;
            }


            const messageData = {

                username:
                    data.username ||
                    "Unknown",

                message:
                    data.message,

                time:
                    new Date()
            };


            try {

                if (messages) {

                    await messages.insertOne(
                        messageData
                    );
                }

            } catch (error) {

                console.error(
                    "Message save error:",
                    error
                );
            }


            io.emit(
                "receiveMessage",
                {
                    ...messageData,

                    time:
                        messageData.time
                            .toISOString()
                }
            );
        }
    );


    socket.on(
        "disconnect",
        () => {

            const username =
                onlineUsers.get(
                    socket.id
                );


            if (username) {

                onlineUsers.delete(
                    socket.id
                );


                io.emit(
                    "userOffline",
                    {
                        username:
                            username
                    }
                );


                io.emit(
                    "onlineUsers",
                    Array.from(
                        onlineUsers.values()
                    )
                );
            }


            console.log(
                "Socket disconnected:",
                socket.id
            );
        }
    );

});


/* =========================
   HOME
========================= */

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "index.html"
        )
    );
});


/* =========================
   START SERVER
========================= */

async function startServer() {

    await connectMongoDB();


    server.listen(
        PORT,
        () => {

            console.log(
                "===================================="
            );

            console.log(
                `TELESUPAR server running on port ${PORT}`
            );

            console.log(
                "Real-time Socket.IO: ON"
            );

            console.log(
                "===================================="
            );
        }
    );
}


startServer();
