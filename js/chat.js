/* =========================================================
   TELESUPAR
   CHAT.JS
   STEP 1 — STABLE 1 TO 1 CHAT
========================================================= */

const API = "https://telesupar.onrender.com";

const token =
    localStorage.getItem("telesupar_token");

const storedUser =
    localStorage.getItem("telesupar_user");

let currentUser = null;

let conversationId = null;

let otherUser = null;

let socket = null;

let messagesCache = new Map();

let isSending = false;

let typingTimer = null;

let otherUserTyping = false;


/* =========================================================
   DOM
========================================================= */

const messagesEl =
    document.getElementById("messages");

const form =
    document.getElementById("messageForm");

const input =
    document.getElementById("messageInput");

const sendBtn =
    document.getElementById("sendBtn");

const chatUserName =
    document.getElementById("chatUserName");

const headerAvatar =
    document.getElementById("headerAvatar");

const onlineStatus =
    document.getElementById("onlineStatus");

const backBtn =
    document.getElementById("backBtn");

const attachmentBtn =
    document.getElementById("attachmentBtn");

const attachmentMenu =
    document.getElementById("attachmentMenu");

const photoBtn =
    document.getElementById("photoBtn");

const fileBtn =
    document.getElementById("fileBtn");

const cameraBtn =
    document.getElementById("cameraBtn");


/* =========================================================
   AUTH
========================================================= */

if (!token || !storedUser) {

    window.location.href =
        "login.html";
}

try {

    currentUser =
        JSON.parse(storedUser);

} catch (error) {

    localStorage.removeItem(
        "telesupar_user"
    );

    localStorage.removeItem(
        "telesupar_token"
    );

    window.location.href =
        "login.html";
}


/* =========================================================
   CHAT ID
========================================================= */

const params =
    new URLSearchParams(
        window.location.search
    );

conversationId =
    params.get("id") ||
    params.get("conversationId");


/* =========================================================
   API
========================================================= */

async function api(
    url,
    options = {}
) {

    const headers = {

        "Authorization":
            `Bearer ${token}`,

        ...(options.headers || {})
    };


    if (
        options.body &&
        typeof options.body !== "string"
    ) {

        headers["Content-Type"] =
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

        if (response.status === 401) {

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
            data?.error ||
            "Request failed"
        );
    }


    return data;
}


/* =========================================================
   INIT
========================================================= */

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
                scrollToBottom(false);
            },
            100
        );

    } catch (error) {

        console.error(
            "Chat initialization error:",
            error
        );

        showError(
            error.message ||
            "Could not load chat."
        );
    }
}


/* =========================================================
   LOAD CONVERSATION
========================================================= */

async function loadConversationInfo() {

    const data =
        await api(
            "/api/conversations"
        );


    let conversations = [];


    if (Array.isArray(data)) {

        conversations = data;

    } else if (
        Array.isArray(
            data?.conversations
        )
    ) {

        conversations =
            data.conversations;

    } else if (
        Array.isArray(data?.data)
    ) {

        conversations =
            data.data;
    }


    const conversation =
        conversations.find(
            item => {

                const id =
                    item.id ||
                    item._id ||
                    item.conversationId;

                return (
                    String(id) ===
                    String(conversationId)
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
        conversation.receiver ||
        null;


    if (!otherUser) {

        const members =
            conversation.members || [];


        otherUser =
            members.find(
                member => {

                    const id =
                        member.id ||
                        member._id ||
                        member.userId;

                    return (
                        String(id) !==
                        String(currentUser.id)
                    );
                }
            ) || null;
    }


    if (!otherUser) {

        throw new Error(
            "Chat user not found."
        );
    }


    updateHeader();
}


/* =========================================================
   HEADER
========================================================= */

function updateHeader() {

    const name =
        otherUser?.displayName ||
        otherUser?.name ||
        otherUser?.username ||
        "Unknown User";


    chatUserName.textContent =
        name;


    const avatar =
        name
            .trim()
            .charAt(0)
            .toUpperCase() ||
        "?";


    headerAvatar.textContent =
        avatar;


    setOffline();
}


/* =========================================================
   LOAD MESSAGES
========================================================= */

async function loadMessages() {

    const data =
        await api(
            `/api/conversations/${encodeURIComponent(conversationId)}/messages`
        );


    let list = [];


    if (Array.isArray(data)) {

        list = data;

    } else if (
        Array.isArray(data?.messages)
    ) {

        list = data.messages;

    } else if (
        Array.isArray(data?.data)
    ) {

        list = data.data;
    }


    messagesCache.clear();


    list.forEach(
        message => {

            const id =
                message.id ||
                message._id ||
                message.messageId;


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


/* =========================================================
   RENDER
========================================================= */

function renderMessages() {

    messagesEl.innerHTML = "";


    if (messagesCache.size === 0) {

        messagesEl.innerHTML = `
            <div class="empty-chat">
                <div>
                    <div style="
                        font-size:30px;
                        margin-bottom:8px;
                    ">
                        💬
                    </div>

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
                getDateKey(message);


            if (
                dateKey !== lastDate
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


/* =========================================================
   MESSAGE ELEMENT
========================================================= */

function createMessageElement(
    message
) {

    const senderId =
        getSenderId(message);


    const isMine =
        String(senderId) ===
        String(currentUser.id);


    const wrapper =
        document.createElement("div");


    wrapper.className =
        `message ${
            isMine
                ? "sent"
                : "received"
        }`;


    const bubble =
        document.createElement("div");


    bubble.className =
        "message-bubble";


    bubble.textContent =
        message.text ??
        message.message ??
        "";


    wrapper.appendChild(
        bubble
    );


    const meta =
        document.createElement("div");


    meta.className =
        "message-time";


    const time =
        formatTime(
            getMessageTime(message)
        );


    if (isMine) {

        meta.innerHTML =
            `${time} <span class="message-status">${getStatus(message)}</span>`;

    } else {

        meta.textContent =
            time;
    }


    wrapper.appendChild(
        meta
    );


    wrapper.dataset.messageId =
        message.id ||
        message._id ||
        "";


    return wrapper;
}


/* =========================================================
   DATE
========================================================= */

function addDateSeparator(
    text
) {

    const separator =
        document.createElement("div");


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


/* =========================================================
   SEND
========================================================= */

async function sendMessage() {

    if (isSending) return;


    const text =
        input.value.trim();


    if (!text) return;


    if (!conversationId) {

        showTemporaryError(
            "Conversation not found."
        );

        return;
    }


    isSending = true;

    setSendLoading(true);


    try {

        const data =
            await api(
                `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
                {
                    method:"POST",

                    body:{
                        text
                    }
                }
            );


        const message =
            data?.message ||
            data?.data ||
            data;


        if (message) {

            const id =
                message.id ||
                message._id ||
                message.messageId;


            if (id) {

                messagesCache.set(
                    String(id),
                    message
                );
            }
        }


        input.value = "";


        renderMessages();

        scrollToBottom(true);


    } catch(error) {

        console.error(
            "Send message error:",
            error
        );


        showTemporaryError(
            error.message ||
            "Message failed to send."
        );

    } finally {

        isSending = false;

        setSendLoading(false);

        input.focus();
    }
}


/* =========================================================
   FORM
========================================================= */

if (form) {

    form.addEventListener(
        "submit",
        event => {

            event.preventDefault();

            sendMessage();
        }
    );
}


/* =========================================================
   ENTER
========================================================= */

if (input) {

    input.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                sendMessage();
            }
        }
    );


    input.addEventListener(
        "input",
        handleTyping
    );
}


/* =========================================================
   SOCKET
========================================================= */

function connectSocket() {

    if (
        typeof io ===
        "undefined"
    ) {

        setOffline();

        return;
    }


    socket =
        io(
            API,
            {
                transports:[
                    "websocket",
                    "polling"
                ],

                reconnection:true,

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


            setOnline();


            socket.emit(
                "authenticate",
                {
                    token
                }
            );


            socket.emit(
                "joinConversation",
                {
                    conversationId
                }
            );


            markConversationRead();
        }
    );


    socket.on(
        "disconnect",
        () => {

            setOffline();
        }
    );


    socket.on(
        "connect_error",
        error => {

            console.warn(
                "Socket error:",
                error.message
            );

            setOffline();
        }
    );


    /* =====================================
       NEW MESSAGE
    ====================================== */

    socket.on(
        "newMessage",
        message => {

            if (!message) return;


            const messageConversationId =
                message.conversationId ||
                message.chatId;


            if (
                messageConversationId &&
                String(
                    messageConversationId
                ) !==
                String(
                    conversationId
                )
            ) {

                return;
            }


            const id =
                message.id ||
                message._id ||
                message.messageId;


            if (!id) return;


            if (
                messagesCache.has(
                    String(id)
                )
            ) {

                return;
            }


            messagesCache.set(
                String(id),
                message
            );


            renderMessages();

            scrollToBottom(true);


            if (
                String(
                    getSenderId(message)
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
                payload?.messageId ||
                payload?.id;


            if (!id) return;


            const message =
                messagesCache.get(
                    String(id)
                );


            if (!message) return;


            message.deliveredAt =
                payload.deliveredAt ||
                new Date().toISOString();


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
                payload?.conversationId &&
                String(
                    payload.conversationId
                ) !==
                String(
                    conversationId
                )
            ) {

                return;
            }


            const seenAt =
                payload?.seenAt ||
                new Date().toISOString();


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

                        message.seenAt =
                            seenAt;
                    }
                }
            );


            renderMessages();
        }
    );


    /* =====================================
       ONLINE
    ====================================== */

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


    /* =====================================
       OFFLINE
    ====================================== */

    socket.on(
        "userOffline",
        userId => {

            if (
                String(userId) ===
                String(
                    getOtherUserId()
                )
            ) {

                setOffline();
            }
        }
    );


    /* =====================================
       TYPING
    ====================================== */

    socket.on(
        "typing",
        payload => {

            if (
                payload?.conversationId &&
                String(
                    payload.conversationId
                ) !==
                String(
                    conversationId
                )
            ) {

                return;
            }


            if (
                String(
                    payload?.userId
                ) !==
                String(
                    getOtherUserId()
                )
            ) {

                return;
            }


            showTyping(
                payload?.isTyping === true
            );
        }
    );
}


/* =========================================================
   READ
========================================================= */

async function markConversationRead() {

    if (!conversationId) return;


    try {

        await api(
            `/api/conversations/${encodeURIComponent(conversationId)}/read`,
            {
                method:"POST"
            }
        );

    } catch(error) {

        console.warn(
            "Read status error:",
            error.message
        );
    }
}


/* =========================================================
   TYPING
========================================================= */

function handleTyping() {

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
            isTyping:true
        }
    );


    clearTimeout(
        typingTimer
    );


    typingTimer =
        setTimeout(
            () => {

                socket.emit(
                    "typing",
                    {
                        conversationId,
                        isTyping:false
                    }
                );

            },
            1200
        );
}


function showTyping(
    isTyping
) {

    if (!onlineStatus) return;


    if (isTyping) {

        otherUserTyping =
            true;


        onlineStatus.textContent =
            "typing...";


        onlineStatus.classList.remove(
            "connected"
        );

    } else {

        otherUserTyping =
            false;

        setOnline();
    }
}


/* =========================================================
   STATUS
========================================================= */

function getStatus(
    message
) {

    if (message.seenAt) {

        return "✓✓";
    }


    if (
        message.deliveredAt ||
        message.status ===
        "delivered"
    ) {

        return "✓✓";
    }


    return "✓";
}


/* =========================================================
   ONLINE
========================================================= */

function setOnline() {

    if (!onlineStatus) return;


    onlineStatus.textContent =
        "online";


    onlineStatus.classList.add(
        "connected"
    );
}


function setOffline() {

    if (!onlineStatus) return;


    onlineStatus.textContent =
        "offline";


    onlineStatus.classList.remove(
        "connected"
    );
}


/* =========================================================
   SEND LOADING
========================================================= */

function setSendLoading(
    loading
) {

    if (!sendBtn) return;


    sendBtn.disabled =
        loading;


    sendBtn.style.opacity =
        loading
            ? "0.55"
            : "1";
}


/* =========================================================
   SCROLL
========================================================= */

function scrollToBottom(
    smooth = true
) {

    if (!messagesEl) return;


    requestAnimationFrame(
        () => {

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


/* =========================================================
   TIME
========================================================= */

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
            hour:"2-digit",
            minute:"2-digit"
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
            day:"numeric",
            month:"short",
            year:"numeric"
        }
    );
}


/* =========================================================
   IDS
========================================================= */

function getSenderId(
    message
) {

    return (
        message.senderId ||
        message.sender?._id ||
        message.sender?.id ||
        message.userId ||
        message.from
    );
}


function getOtherUserId() {

    return (
        otherUser?.id ||
        otherUser?._id ||
        otherUser?.userId
    );
}


/* =========================================================
   LOADING
========================================================= */

function setLoading() {

    if (!messagesEl) return;


    messagesEl.innerHTML = `
        <div class="empty-chat">
            Loading messages...
        </div>
    `;
}


/* =========================================================
   ERROR
========================================================= */

function showError(
    message
) {

    if (!messagesEl) return;


    messagesEl.innerHTML = `
        <div class="empty-chat">
            <div>

                <div style="
                    font-size:28px;
                    margin-bottom:8px;
                ">
                    ⚠️
                </div>

                <div>
                    ${escapeHTML(message)}
                </div>

            </div>
        </div>
    `;
}


function showTemporaryError(
    message
) {

    const old =
        document.querySelector(
            ".chat-error-toast"
        );


    if (old) old.remove();


    const toast =
        document.createElement(
            "div"
        );


    toast.className =
        "chat-error-toast";


    toast.textContent =
        message;


    Object.assign(
        toast.style,
        {

            position:"fixed",

            left:"50%",

            bottom:"92px",

            transform:
                "translateX(-50%)",

            background:"#2a1115",

            color:"#ffb8c0",

            border:
                "1px solid rgba(255,100,120,.25)",

            padding:
                "10px 14px",

            borderRadius:"12px",

            fontSize:"12px",

            zIndex:"9999",

            maxWidth:"90%",

            textAlign:"center"
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


/* =========================================================
   ESCAPE
========================================================= */

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


/* =========================================================
   ATTACHMENT MENU
========================================================= */

if (attachmentBtn) {

    attachmentBtn.addEventListener(
        "click",
        event => {

            event.stopPropagation();


            attachmentMenu?.classList.toggle(
                "show"
            );
        }
    );
}


document.addEventListener(
    "click",
    event => {

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


/* =========================================================
   ATTACHMENT PLACEHOLDERS
========================================================= */

photoBtn?.addEventListener(
    "click",
    () => {

        showTemporaryError(
            "Photo sharing will be added next."
        );
    }
);


fileBtn?.addEventListener(
    "click",
    () => {

        showTemporaryError(
            "File sharing will be added next."
        );
    }
);


cameraBtn?.addEventListener(
    "click",
    () => {

        showTemporaryError(
            "Camera sharing will be added next."
        );
    }
);


/* =========================================================
   BACK
========================================================= */

if (backBtn) {

    backBtn.addEventListener(
        "click",
        () => {

            window.location.href =
                "home.html";
        }
    );
}


/* =========================================================
   CLEANUP
========================================================= */

window.addEventListener(
    "beforeunload",
    () => {

        if (socket) {

            socket.emit(
                "leaveConversation",
                {
                    conversationId
                }
            );

            socket.disconnect();
        }
    }
);


/* =========================================================
   START
========================================================= */

initChat();
