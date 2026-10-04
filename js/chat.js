/* =========================================
   TELESUPAR - REAL CHAT
========================================= */

const API_URL =
    "https://telesupar.onrender.com";

const token =
    localStorage.getItem(
        "telesupar_token"
    );

let currentUser = null;
let socket = null;

/* =========================================
   CONVERSATION
========================================= */

const params =
    new URLSearchParams(
        window.location.search
    );

const conversationId =
    String(
        params.get("id") ||
        ""
    ).trim();

/* =========================================
   AUTH
========================================= */

try {

    const saved =
        localStorage.getItem(
            "telesupar_user"
        );

    if (saved) {

        currentUser =
            JSON.parse(
                saved
            );
    }

} catch (error) {

    console.error(
        "USER PARSE ERROR:",
        error
    );
}

if (!token) {

    window.location.replace(
        "login.html"
    );
}

if (!conversationId) {

    alert(
        "Conversation ID missing"
    );

    window.location.replace(
        "home.html"
    );
}

/* =========================================
   ELEMENTS
========================================= */

const messagesContainer =
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

const chatUserName =
    document.getElementById(
        "chatUserName"
    );

const headerAvatar =
    document.getElementById(
        "headerAvatar"
    );

const onlineStatus =
    document.getElementById(
        "onlineStatus"
    );

const backBtn =
    document.getElementById(
        "backBtn"
    );

const attachmentBtn =
    document.getElementById(
        "attachmentBtn"
    );

const attachmentMenu =
    document.getElementById(
        "attachmentMenu"
    );

/* =========================================
   API
========================================= */

async function api(
    path,
    options = {}
) {

    const headers = {
        "Authorization":
            "Bearer " + token,

        ...(options.headers || {})
    };

    if (
        options.body &&
        !headers["Content-Type"]
    ) {

        headers["Content-Type"] =
            "application/json";
    }

    const response =
        await fetch(
            API_URL + path,
            {
                ...options,
                headers
            }
        );

    let data = {};

    try {

        data =
            await response.json();

    } catch (error) {

        data = {};
    }

    if (!response.ok) {

        if (
            response.status === 401
        ) {

            localStorage.removeItem(
                "telesupar_token"
            );

            localStorage.removeItem(
                "telesupar_user"
            );

            window.location.replace(
                "login.html"
            );

            return;
        }

        throw new Error(
            data.message ||
            "Request failed"
        );
    }

    return data;
}

/* =========================================
   LOAD CONVERSATION USER
========================================= */

async function loadChatInfo() {

    try {

        const data =
            await api(
                "/api/conversations"
            );

        const chats =
            Array.isArray(
                data.conversations
            )
                ? data.conversations
                : [];

        const chat =
            chats.find(
                function(item) {

                    return String(
                        item._id ||
                        item.id ||
                        ""
                    ) ===
                    conversationId;

                }
            );

        if (
            chat &&
            (
                chat.otherUser ||
                chat.user
            )
        ) {

            const user =
                chat.otherUser ||
                chat.user;

            const name =
                user.displayName ||
                user.username ||
                "User";

            setChatUser(
                name
            );

            /*
                Store actual other user ID
                for status/read handling.
            */

            window.chatOtherUserId =
                String(
                    user.id ||
                    user._id ||
                    ""
                );

        } else {

            /*
                Fallback:
                conversation may exist but
                not yet returned due to old
                data. Try conversation endpoint
                by finding from messages/users.
            */

            setChatUser(
                "Chat"
            );
        }

    } catch (error) {

        console.error(
            "CHAT INFO ERROR:",
            error
        );

        setChatUser(
            "Chat"
        );
    }
}

/* =========================================
   SET USER
========================================= */

function setChatUser(
    name
) {

    if (chatUserName) {

        chatUserName.textContent =
            name;
    }

    if (headerAvatar) {

        headerAvatar.textContent =
            String(
                name || "?"
            )
                .charAt(0)
                .toUpperCase();
    }
}

/* =========================================
   LOAD MESSAGES
========================================= */

async function loadMessages() {

    try {

        const data =
            await api(
                "/api/conversations/" +
                encodeURIComponent(
                    conversationId
                ) +
                "/messages"
            );

        const list =
            Array.isArray(
                data.messages
            )
                ? data.messages
                : [];

        if (messagesContainer) {

            messagesContainer.innerHTML =
                "";

            if (!list.length) {

                showEmpty();

            } else {

                list.forEach(
                    function(message) {

                        renderMessage(
                            message
                        );

                    }
                );

                scrollBottom();
            }
        }

        /*
            Opening/loading chat also
            marks messages as seen.
        */

        await markAsRead();

    } catch (error) {

        console.error(
            "MESSAGE LOAD ERROR:",
            error
        );

        if (messagesContainer) {

            messagesContainer.innerHTML = `

                <div class="empty-chat">

                    ${escapeHTML(
                        error.message
                    )}

                </div>

            `;
        }
    }
}

/* =========================================
   MARK READ
========================================= */

async function markAsRead() {

    try {

        await api(
            "/api/conversations/" +
            encodeURIComponent(
                conversationId
            ) +
            "/read",
            {
                method:
                    "POST"
            }
        );

    } catch (error) {

        console.error(
            "MARK READ ERROR:",
            error
        );
    }
}

/* =========================================
   EMPTY
========================================= */

function showEmpty() {

    if (!messagesContainer) {
        return;
    }

    const empty =
        document.createElement(
            "div"
        );

    empty.className =
        "empty-chat";

    empty.textContent =
        "No messages yet. Start the conversation.";

    messagesContainer.appendChild(
        empty
    );
}

/* =========================================
   ESCAPE
========================================= */

function escapeHTML(
    value
) {

    return String(
        value || ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}

/* =========================================
   TIME
========================================= */

function formatTime(
    value
) {

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
            hour:
                "2-digit",

            minute:
                "2-digit"
        }
    );
}

/* =========================================
   RENDER MESSAGE
========================================= */

function renderMessage(
    message
) {

    if (
        !message ||
        !messagesContainer
    ) {
        return;
    }

    const messageId =
        String(
            message.id ||
            message._id ||
            ""
        );

    /*
        Prevent duplicates
    */

    if (messageId) {

        const existing =
            messagesContainer.querySelector(
                '[data-message-id="' +
                messageId +
                '"]'
            );

        if (existing) {

            updateMessageStatus(
                existing,
                message
            );

            return;
        }
    }

    const empty =
        messagesContainer.querySelector(
            ".empty-chat"
        );

    if (empty) {
        empty.remove();
    }

    const senderId =
        String(
            message.senderId ||
            ""
        );

    const myId =
        String(
            currentUser?.id ||
            currentUser?._id ||
            ""
        );

    const mine =
        senderId === myId;

    const wrapper =
        document.createElement(
            "div"
        );

    wrapper.className =
        mine
            ? "message sent"
            : "message received";

    if (messageId) {

        wrapper.dataset.messageId =
            messageId;
    }

    const bubble =
        document.createElement(
            "div"
        );

    bubble.className =
        "message-bubble";

    bubble.textContent =
        message.text ||
        "";

    const meta =
        document.createElement(
            "div"
        );

    meta.style.display =
        "flex";

    meta.style.alignItems =
        "center";

    meta.style.justifyContent =
        "flex-end";

    meta.style.gap =
        "4px";

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

    /*
        SENT MESSAGE STATUS
    */

    if (mine) {

        const ticks =
            document.createElement(
                "span"
            );

        ticks.className =
            "message-status";

        ticks.dataset.status =
            getMessageStatus(
                message
            );

        ticks.textContent =
            getStatusIcon(
                message
            );

        ticks.style.fontSize =
            "11px";

        ticks.style.fontWeight =
            "700";

        ticks.style.letterSpacing =
            "-3px";

        meta.appendChild(
            ticks
        );
    }

    wrapper.appendChild(
        bubble
    );

    wrapper.appendChild(
        meta
    );

    messagesContainer.appendChild(
        wrapper
    );
}

/* =========================================
   MESSAGE STATUS
========================================= */

function getMessageStatus(
    message
) {

    if (message.seenAt) {

        return "seen";
    }

    if (message.deliveredAt) {

        return "delivered";
    }

    return "sent";
}

function getStatusIcon(
    message
) {

    const status =
        getMessageStatus(
            message
        );

    if (
        status ===
        "seen"
    ) {

        return "✓✓";
    }

    if (
        status ===
        "delivered"
    ) {

        return "✓✓";
    }

    return "✓";
}

/* =========================================
   UPDATE MESSAGE STATUS
========================================= */

function updateMessageStatus(
    element,
    message
) {

    const statusElement =
        element.querySelector(
            ".message-status"
        );

    if (!statusElement) {
        return;
    }

    statusElement.dataset.status =
        getMessageStatus(
            message
        );

    statusElement.textContent =
        getStatusIcon(
            message
        );
}

/* =========================================
   SOCKET
========================================= */

function connectSocket() {

    if (
        typeof io ===
        "undefined"
    ) {

        console.error(
            "Socket.IO library missing"
        );

        return;
    }

    socket =
        io(
            API_URL,
            {
                transports: [
                    "websocket",
                    "polling"
                ]
            }
        );

    socket.on(
        "connect",
        function() {

            console.log(
                "Chat socket connected"
            );

            if (onlineStatus) {

                onlineStatus.textContent =
                    "Connected";

                onlineStatus.classList.add(
                    "connected"
                );
            }

            socket.emit(
                "authenticate",
                token
            );

            /*
                Join conversation.
                Backend will also mark
                incoming messages as seen.
            */

            socket.emit(
                "joinConversation",
                conversationId
            );

        }
    );

    socket.on(
        "connect_error",
        function(error) {

            console.error(
                "SOCKET ERROR:",
                error
            );

            if (onlineStatus) {

                onlineStatus.textContent =
                    "Connecting...";

                onlineStatus.classList.remove(
                    "connected"
                );
            }
        }
    );

    socket.on(
        "disconnect",
        function() {

            if (onlineStatus) {

                onlineStatus.textContent =
                    "Disconnected";

                onlineStatus.classList.remove(
                    "connected"
                );
            }
        }
    );

    /*
        REAL NEW MESSAGE
    */

    socket.on(
        "newMessage",
        function(message) {

            if (!message) {
                return;
            }

            if (
                String(
                    message.conversationId ||
                    ""
                ) !==
                conversationId
            ) {
                return;
            }

            renderMessage(
                message
            );

            scrollBottom();

            /*
                If this is from the
                other user, immediately
                mark it read because
                this chat is open.
            */

            const myId =
                String(
                    currentUser?.id ||
                    currentUser?._id ||
                    ""
                );

            if (
                String(
                    message.senderId ||
                    ""
                ) !==
                myId
            ) {

                markAsRead();
            }
        }
    );

    /*
        MESSAGE DELIVERED
    */

    socket.on(
        "messageDelivered",
        function(data) {

            if (!data) {
                return;
            }

            if (
                String(
                    data.conversationId ||
                    ""
                ) !==
                conversationId
            ) {
                return;
            }

            const element =
                messagesContainer?.querySelector(
                    '[data-message-id="' +
                    data.messageId +
                    '"]'
                );

            if (!element) {
                return;
            }

            const status =
                element.querySelector(
                    ".message-status"
                );

            if (status) {

                status.textContent =
                    "✓✓";

                status.dataset.status =
                    "delivered";
            }
        }
    );

    /*
        MESSAGE SEEN
    */

    socket.on(
        "messagesSeen",
        function(data) {

            if (!data) {
                return;
            }

            if (
                String(
                    data.conversationId ||
                    ""
                ) !==
                conversationId
            ) {
                return;
            }

            if (!messagesContainer) {
                return;
            }

            const sentMessages =
                messagesContainer.querySelectorAll(
                    ".message.sent"
                );

            sentMessages.forEach(
                function(message) {

                    const status =
                        message.querySelector(
                            ".message-status"
                        );

                    if (status) {

                        status.textContent =
                            "✓✓";

                        status.dataset.status =
                            "seen";
                    }
                }
            );
        }
    );

    /*
        USER ONLINE
    */

    socket.on(
        "userOnline",
        function(userId) {

            if (
                String(userId) ===
                String(
                    window.chatOtherUserId ||
                    ""
                )
            ) {

                if (onlineStatus) {

                    onlineStatus.textContent =
                        "Online";

                    onlineStatus.classList.add(
                        "connected"
                    );
                }
            }
        }
    );

    /*
        USER OFFLINE
    */

    socket.on(
        "userOffline",
        function(userId) {

            if (
                String(userId) ===
                String(
                    window.chatOtherUserId ||
                    ""
                )
            ) {

                if (onlineStatus) {

                    onlineStatus.textContent =
                        "Offline";

                    onlineStatus.classList.remove(
                        "connected"
                    );
                }
            }
        }
    );
}

/* =========================================
   SEND MESSAGE
========================================= */

if (messageForm) {

    messageForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            if (!messageInput) {
                return;
            }

            const text =
                messageInput.value.trim();

            if (!text) {
                return;
            }

            const sendButton =
                document.getElementById(
                    "sendBtn"
                );

            messageInput.disabled =
                true;

            if (sendButton) {
                sendButton.disabled =
                    true;
            }

            try {

                await api(
                    "/api/conversations/" +
                    encodeURIComponent(
                        conversationId
                    ) +
                    "/messages",
                    {
                        method:
                            "POST",

                        body:
                            JSON.stringify({
                                text
                            })
                    }
                );

                /*
                    DO NOT manually render.
                    Socket newMessage will
                    render it once.
                */

                messageInput.value =
                    "";

                messageInput.focus();

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

                messageInput.disabled =
                    false;

                if (sendButton) {
                    sendButton.disabled =
                        false;
                }

                messageInput.focus();
            }

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

                if (messageForm) {

                    messageForm.requestSubmit();
                }
            }
        }
    );
}

/* =========================================
   BACK
========================================= */

if (backBtn) {

    backBtn.addEventListener(
        "click",
        function() {

            if (socket) {

                socket.emit(
                    "leaveConversation",
                    conversationId
                );

                socket.disconnect();
            }

            window.location.href =
                "home.html";
        }
    );
}

/* =========================================
   ATTACHMENT
========================================= */

if (attachmentBtn) {

    attachmentBtn.addEventListener(
        "click",
        function(event) {

            event.stopPropagation();

            if (attachmentMenu) {

                attachmentMenu.classList.toggle(
                    "show"
                );
            }
        }
    );
}

document.addEventListener(
    "click",
    function() {

        if (attachmentMenu) {

            attachmentMenu.classList.remove(
                "show"
            );
        }
    }
);

/* =========================================
   SCROLL
========================================= */

function scrollBottom() {

    if (!messagesContainer) {
        return;
    }

    requestAnimationFrame(
        function() {

            messagesContainer.scrollTop =
                messagesContainer.scrollHeight;

        }
    );
}

/* =========================================
   START
========================================= */

async function startChat() {

    await loadChatInfo();

    await loadMessages();

    connectSocket();
}

startChat();
