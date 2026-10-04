const API =
    "https://telesupar.onrender.com";

const token =
    localStorage.getItem(
        "telesupar_token"
    );

const storedUser =
    localStorage.getItem(
        "telesupar_user"
    );

let currentUser = null;
let conversationId = null;
let otherUser = null;
let socket = null;

let messagesCache =
    new Map();

let isSending = false;
let typingTimer = null;


/* =========================================
   DOM
========================================= */

const messagesEl =
    document.getElementById(
        "messages"
    );

const form =
    document.getElementById(
        "messageForm"
    );

const input =
    document.getElementById(
        "messageInput"
    );

const sendBtn =
    document.getElementById(
        "sendBtn"
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
   AUTH
========================================= */

if (
    !token ||
    !storedUser
) {

    window.location.href =
        "login.html";
}

try {

    currentUser =
        JSON.parse(
            storedUser
        );

} catch {

    localStorage.removeItem(
        "telesupar_token"
    );

    localStorage.removeItem(
        "telesupar_user"
    );

    window.location.href =
        "login.html";
}


/* =========================================
   CHAT ID
========================================= */

const params =
    new URLSearchParams(
        window.location.search
    );

conversationId =
    params.get("id") ||
    params.get("conversationId");


/* =========================================
   API
========================================= */

async function api(
    url,
    options = {}
) {

    const headers = {

        Authorization:
            `Bearer ${token}`,

        ...(options.headers || {})
    };

    if (
        options.body &&
        typeof options.body !==
        "string"
    ) {

        headers[
            "Content-Type"
        ] =
            "application/json";

        options.body =
            JSON.stringify(
                options.body
            );
    }

    const response =
        await fetch(
            API + url,
            {
                ...options,
                headers
            }
        );

    let data = null;

    try {

        data =
            await response.json();

    } catch {

        data = null;
    }

    if (!response.ok) {

        if (
            response.status ===
            401
        ) {

            localStorage.removeItem(
                "telesupar_token"
            );

            localStorage.removeItem(
                "telesupar_user"
            );

            window.location.href =
                "login.html";

            return;
        }

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
            "Chat ID not found."
        );

        return;
    }

    try {

        setLoading();

        await loadConversationInfo();

        await loadMessages();

        connectSocket();

        markConversationRead();

        setTimeout(
            () => {
                scrollToBottom(
                    false
                );
            },
            100
        );

    } catch (error) {

        console.error(
            error
        );

        showError(
            error.message ||
            "Could not load chat."
        );
    }
}


/* =========================================
   LOAD CONVERSATION INFO
========================================= */

async function loadConversationInfo() {

    const data =
        await api(
            "/api/conversations"
        );

    let list = [];

    if (
        Array.isArray(data)
    ) {

        list = data;

    } else if (
        Array.isArray(
            data?.conversations
        )
    ) {

        list =
            data.conversations;
    }

    const conversation =
        list.find(
            item => {

                const id =
                    item.id ||
                    item._id;

                return (
                    String(id) ===
                    String(
                        conversationId
                    )
                );
            }
        );

    if (!conversation) {

        throw new Error(
            "Conversation not found."
        );
    }

    otherUser =
        conversation.otherUser ||
        conversation.user ||
        null;

    if (!otherUser) {

        throw new Error(
            "Chat user not found."
        );
    }

    updateHeader();
}


/* =========================================
   HEADER
========================================= */

function updateHeader() {

    const name =
        otherUser.displayName ||
        otherUser.name ||
        otherUser.username ||
        "Unknown User";

    chatUserName.textContent =
        name;

    headerAvatar.textContent =
        name
            .trim()
            .charAt(0)
            .toUpperCase() ||
        "?";

    /*
        IMPORTANT:

        Don't always show offline.

        Backend now returns isOnline.
    */

    if (
        otherUser.isOnline === true
    ) {

        setOnline();

    } else {

        setOffline(
            otherUser.lastSeen
        );
    }
}


/* =========================================
   LOAD MESSAGES
========================================= */

async function loadMessages() {

    const data =
        await api(
            `/api/conversations/${encodeURIComponent(
                conversationId
            )}/messages`
        );

    let list = [];

    if (
        Array.isArray(data)
    ) {

        list = data;

    } else if (
        Array.isArray(
            data?.messages
        )
    ) {

        list =
            data.messages;
    }

    messagesCache.clear();

    list.forEach(
        message => {

            const id =
                message.id ||
                message._id;

            if (id) {

                messagesCache.set(
                    String(id),
                    message
                );
            }
        }
    );

    renderMessages();

    await markConversationRead();
}


/* =========================================
   RENDER MESSAGES
========================================= */

function renderMessages() {

    messagesEl.innerHTML =
        "";

    if (
        messagesCache.size ===
        0
    ) {

        messagesEl.innerHTML = `
            <div class="empty-chat">
                <div>
                    <div style="
                        font-size:30px;
                        margin-bottom:8px;
                    ">💬</div>

                    <div>
                        No messages yet
                    </div>

                    <div style="
                        margin-top:5px;
                        font-size:11px;
                    ">
                        Start the conversation
                    </div>
                </div>
            </div>
        `;

        return;
    }

    const list =
        Array.from(
            messagesCache.values()
        ).sort(
            (a,b) =>
                getMessageTime(a) -
                getMessageTime(b)
        );

    let lastDate = null;

    list.forEach(
        message => {

            const dateKey =
                getDateKey(
                    message
                );

            if (
                dateKey !==
                lastDate
            ) {

                addDateSeparator(
                    formatDateSeparator(
                        getMessageTime(
                            message
                        )
                    )
                );

                lastDate =
                    dateKey;
            }

            messagesEl.appendChild(
                createMessageElement(
                    message
                )
            );
        }
    );
}


/* =========================================
   MESSAGE ELEMENT
========================================= */

function createMessageElement(
    message
) {

    const senderId =
        getSenderId(
            message
        );

    const isMine =
        String(senderId) ===
        String(
            currentUser.id
        );

    const wrapper =
        document.createElement(
            "div"
        );

    wrapper.className =
        `message ${
            isMine
                ? "sent"
                : "received"
        }`;

    const bubble =
        document.createElement(
            "div"
        );

    bubble.className =
        "message-bubble";

    bubble.textContent =
        message.text ||
        "";

    wrapper.appendChild(
        bubble
    );

    const meta =
        document.createElement(
            "div"
        );

    meta.className =
        "message-time";

    const time =
        formatTime(
            getMessageTime(
                message
            )
        );

    if (isMine) {

        const status =
            getStatus(
                message
            );

        meta.innerHTML = `
            ${time}
            <span
                class="message-status"
                style="
                    color:${status.color};
                    font-weight:700;
                    margin-left:3px;
                    letter-spacing:-2px;
                "
            >
                ${status.icon}
            </span>
        `;

    } else {

        meta.textContent =
            time;
    }

    wrapper.appendChild(
        meta
    );

    return wrapper;
}


/* =========================================
   MESSAGE STATUS
========================================= */

function getStatus(
    message
) {

    /*
        SENT

        Server accepted message,
        but receiver isn't connected.
    */

    if (
        !message.deliveredAt &&
        !message.seenAt
    ) {

        return {

            icon:
                "✓",

            color:
                "#d0d7e2"
        };
    }

    /*
        SEEN

        Seen is always checked
        BEFORE delivered.
    */

    if (
        message.seenAt
    ) {

        return {

            icon:
                "✓✓",

            color:
                "#4fa3ff"
        };
    }

    /*
        DELIVERED
    */

    if (
        message.deliveredAt
    ) {

        return {

            icon:
                "✓✓",

            color:
                "#e5ebf5"
        };
    }

    return {

        icon:
            "✓",

        color:
            "#d0d7e2"
    };
}


/* =========================================
   SOCKET
========================================= */

function connectSocket() {

    if (
        typeof io ===
        "undefined"
    ) {

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
                    Infinity,

                reconnectionDelay:
                    1000,

                reconnectionDelayMax:
                    5000
            }
        );

    socket.on(
        "connect",
        () => {

            console.log(
                "TELESUPAR socket connected"
            );

            socket.emit(
                "authenticate",
                token
            );

            socket.emit(
                "joinConversation",
                conversationId
            );

            markConversationRead();
        }
    );

    socket.on(
        "disconnect",
        () => {

            /*
                Don't immediately say
                other user is offline.

                Server will tell us.
            */
        }
    );

    socket.on(
        "connect_error",
        error => {

            console.warn(
                "Socket error:",
                error.message
            );
        }
    );


    /* =====================================
       PRESENCE
    ====================================== */

    socket.on(
        "presence",
        data => {

            if (
                String(
                    data?.userId
                ) ===
                String(
                    getOtherUserId()
                )
            ) {

                if (
                    data.online
                ) {

                    setOnline();

                } else {

                    setOffline(
                        data.lastSeen
                    );
                }
            }
        }
    );


    socket.on(
        "userOnline",
        userId => {

            if (
                String(userId) ===
                String(
                    getOtherUserId()
                )
            ) {

                setOnline();
            }
        }
    );


    socket.on(
        "userOffline",
        data => {

            const userId =
                typeof data ===
                "string"

                    ? data

                    : data?.userId;

            if (
                String(userId) ===
                String(
                    getOtherUserId()
                )
            ) {

                setOffline(
                    data?.lastSeen
                );
            }
        }
    );


    /* =====================================
       NEW MESSAGE
    ====================================== */

    socket.on(
        "newMessage",
        message => {

            if (!message) {
                return;
            }

            if (
                String(
                    message.conversationId
                ) !==
                String(
                    conversationId
                )
            ) {

                return;
            }

            const id =
                message.id ||
                message._id;

            if (!id) {
                return;
            }

            if (
                messagesCache.has(
                    String(id)
                )
            ) {

                /*
                    Existing message may
                    have updated delivery
                    state.
                */

                messagesCache.set(
                    String(id),
                    message
                );

                renderMessages();

                return;
            }

            messagesCache.set(
                String(id),
                message
            );

            renderMessages();

            scrollToBottom(
                true
            );

            if (
                String(
                    getSenderId(
                        message
                    )
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
    ====================================== */

    socket.on(
        "messageDelivered",
        payload => {

            const id =
                payload?.messageId;

            if (!id) {
                return;
            }

            const message =
                messagesCache.get(
                    String(id)
                );

            if (!message) {
                return;
            }

            message.deliveredAt =
                payload.deliveredAt ||
                new Date();

            messagesCache.set(
                String(id),
                message
            );

            renderMessages();
        }
    );


    /* =====================================
       SEEN
    ====================================== */

    socket.on(
        "messagesSeen",
        payload => {

            if (
                String(
                    payload?.conversationId
                ) !==
                String(
                    conversationId
                )
            ) {

                return;
            }

            const seenAt =
                payload.seenAt ||
                new Date();

            messagesCache.forEach(
                message => {

                    if (
                        String(
                            getSenderId(
                                message
                            )
                        ) ===
                        String(
                            currentUser.id
                        )
                    ) {

                        /*
                            Only messages
                            before/equal seen
                            time should become
                            seen.
                        */

                        const messageTime =
                            getMessageTime(
                                message
                            );

                        const seenTime =
                            new Date(
                                seenAt
                            ).getTime();

                        if (
                            messageTime <=
                            seenTime
                        ) {

                            message.seenAt =
                                seenAt;
                        }
                    }
                }
            );

            renderMessages();
        }
    );


    /* =====================================
       TYPING
    ====================================== */

    socket.on(
        "typing",
        data => {

            if (
                String(
                    data?.conversationId
                ) !==
                String(
                    conversationId
                )
            ) {

                return;
            }

            if (
                String(
                    data?.userId
                ) !==
                String(
                    getOtherUserId()
                )
            ) {

                return;
            }

            if (
                data.isTyping
            ) {

                onlineStatus.textContent =
                    "typing...";

                onlineStatus.classList.remove(
                    "connected"
                );

            } else {

                updatePresenceFromUser();
            }
        }
    );
}


/* =========================================
   READ
========================================= */

async function markConversationRead() {

    if (!conversationId) {
        return;
    }

    try {

        await api(
            `/api/conversations/${encodeURIComponent(
                conversationId
            )}/read`,
            {
                method:
                    "POST"
            }
        );

    } catch (error) {

        console.warn(
            "Read error:",
            error.message
        );
    }
}


/* =========================================
   SEND
========================================= */

async function sendMessage() {

    if (isSending) {
        return;
    }

    const text =
        input.value.trim();

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
                `/api/conversations/${encodeURIComponent(
                    conversationId
                )}/messages`,
                {
                    method:
                        "POST",

                    body: {
                        text
                    }
                }
            );

        const message =
            data?.message;

        if (message) {

            const id =
                message.id ||
                message._id;

            if (id) {

                messagesCache.set(
                    String(id),
                    message
                );
            }
        }

        input.value =
            "";

        renderMessages();

        scrollToBottom(
            true
        );

    } catch (error) {

        console.error(
            error
        );

        showTemporaryError(
            error.message ||
            "Message failed."
        );

    } finally {

        isSending =
            false;

        sendBtn.disabled =
            false;

        input.focus();
    }
}


/* =========================================
   FORM
========================================= */

form?.addEventListener(
    "submit",
    function(event) {

        event.preventDefault();

        sendMessage();
    }
);


/* =========================================
   ENTER
========================================= */

input?.addEventListener(
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


/* =========================================
   TYPING
========================================= */

input?.addEventListener(
    "input",
    function() {

        if (
            !socket ||
            !socket.connected
        ) {

            return;
        }

        socket.emit(
            "typing",
            {
                conversationId,

                isTyping:
                    true
            }
        );

        clearTimeout(
            typingTimer
        );

        typingTimer =
            setTimeout(
                function() {

                    socket.emit(
                        "typing",
                        {
                            conversationId,

                            isTyping:
                                false
                        }
                    );

                },
                1200
            );
    }
);


/* =========================================
   PRESENCE UI
========================================= */

function setOnline() {

    onlineStatus.textContent =
        "online";

    onlineStatus.classList.add(
        "connected"
    );
}


function setOffline(
    lastSeen
) {

    onlineStatus.classList.remove(
        "connected"
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


function updatePresenceFromUser() {

    if (
        otherUser?.isOnline
    ) {

        setOnline();

    } else {

        setOffline(
            otherUser?.lastSeen
        );
    }
}


function formatLastSeen(
    value
) {

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "recently";
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
   IDS
========================================= */

function getSenderId(
    message
) {

    return (
        message.senderId ||
        message.sender?._id ||
        message.sender?.id ||
        message.userId
    );
}


function getOtherUserId() {

    return (
        otherUser?.id ||
        otherUser?._id ||
        otherUser?.userId
    );
}


/* =========================================
   TIME
========================================= */

function getMessageTime(
    message
) {

    return new Date(
        message.createdAt ||
        message.timestamp ||
        message.sentAt ||
        Date.now()
    ).getTime();
}


function formatTime(
    timestamp
) {

    return new Date(
        timestamp
    ).toLocaleTimeString(
        [],
        {
            hour:
                "2-digit",

            minute:
                "2-digit"
        }
    );
}


function getDateKey(
    message
) {

    const date =
        new Date(
            getMessageTime(
                message
            )
        );

    return [
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
    ].join("-");
}


function formatDateSeparator(
    timestamp
) {

    const date =
        new Date(timestamp);

    const today =
        new Date();

    const yesterday =
        new Date();

    yesterday.setDate(
        yesterday.getDate() - 1
    );

    if (
        date.toDateString() ===
        today.toDateString()
    ) {

        return "Today";
    }

    if (
        date.toDateString() ===
        yesterday.toDateString()
    ) {

        return "Yesterday";
    }

    return date.toLocaleDateString(
        [],
        {
            day:
                "numeric",

            month:
                "short",

            year:
                "numeric"
        }
    );
}


/* =========================================
   DATE SEPARATOR
========================================= */

function addDateSeparator(
    text
) {

    const separator =
        document.createElement(
            "div"
        );

    separator.style.textAlign =
        "center";

    separator.style.margin =
        "15px 0";

    separator.style.color =
        "#687384";

    separator.style.fontSize =
        "11px";

    separator.textContent =
        text;

    messagesEl.appendChild(
        separator
    );
}


/* =========================================
   SCROLL
========================================= */

function scrollToBottom(
    smooth = true
) {

    requestAnimationFrame(
        function() {

            messagesEl.scrollTo({

                top:
                    messagesEl.scrollHeight,

                behavior:
                    smooth
                        ? "smooth"
                        : "auto"
            });
        }
    );
}


/* =========================================
   LOADING
========================================= */

function setLoading() {

    messagesEl.innerHTML = `
        <div class="empty-chat">
            Loading messages...
        </div>
    `;
}


/* =========================================
   ERROR
========================================= */

function showError(
    message
) {

    messagesEl.innerHTML = `
        <div class="empty-chat">
            <div>
                ⚠️
                <br><br>
                ${escapeHTML(message)}
            </div>
        </div>
    `;
}


function showTemporaryError(
    message
) {

    const toast =
        document.createElement(
            "div"
        );

    toast.textContent =
        message;

    Object.assign(
        toast.style,
        {

            position:
                "fixed",

            left:
                "50%",

            bottom:
                "95px",

            transform:
                "translateX(-50%)",

            background:
                "#2a1115",

            color:
                "#ffb8c0",

            padding:
                "10px 14px",

            borderRadius:
                "12px",

            fontSize:
                "12px",

            zIndex:
                "9999"
        }
    );

    document.body.appendChild(
        toast
    );

    setTimeout(
        () => {
            toast.remove();
        },
        2500
    );
}


/* =========================================
   ESCAPE
========================================= */

function escapeHTML(
    value
) {

    return String(value)

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );
}


/* =========================================
   ATTACHMENT MENU
========================================= */

attachmentBtn?.addEventListener(
    "click",
    function(event) {

        event.stopPropagation();

        attachmentMenu?.classList.toggle(
            "show"
        );
    }
);


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
   BACK
========================================= */

backBtn?.addEventListener(
    "click",
    function() {

        window.location.href =
            "home.html";
    }
);


/* =========================================
   START
========================================= */

initChat();
