/* =========================================
   TELESUPAR CHAT
   Realtime + Seen + Delivered
========================================= */

const API =
    "https://telesupar.onrender.com";

/* =========================================
   AUTH
========================================= */

const token =
    localStorage.getItem(
        "telesupar_token"
    );

const storedUser =
    localStorage.getItem(
        "telesupar_user"
    );

if (!token || !storedUser) {

    window.location.href =
        "login.html";
}

let currentUser;

try {

    currentUser =
        JSON.parse(
            storedUser
        );

} catch (error) {

    localStorage.removeItem(
        "telesupar_user"
    );

    window.location.href =
        "login.html";
}

/* =========================================
   STATE
========================================= */

let conversationId =
    null;

let otherUser =
    null;

let socket =
    null;

let isSending =
    false;

let typingTimer =
    null;

let isOtherTyping =
    false;

/*
    messageId -> message
*/
const messagesCache =
    new Map();

/* =========================================
   DOM
========================================= */

const messagesEl =
    document.getElementById(
        "messages"
    );

const messageForm =
    document.getElementById(
        "messageForm"
    );

const messageInput =
    document.getElementById(
        "messageInput"
    );

const sendBtn =
    document.getElementById(
        "sendBtn"
    );

const backBtn =
    document.getElementById(
        "backBtn"
    );

const headerAvatar =
    document.getElementById(
        "headerAvatar"
    );

const chatUserName =
    document.getElementById(
        "chatUserName"
    );

const onlineStatus =
    document.getElementById(
        "onlineStatus"
    );

const attachmentBtn =
    document.getElementById(
        "attachmentBtn"
    );

const attachmentMenu =
    document.getElementById(
        "attachmentMenu"
    );

const photoBtn =
    document.getElementById(
        "photoBtn"
    );

const fileBtn =
    document.getElementById(
        "fileBtn"
    );

const cameraBtn =
    document.getElementById(
        "cameraBtn"
    );

const photoInput =
    document.getElementById(
        "photoInput"
    );

const fileInput =
    document.getElementById(
        "fileInput"
    );

const cameraInput =
    document.getElementById(
        "cameraInput"
    );

/* =========================================
   AUTH REDIRECT
========================================= */

if (!token || !currentUser) {

    throw new Error(
        "Authentication required"
    );
}

/* =========================================
   GET CONVERSATION ID
========================================= */

const params =
    new URLSearchParams(
        window.location.search
    );

conversationId =
    params.get("id") ||
    params.get("conversationId");

/* =========================================
   API HELPER
========================================= */

async function api(
    path,
    options = {}
) {

    const headers = {

        ...(options.headers || {}),

        Authorization:
            "Bearer " + token,

        "Content-Type":
            "application/json"
    };

    const response =
        await fetch(
            API + path,
            {
                ...options,
                headers
            }
        );

    let data = null;

    try {

        data =
            await response.json();

    } catch (error) {

        data = null;
    }

    if (!response.ok) {

        throw new Error(
            data?.message ||
            "Request failed"
        );
    }

    return data;
}

/* =========================================
   INIT
========================================= */

async function initChat() {

    if (!conversationId) {

        showError(
            "Conversation not found"
        );

        return;
    }

    try {

        await loadConversationInfo();

        await loadMessages();

        connectSocket();

        await markConversationRead();

    } catch (error) {

        console.error(
            "CHAT INIT ERROR:",
            error
        );

        showError(
            error.message ||
            "Could not load chat"
        );
    }
}

/* =========================================
   LOAD CONVERSATION
========================================= */

async function loadConversationInfo() {

    const data =
        await api(
            "/api/conversations"
        );

    const list =
        data.conversations ||
        [];

    const conversation =
        list.find(
            function(item) {

                return (
                    String(
                        item.id ||
                        item._id
                    ) ===
                    String(
                        conversationId
                    )
                );
            }
        );

    if (!conversation) {

        throw new Error(
            "Conversation not found"
        );
    }

    otherUser =
        conversation.otherUser ||
        conversation.user ||
        null;

    updateHeader();
}

/* =========================================
   HEADER
========================================= */

function updateHeader() {

    if (!otherUser) {
        return;
    }

    const name =
        otherUser.displayName ||
        otherUser.username ||
        "User";

    chatUserName.textContent =
        name;

    setAvatar(
        headerAvatar,
        otherUser
    );

    updateOnlineStatus(
        !!otherUser.isOnline,
        otherUser.lastSeen
    );
}

/* =========================================
   AVATAR
========================================= */

function setAvatar(
    element,
    user
) {

    if (!element) {
        return;
    }

    const name =
        user?.displayName ||
        user?.username ||
        "U";

    const parts =
        name
            .trim()
            .split(/\s+/)
            .filter(Boolean);

    let initials =
        parts[0]?.charAt(0) ||
        "U";

    if (parts.length > 1) {

        initials +=
            parts[
                parts.length - 1
            ].charAt(0);
    }

    element.textContent =
        initials
            .substring(0, 2)
            .toUpperCase();
}

/* =========================================
   LOAD MESSAGES
========================================= */

async function loadMessages() {

    const data =
        await api(
            "/api/conversations/" +
            encodeURIComponent(
                conversationId
            ) +
            "/messages"
        );

    const list =
        data.messages ||
        [];

    messagesCache.clear();

    list.forEach(
        function(message) {

            if (message.id) {

                messagesCache.set(
                    String(message.id),
                    message
                );
            }
        }
    );

    renderMessages();

    scrollToBottom(
        true
    );
}

/* =========================================
   RENDER MESSAGES
========================================= */

function renderMessages() {

    if (!messagesEl) {
        return;
    }

    messagesEl.innerHTML = "";

    if (
        messagesCache.size === 0
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "empty-chat";

        empty.textContent =
            "No messages yet. Say hello 👋";

        messagesEl.appendChild(
            empty
        );

        return;
    }

    const list =
        Array.from(
            messagesCache.values()
        );

    list.sort(
        function(a, b) {

            return (
                new Date(
                    a.createdAt
                ) -
                new Date(
                    b.createdAt
                )
            );
        }
    );

    list.forEach(
        function(message) {

            messagesEl.appendChild(
                createMessageElement(
                    message
                )
            );
        }
    );
}

/* =========================================
   CREATE MESSAGE
========================================= */

function createMessageElement(
    message
) {

    const wrapper =
        document.createElement(
            "div"
        );

    const mine =
        String(
            message.senderId
        ) ===
        String(
            currentUser.id
        );

    wrapper.className =
        "message " +
        (
            mine
                ? "outgoing"
                : "incoming"
        );

    wrapper.dataset.messageId =
        String(
            message.id
        );

    const content =
        document.createElement(
            "div"
        );

    content.className =
        "message-content";

    const bubble =
        document.createElement(
            "div"
        );

    bubble.className =
        "message-bubble";

    /* =====================================
       TEXT
    ===================================== */

    const text =
        document.createElement(
            "div"
        );

    text.className =
        "message-text";

    text.textContent =
        message.text ||
        "";

    bubble.appendChild(
        text
    );

    /* =====================================
       META
    ===================================== */

    const meta =
        document.createElement(
            "div"
        );

    meta.className =
        "message-meta";

    const time =
        document.createElement(
            "span"
        );

    time.className =
        "message-time";

    time.textContent =
        formatTime(
            message.createdAt
        );

    meta.appendChild(
        time
    );

    /* =====================================
       STATUS
    ===================================== */

    if (mine) {

        const status =
            document.createElement(
                "span"
            );

        status.className =
            "message-status";

        status.dataset.statusFor =
            String(
                message.id
            );

        status.textContent =
            getStatus(
                message
            );

        meta.appendChild(
            status
        );
    }

    bubble.appendChild(
        meta
    );

    content.appendChild(
        bubble
    );

    wrapper.appendChild(
        content
    );

    return wrapper;
}

/* =========================================
   STATUS
========================================= */

function getStatus(
    message
) {

    if (message.seenAt) {

        return "✓✓";

    }

    if (message.deliveredAt) {

        return "✓✓";

    }

    return "✓";
}

/* =========================================
   UPDATE STATUS
========================================= */

function updateMessageStatus(
    messageId
) {

    const message =
        messagesCache.get(
            String(messageId)
        );

    if (!message) {
        return;
    }

    const element =
        messagesEl.querySelector(
            '[data-status-for="' +
            CSS.escape(
                String(messageId)
            ) +
            '"]'
        );

    if (!element) {
        return;
    }

    element.textContent =
        getStatus(
            message
        );
}

/* =========================================
   SOCKET.IO
========================================= */

function connectSocket() {

    if (
        typeof io ===
        "undefined"
    ) {

        console.error(
            "Socket.IO not loaded"
        );

        return;
    }

    socket =
        io(
            API,
            {
                transports: [
                    "websocket",
                    "polling"
                ],
                reconnection: true,
                reconnectionAttempts:
                    Infinity
            }
        );

    socket.on(
        "connect",
        function() {

            console.log(
                "Socket connected"
            );

            socket.emit(
                "authenticate",
                token
            );
        }
    );

    socket.on(
        "authenticated",
        function() {

            joinConversation();
        }
    );

    socket.on(
        "presence",
        function(data) {

            if (
                data &&
                String(
                    data.userId
                ) ===
                String(
                    otherUser?.id
                )
            ) {

                updateOnlineStatus(
                    data.online === true,
                    data.lastSeen
                );
            }
        }
    );

    socket.on(
        "userOnline",
        function(userId) {

            if (
                String(userId) ===
                String(
                    otherUser?.id
                )
            ) {

                updateOnlineStatus(
                    true,
                    null
                );
            }
        }
    );

    socket.on(
        "userOffline",
        function(data) {

            if (
                String(
                    data?.userId
                ) ===
                String(
                    otherUser?.id
                )
            ) {

                updateOnlineStatus(
                    false,
                    data?.lastSeen
                );
            }
        }
    );

    /* =====================================
       NEW MESSAGE
    ===================================== */

    socket.on(
        "newMessage",
        function(message) {

            if (
                !message ||
                String(
                    message.conversationId
                ) !==
                String(
                    conversationId
                )
            ) {
                return;
            }

            if (
                message.id &&
                messagesCache.has(
                    String(message.id)
                )
            ) {
                return;
            }

            messagesCache.set(
                String(message.id),
                message
            );

            renderMessages();

            scrollToBottom(
                true
            );

            /*
                If receiver is currently
                viewing this chat,
                mark incoming message
                as seen.
            */

            if (
                String(
                    message.senderId
                ) !==
                String(
                    currentUser.id
                )
            ) {

                markConversationRead();
            }
        }
    );

    /* =====================================
       DELIVERED
    ===================================== */

    socket.on(
        "messageDelivered",
        function(data) {

            if (!data?.messageId) {
                return;
            }

            const message =
                messagesCache.get(
                    String(
                        data.messageId
                    )
                );

            if (message) {

                message.deliveredAt =
                    data.deliveredAt ||
                    new Date().toISOString();

                updateMessageStatus(
                    data.messageId
                );
            }
        }
    );

    /* =====================================
       SEEN
    ===================================== */

    socket.on(
        "messagesSeen",
        function(data) {

            if (
                !data ||
                String(
                    data.conversationId
                ) !==
                String(
                    conversationId
                )
            ) {
                return;
            }

            messagesCache.forEach(
                function(message) {

                    if (
                        String(
                            message.senderId
                        ) ===
                        String(
                            currentUser.id
                        )
                    ) {

                        message.seenAt =
                            data.seenAt ||
                            new Date().toISOString();

                        updateMessageStatus(
                            message.id
                        );
                    }
                }
            );
        }
    );

    /* =====================================
       TYPING
    ===================================== */

    socket.on(
        "typing",
        function(data) {

            if (
                !data ||
                String(
                    data.conversationId
                ) !==
                String(
                    conversationId
                )
            ) {
                return;
            }

            if (
                String(
                    data.userId
                ) !==
                String(
                    otherUser?.id
                )
            ) {
                return;
            }

            setTypingStatus(
                data.isTyping === true
            );
        }
    );

    /* =====================================
       SOCKET AUTH ERROR
    ===================================== */

    socket.on(
        "authError",
        function(error) {

            console.error(
                "Socket auth error:",
                error
            );
        }
    );

    /* =====================================
       DISCONNECT
    ===================================== */

    socket.on(
        "disconnect",
        function() {

            if (!isOtherTyping) {

                updateOnlineStatus(
                    false,
                    null
                );
            }
        }
    );
}

/* =========================================
   JOIN CONVERSATION
========================================= */

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
    }
}

/* =========================================
   MARK READ
========================================= */

async function markConversationRead() {

    try {

        await api(
            "/api/conversations/" +
            encodeURIComponent(
                conversationId
            ) +
            "/read",
            {
                method: "POST",
                body: "{}"
            }
        );

    } catch (error) {

        console.warn(
            "READ ERROR:",
            error.message
        );
    }
}

/* =========================================
   SEND MESSAGE
========================================= */

async function sendMessage() {

    if (isSending) {
        return;
    }

    const text =
        messageInput.value.trim();

    if (!text) {
        return;
    }

    isSending =
        true;

    sendBtn.disabled =
        true;

    try {

        const data =
            await api(
                "/api/conversations/" +
                encodeURIComponent(
                    conversationId
                ) +
                "/messages",
                {
                    method: "POST",

                    body:
                        JSON.stringify({

                            text
                        })
                }
            );

        const message =
            data.message;

        if (message?.id) {

            messagesCache.set(
                String(
                    message.id
                ),
                message
            );
        }

        messageInput.value =
            "";

        renderMessages();

        scrollToBottom(
            true
        );

        sendTyping(
            false
        );

    } catch (error) {

        console.error(
            "SEND ERROR:",
            error
        );

        alert(
            error.message ||
            "Could not send message"
        );

    } finally {

        isSending =
            false;

        sendBtn.disabled =
            false;

        messageInput.focus();
    }
}

/* =========================================
   FORM SUBMIT
========================================= */

if (messageForm) {

    messageForm.addEventListener(
        "submit",
        function(event) {

            event.preventDefault();

            sendMessage();
        }
    );
}

/* =========================================
   ENTER TO SEND
========================================= */

if (messageInput) {

    messageInput.addEventListener(
        "keydown",
        function(event) {

            if (
                event.key ===
                "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                sendMessage();
            }
        }
    );
}

/* =========================================
   TYPING INPUT
========================================= */

if (messageInput) {

    messageInput.addEventListener(
        "input",
        function() {

            sendTyping(
                true
            );

            clearTimeout(
                typingTimer
            );

            typingTimer =
                setTimeout(
                    function() {

                        sendTyping(
                            false
                        );

                    },
                    900
                );
        }
    );
}

/* =========================================
   SEND TYPING
========================================= */

function sendTyping(
    isTyping
) {

    if (
        !socket ||
        !socket.connected ||
        !conversationId
    ) {
        return;
    }

    socket.emit(
        "typing",
        {

            conversationId,

            isTyping:
                isTyping === true
        }
    );
}

/* =========================================
   TYPING STATUS
========================================= */

function setTypingStatus(
    typing
) {

    isOtherTyping =
        typing;

    if (typing) {

        onlineStatus.textContent =
            "typing...";

        onlineStatus.classList.add(
            "online"
        );

    } else {

        updateOnlineStatus(
            !!otherUser?.isOnline,
            otherUser?.lastSeen
        );
    }
}

/* =========================================
   ONLINE STATUS
========================================= */

function updateOnlineStatus(
    online,
    lastSeen
) {

    if (!onlineStatus) {
        return;
    }

    if (online) {

        onlineStatus.textContent =
            "online";

        onlineStatus.classList.add(
            "online"
        );

    } else {

        onlineStatus.classList.remove(
            "online"
        );

        if (lastSeen) {

            onlineStatus.textContent =
                "last seen " +
                formatLastSeen(
                    lastSeen
                );

        } else {

            onlineStatus.textContent =
                "offline";
        }
    }
}

/* =========================================
   FORMAT TIME
========================================= */

function formatTime(
    value
) {

    if (!value) {
        return "";
    }

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return "";
    }

    return date.toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}

/* =========================================
   LAST SEEN
========================================= */

function formatLastSeen(
    value
) {

    if (!value) {
        return "";
    }

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return "";
    }

    const diff =
        Date.now() -
        date.getTime();

    const minute =
        Math.floor(
            diff / 60000
        );

    if (
        minute < 1
    ) {

        return "just now";
    }

    if (
        minute < 60
    ) {

        return minute +
            "m ago";
    }

    const hour =
        Math.floor(
            minute / 60
        );

    if (
        hour < 24
    ) {

        return hour +
            "h ago";
    }

    return date.toLocaleDateString();
}

/* =========================================
   SCROLL
========================================= */

function scrollToBottom(
    force = false
) {

    if (!messagesEl) {
        return;
    }

    if (
        force ||
        isNearBottom()
    ) {

        requestAnimationFrame(
            function() {

                messagesEl.scrollTop =
                    messagesEl.scrollHeight;
            }
        );
    }
}

/* =========================================
   NEAR BOTTOM
========================================= */

function isNearBottom() {

    if (!messagesEl) {
        return true;
    }

    const distance =
        messagesEl.scrollHeight -
        messagesEl.scrollTop -
        messagesEl.clientHeight;

    return distance < 120;
}

/* =========================================
   ERROR
========================================= */

function showError(
    message
) {

    if (!messagesEl) {
        return;
    }

    messagesEl.innerHTML = "";

    const error =
        document.createElement(
            "div"
        );

    error.className =
        "empty-chat";

    error.textContent =
        message;

    messagesEl.appendChild(
        error
    );
}

/* =========================================
   ATTACHMENT MENU
========================================= */

if (attachmentBtn) {

    attachmentBtn.addEventListener(
        "click",
        function(event) {

            event.stopPropagation();

            attachmentMenu.classList.toggle(
                "show"
            );
        }
    );
}

document.addEventListener(
    "click",
    function(event) {

        if (
            attachmentMenu &&
            !attachmentMenu.contains(
                event.target
            ) &&
            event.target !==
            attachmentBtn
        ) {

            attachmentMenu.classList.remove(
                "show"
            );
        }
    }
);

/* =========================================
   PHOTO
========================================= */

if (photoBtn) {

    photoBtn.addEventListener(
        "click",
        function() {

            attachmentMenu.classList.remove(
                "show"
            );

            if (photoInput) {

                photoInput.click();
            }
        }
    );
}

/* =========================================
   FILE
========================================= */

if (fileBtn) {

    fileBtn.addEventListener(
        "click",
        function() {

            attachmentMenu.classList.remove(
                "show"
            );

            if (fileInput) {

                fileInput.click();
            }
        }
    );
}

/* =========================================
   CAMERA
========================================= */

if (cameraBtn) {

    cameraBtn.addEventListener(
        "click",
        function() {

            attachmentMenu.classList.remove(
                "show"
            );

            if (cameraInput) {

                cameraInput.click();
            }
        }
    );
}

/* =========================================
   PHOTO SELECTION
========================================= */

if (photoInput) {

    photoInput.addEventListener(
        "change",
        function() {

            if (
                this.files &&
                this.files.length
            ) {

                console.log(
                    "Photo selected:",
                    this.files[0].name
                );
            }
        }
    );
}

/* =========================================
   FILE SELECTION
========================================= */

if (fileInput) {

    fileInput.addEventListener(
        "change",
        function() {

            if (
                this.files &&
                this.files.length
            ) {

                console.log(
                    "File selected:",
                    this.files[0].name
                );
            }
        }
    );
}

/* =========================================
   CAMERA SELECTION
========================================= */

if (cameraInput) {

    cameraInput.addEventListener(
        "change",
        function() {

            if (
                this.files &&
                this.files.length
            ) {

                console.log(
                    "Camera image selected:",
                    this.files[0].name
                );
            }
        }
    );
}

/* =========================================
   BACK BUTTON
========================================= */

if (backBtn) {

    backBtn.addEventListener(
        "click",
        function() {

            if (
                document.referrer
            ) {

                window.history.back();

            } else {

                window.location.href =
                    "home.html";
            }
        }
    );
}

/* =========================================
   HEADER MENU
========================================= */

const chatMenuBtn =
    document.getElementById(
        "chatMenuBtn"
    );

if (chatMenuBtn) {

    chatMenuBtn.addEventListener(
        "click",
        function() {

            console.log(
                "Chat menu"
            );
        }
    );
}

/* =========================================
   START
========================================= */

initChat();
