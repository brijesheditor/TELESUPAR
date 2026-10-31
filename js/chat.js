/* ==========================================
   TELESUPAR CHAT V2
   MongoDB + Socket.IO + Attachments
========================================== */

"use strict";

const API = "https://telesupar.onrender.com";

/* ==========================================
   AUTHENTICATION
========================================== */

const token = localStorage.getItem("telesupar_token");

let currentUser = null;

try {
    currentUser = JSON.parse(
        localStorage.getItem("telesupar_user") || "null"
    );
} catch (e) {
    currentUser = null;
}

if (!token || !currentUser) {
    window.location.href = "login.html";
}

const myId = String(
    currentUser?.id || currentUser?._id || ""
);

if (!myId) {
    localStorage.removeItem("telesupar_user");
    window.location.href = "login.html";
}

/* ==========================================
   DOM
========================================== */

const $ = id => document.getElementById(id);

const messagesEl = $("messages");
const messageInput = $("messageInput");
const messageForm = $("messageForm");
const sendBtn = $("sendBtn");

const chatUserName = $("chatUserName");
const headerAvatar = $("headerAvatar");
const onlineStatus = $("onlineStatus");

const backBtn = $("backBtn");
const chatMenuBtn = $("chatMenuBtn");

const attachmentBtn = $("attachmentBtn");
const attachmentMenu = $("attachmentMenu");

const photoBtn = $("photoBtn");
const fileBtn = $("fileBtn");
const cameraBtn = $("cameraBtn");

const photoInput = $("photoInput");
const fileInput = $("fileInput");
const cameraInput = $("cameraInput");

/* ==========================================
   STATE
========================================== */

let conversationId = null;
let otherUser = null;
let socket = null;

let isSending = false;
let isOtherTyping = false;
let typingTimer = null;

const messagesCache = new Map();

/* ==========================================
   API HELPER
========================================== */

async function api(url, options = {}) {

    const headers = {
        Authorization: "Bearer " + token,
        ...(options.headers || {})
    };

    let body = options.body;

    if (body instanceof FormData) {
        delete headers["Content-Type"];
    } else if (
        body &&
        typeof body === "object"
    ) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
    }

    const response = await fetch(API + url, {
        ...options,
        headers,
        body
    });

    let data;

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {
        throw new Error(
            data.message || "Server request failed"
        );
    }

    return data;
}

/* ==========================================
   URL PARAMETERS
========================================== */

function getURLParams() {

    const params = new URLSearchParams(
        window.location.search
    );

    return {
        id: params.get("id"),
        conversationId:
            params.get("conversationId"),
        userId:
            params.get("userId") ||
            params.get("uid")
    };
}

/* ==========================================
   START CHAT
========================================== */

async function initChat() {

    try {

        showMessage("Connecting to TELESUPAR...");

        const params = getURLParams();

        let requestedId =
            params.conversationId ||
            params.id;

        const requestedUserId =
            params.userId;

        if (!requestedId && !requestedUserId) {
            throw new Error(
                "Chat ID nahi mila. Home se chat dobara kholo."
            );
        }

        // Recent conversations load
        const data = await api("/api/conversations");

        const list = data.conversations || [];

        let conversation = null;

        if (requestedId) {

            conversation = list.find(item =>
                String(item.id || item._id) ===
                String(requestedId)
            );
        }

        // If direct user ID was passed,
        // create/get the conversation.
        if (!conversation && requestedUserId) {

            const created = await api(
                "/api/conversations/" +
                encodeURIComponent(requestedUserId),
                {
                    method: "POST"
                }
            );

            conversation =
                created.conversation;
        }

        // Support old links that passed user ID in ?id=
        if (!conversation && requestedId) {

            const created = await api(
                "/api/conversations/" +
                encodeURIComponent(requestedId),
                {
                    method: "POST"
                }
            );

            conversation =
                created.conversation;
        }

        if (!conversation) {
            throw new Error(
                "Conversation nahi mil paya."
            );
        }

        conversationId = String(
            conversation.id ||
            conversation._id ||
            ""
        );

        if (!conversationId) {
            throw new Error(
                "Server ne Conversation ID return nahi ki."
            );
        }

        otherUser =
            conversation.otherUser ||
            conversation.user ||
            null;

        if (!otherUser) {
            throw new Error(
                "Chat user information missing."
            );
        }

        // Normalize URL
        const newURL =
            "chat.html?id=" +
            encodeURIComponent(conversationId);

        window.history.replaceState(
            {},
            "",
            newURL
        );

        updateHeader();

        showMessage("Loading messages...");

        await loadMessages();

        connectSocket();

        await markConversationRead();

        console.log(
            "TELESUPAR CHAT READY",
            conversationId
        );

        messageInput.focus();

    } catch (error) {

        console.error(
            "CHAT INIT ERROR:",
            error
        );

        showMessage(
            "Chat error: " + error.message
        );
    }
}

/* ==========================================
   HEADER
========================================== */

function updateHeader() {

    const name =
        otherUser.displayName ||
        otherUser.username ||
        "TELESUPAR User";

    chatUserName.textContent = name;

    const initials = name
        .trim()
        .split(/\s+/)
        .map(word => word[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

    headerAvatar.innerHTML = "";

    if (otherUser.avatar) {

        const image = document.createElement("img");

        image.src = otherUser.avatar;
        image.alt = name;

        headerAvatar.appendChild(image);

    } else {

        headerAvatar.textContent =
            initials || "U";
    }

    updateOnlineStatus(
        !!otherUser.isOnline,
        otherUser.lastSeen
    );
}

/* ==========================================
   ONLINE STATUS
========================================== */

function updateOnlineStatus(online, lastSeen) {

    if (isOtherTyping) return;

    if (online) {

        onlineStatus.textContent = "online";

        onlineStatus.classList.add("online");

    } else {

        onlineStatus.classList.remove("online");

        if (lastSeen) {

            onlineStatus.textContent =
                "last seen " + formatLastSeen(lastSeen);

        } else {

            onlineStatus.textContent = "offline";
        }
    }
}

/* ==========================================
   LOAD MESSAGES
========================================== */

async function loadMessages() {

    const data = await api(
        "/api/conversations/" +
        encodeURIComponent(conversationId) +
        "/messages"
    );

    const list = data.messages || [];

    messagesCache.clear();

    list.forEach(message => {

        const id = String(
            message.id || message._id || ""
        );

        if (id) {
            messagesCache.set(id, message);
        }
    });

    renderMessages();

    scrollToBottom(true);
}

/* ==========================================
   RENDER MESSAGES
========================================== */

function renderMessages() {

    messagesEl.innerHTML = "";

    const list = Array.from(
        messagesCache.values()
    );

    list.sort((a, b) => {
        return (
            new Date(a.createdAt) -
            new Date(b.createdAt)
        );
    });

    if (list.length === 0) {

        showMessage(
            "No messages yet. Say hello 👋"
        );

        return;
    }

    list.forEach(message => {

        messagesEl.appendChild(
            createMessageElement(message)
        );
    });
}

/* ==========================================
   CREATE MESSAGE ELEMENT
========================================== */

function createMessageElement(message) {

    const wrapper = document.createElement("div");

    const senderId = String(message.senderId || "");

    const mine = senderId === myId;

    wrapper.className =
        "message " +
        (mine ? "outgoing" : "incoming");

    wrapper.dataset.messageId =
        String(message.id);

    const content = document.createElement("div");

    content.className = "message-content";

    const bubble = document.createElement("div");

    bubble.className = "message-bubble";

    // Attachment
    const attachment = message.attachment;

    if (attachment && attachment.url) {

        const link = document.createElement("a");

        link.href = attachment.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        link.style.display = "block";
        link.style.color = "inherit";
        link.style.textDecoration = "none";
        link.style.overflowWrap = "anywhere";

        if (
            attachment.mimeType &&
            attachment.mimeType.startsWith("image/")
        ) {

            const img = document.createElement("img");

            img.src = attachment.url;

            img.alt =
                attachment.fileName || "Shared photo";

            img.loading = "lazy";

            img.style.width = "240px";
            img.style.maxWidth = "100%";
            img.style.maxHeight = "300px";
            img.style.objectFit = "contain";
            img.style.borderRadius = "10px";
            img.style.display = "block";

            link.appendChild(img);

        } else {

            link.textContent =
                "📎 " +
                (attachment.fileName || "Open file");
        }

        bubble.appendChild(link);
    }

    // Message text
    if (message.text) {

        const text = document.createElement("div");

        text.className = "message-text";

        text.textContent = message.text;

        bubble.appendChild(text);
    }

    // Meta
    const meta = document.createElement("div");

    meta.className = "message-meta";

    const time = document.createElement("span");

    time.className = "message-time";

    time.textContent = formatTime(message.createdAt);

    meta.appendChild(time);

    // Delivery status
    if (mine) {

        const status = document.createElement("span");

        status.className = "message-status";

        status.dataset.statusFor =
            String(message.id);

        status.textContent = getStatus(message);

        meta.appendChild(status);
    }

    bubble.appendChild(meta);

    content.appendChild(bubble);

    wrapper.appendChild(content);

    return wrapper;
}

/* ==========================================
   MESSAGE STATUS
========================================== */

function getStatus(message) {

    if (message.seenAt) {
        return "✓✓";
    }

    if (message.deliveredAt) {
        return "✓✓";
    }

    return "✓";
}

function updateMessageStatus(messageId) {

    const message = messagesCache.get(
        String(messageId)
    );

    if (!message) return;

    const element = messagesEl.querySelector(
        '[data-status-for="' + CSS.escape(
            String(messageId)
        ) + '"]'
    );

    if (element) {
        element.textContent = getStatus(message);
    }
}

/* ==========================================
   SOCKET CONNECTION
========================================== */

function connectSocket() {

    if (typeof io === "undefined") {

        console.error("Socket.IO not loaded");

        return;
    }

    socket = io(API, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity
    });

    socket.on("connect", () => {

        console.log("Socket connected");

        socket.emit("authenticate", token);
    });

    socket.on("authenticated", () => {

        console.log("Socket authenticated");

        joinConversation();
    });

    // Your server currently does not emit
    // "authenticated"; join after presence.
    socket.on("presence", data => {

        if (
            data &&
            String(data.userId) === myId
        ) {
            joinConversation();
        }
    });

    socket.on("userOnline", userId => {

        if (
            String(userId) ===
            String(otherUser?.id)
        ) {
            updateOnlineStatus(true);
        }
    });

    socket.on("userOffline", data => {

        if (
            String(data?.userId) ===
            String(otherUser?.id)
        ) {
            updateOnlineStatus(
                false,
                data.lastSeen
            );
        }
    });

    // New messages
    socket.on("newMessage", message => {

        if (
            !message ||
            String(message.conversationId) !==
            String(conversationId)
        ) {
            return;
        }

        const id = String(
            message.id || message._id || ""
        );

        if (!id) return;

        if (messagesCache.has(id)) return;

        messagesCache.set(id, message);

        renderMessages();

        scrollToBottom(true);

        if (String(message.senderId) !== myId) {
            markConversationRead();
        }
    });

    // Delivered
    socket.on("messageDelivered", data => {

        if (!data?.messageId) return;

        const message = messagesCache.get(
            String(data.messageId)
        );

        if (message) {

            message.deliveredAt =
                data.deliveredAt || new Date();

            updateMessageStatus(data.messageId);
        }
    });

    // Seen
    socket.on("messagesSeen", data => {

        if (
            !data ||
            String(data.conversationId) !==
            String(conversationId)
        ) {
            return;
        }

        messagesCache.forEach(message => {

            if (
                String(message.senderId) === myId
            ) {

                message.seenAt =
                    data.seenAt || new Date();

                updateMessageStatus(message.id);
            }
        });
    });

    // Typing
    socket.on("typing", data => {

        if (
            !data ||
            String(data.conversationId) !==
            String(conversationId)
        ) {
            return;
        }

        if (
            String(data.userId) !==
            String(otherUser?.id)
        ) {
            return;
        }

        setTypingStatus(data.isTyping === true);
    });

    socket.on("authError", error => {

        console.error("Socket authentication error:", error);
    });

    socket.on("connect_error", error => {

        console.error("Socket connection error:", error.message);
    });

    socket.on("disconnect", reason => {

        console.log("Socket disconnected:", reason);

        if (!isOtherTyping) {
            onlineStatus.textContent = "Reconnecting...";
            onlineStatus.classList.remove("online");
        }
    });
}

/* ==========================================
   JOIN CONVERSATION
========================================== */

function joinConversation() {

    if (
        socket &&
        socket.connected &&
        conversationId
    ) {

        socket.emit(
            "joinConversation",
            conversationId
        );

        console.log(
            "Joined conversation:",
            conversationId
        );
    }
}

/* ==========================================
   MARK READ
========================================== */

async function markConversationRead() {

    if (!conversationId) return;

    try {

        await api(
            "/api/conversations/" +
            encodeURIComponent(conversationId) +
            "/read",
            {
                method: "POST"
            }
        );

    } catch (error) {

        console.warn(
            "READ ERROR:",
            error.message
        );
    }
}

/* ==========================================
   SEND MESSAGE
========================================== */

async function sendMessage() {

    if (isSending || !conversationId) return;

    const text = messageInput.value.trim();

    if (!text) return;

    isSending = true;

    sendBtn.disabled = true;

    try {

        const data = await api(
            "/api/conversations/" +
            encodeURIComponent(conversationId) +
            "/messages",
            {
                method: "POST",
                body: { text }
            }
        );

        const message = data.message;

        if (message?.id) {

            messagesCache.set(
                String(message.id),
                message
            );

            renderMessages();

            scrollToBottom(true);
        }

        messageInput.value = "";

        sendTyping(false);

    } catch (error) {

        console.error("SEND ERROR:", error);

        alert(error.message);

    } finally {

        isSending = false;

        sendBtn.disabled = false;

        messageInput.focus();
    }
}

/* ==========================================
   FORM EVENTS
========================================== */

messageForm.addEventListener("submit", event => {

    event.preventDefault();

    sendMessage();
});

messageInput.addEventListener("keydown", event => {

    if (
        event.key === "Enter" &&
        !event.shiftKey
    ) {

        event.preventDefault();

        sendMessage();
    }
});

/* ==========================================
   TYPING
========================================== */

messageInput.addEventListener("input", () => {

    sendTyping(true);

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {

        sendTyping(false);

    }, 900);
});

function sendTyping(isTyping) {

    if (
        !socket ||
        !socket.connected ||
        !conversationId
    ) return;

    socket.emit("typing", {
        conversationId,
        isTyping
    });
}

function setTypingStatus(typing) {

    isOtherTyping = typing;

    if (typing) {

        onlineStatus.textContent = "typing...";

        onlineStatus.classList.add("online");

    } else {

        updateOnlineStatus(
            !!otherUser?.isOnline,
            otherUser?.lastSeen
        );
    }
}

/* ==========================================
   ATTACHMENT MENU
========================================== */

attachmentBtn.addEventListener("click", event => {

    event.stopPropagation();

    attachmentMenu.classList.toggle("show");
});

document.addEventListener("click", event => {

    if (
        attachmentMenu &&
        !attachmentMenu.contains(event.target) &&
        event.target !== attachmentBtn
    ) {

        attachmentMenu.classList.remove("show");
    }
});

photoBtn.addEventListener("click", () => {

    attachmentMenu.classList.remove("show");

    photoInput.click();
});

fileBtn.addEventListener("click", () => {

    attachmentMenu.classList.remove("show");

    fileInput.click();
});

cameraBtn.addEventListener("click", () => {

    attachmentMenu.classList.remove("show");

    cameraInput.click();
});

/* ==========================================
   UPLOAD ATTACHMENT
========================================== */

async function uploadAttachment(file) {

    if (!file || !conversationId) return;

    if (file.size > 10 * 1024 * 1024) {

        alert("Maximum file size is 10 MB");

        return;
    }

    const formData = new FormData();

    formData.append("file", file);

    sendBtn.disabled = true;

    try {

        const data = await api(
            "/api/conversations/" +
            encodeURIComponent(conversationId) +
            "/attachments",
            {
                method: "POST",
                body: formData
            }
        );

        if (data.message?.id) {

            messagesCache.set(
                String(data.message.id),
                data.message
            );

            renderMessages();

            scrollToBottom(true);
        }

        alert("Attachment sent successfully!");

    } catch (error) {

        console.error("UPLOAD ERROR:", error);

        alert("Upload failed: " + error.message);

    } finally {

        sendBtn.disabled = false;
    }
}

[photoInput, fileInput, cameraInput].forEach(input => {

    if (!input) return;

    input.addEventListener("change", () => {

        if (input.files?.[0]) {
            uploadAttachment(input.files[0]);
        }

        input.value = "";
    });
});

/* ==========================================
   BACK BUTTON
========================================== */

backBtn.addEventListener("click", () => {

    window.location.href = "home.html";
});

/* ==========================================
   CHAT MENU
========================================== */

chatMenuBtn.addEventListener("click", () => {

    console.log("TELESUPAR chat menu");
});

/* ==========================================
   HELPERS
========================================== */

function showMessage(message) {

    messagesEl.innerHTML = "";

    const element = document.createElement("div");

    element.className = "empty-chat";

    element.textContent = message;

    messagesEl.appendChild(element);
}

function formatTime(value) {

    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatLastSeen(value) {

    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    const minutes = Math.floor(
        (Date.now() - date.getTime()) / 60000
    );

    if (minutes < 1) return "just now";

    if (minutes < 60) return minutes + "m ago";

    const hours = Math.floor(minutes / 60);

    if (hours < 24) return hours + "h ago";

    return date.toLocaleDateString();
}

function scrollToBottom(force = false) {

    if (!messagesEl) return;

    if (force) {

        requestAnimationFrame(() => {

            messagesEl.scrollTop =
                messagesEl.scrollHeight;
        });
    }
}

/* ==========================================
   CLEANUP
========================================== */

window.addEventListener("beforeunload", () => {

    if (socket) {

        socket.emit(
            "leaveConversation",
            conversationId
        );

        socket.disconnect();
    }
});

/* ==========================================
   START
========================================== */

initChat();
