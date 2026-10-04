/* =========================================
   TELESUPAR - REAL HOME
========================================= */

const API_URL =
    "https://telesupar.onrender.com";

const token =
    localStorage.getItem(
        "telesupar_token"
    );

let homeSocket = null;
let searchTimer = null;

/* =========================================
   AUTH
========================================= */

if (!token) {

    window.location.replace(
        "login.html"
    );
}

/* =========================================
   ELEMENTS
========================================= */

const searchInput =
    document.getElementById(
        "searchInput"
    );

const searchResults =
    document.getElementById(
        "searchResults"
    );

const usersList =
    document.getElementById(
        "usersList"
    );

const chatList =
    document.getElementById(
        "chatList"
    );

const recentSection =
    document.getElementById(
        "recentSection"
    );

const welcomeText =
    document.getElementById(
        "welcomeText"
    );

const chatCount =
    document.getElementById(
        "chatCount"
    );

const newChatBtn =
    document.getElementById(
        "newChatBtn"
    );

const refreshBtn =
    document.getElementById(
        "refreshBtn"
    );

const navButtons =
    document.querySelectorAll(
        ".nav-btn"
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

    const now =
        new Date();

    if (
        date.toDateString() ===
        now.toDateString()
    ) {

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

    const yesterday =
        new Date();

    yesterday.setDate(
        yesterday.getDate() - 1
    );

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
                "2-digit",

            month:
                "short"
        }
    );
}

/* =========================================
   LOAD PROFILE
========================================= */

async function loadMe() {

    try {

        const data =
            await api(
                "/api/me"
            );

        if (
            data &&
            data.user
        ) {

            localStorage.setItem(
                "telesupar_user",
                JSON.stringify(
                    data.user
                )
            );

            if (welcomeText) {

                welcomeText.textContent =
                    "Welcome, " +
                    (
                        data.user.displayName ||
                        data.user.username ||
                        "User"
                    );
            }
        }

    } catch (error) {

        console.error(
            "PROFILE ERROR:",
            error
        );
    }
}

/* =========================================
   LOAD RECENT CHATS
========================================= */

async function loadChats() {

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

        if (chatCount) {

            chatCount.textContent =
                chats.length +
                (
                    chats.length === 1
                        ? " chat"
                        : " chats"
                );
        }

        renderChats(
            chats
        );

    } catch (error) {

        console.error(
            "CHAT LOAD ERROR:",
            error
        );

        if (chatList) {

            chatList.innerHTML = `

                <div class="center-message">

                    ⚠️

                    <br><br>

                    Could not load chats.

                    <br><br>

                    <small>
                        ${escapeHTML(
                            error.message
                        )}
                    </small>

                </div>

            `;
        }
    }
}

/* =========================================
   RENDER CHATS
========================================= */

function renderChats(
    chats
) {

    if (!chatList) {
        return;
    }

    chatList.innerHTML = "";

    if (!chats.length) {

        chatList.innerHTML = `

            <div class="center-message">

                💬

                <br><br>

                No chats yet.

                <br>

                Search for a user
                and start chatting.

            </div>

        `;

        return;
    }

    chats.forEach(
        function(chat) {

            /*
                IMPORTANT:
                Backend now returns
                both otherUser and user.
            */

            const other =
                chat.otherUser ||
                chat.user ||
                null;

            if (!other) {
                return;
            }

            const name =
                other.displayName ||
                other.username ||
                "User";

            const username =
                other.username ||
                "";

            const initial =
                name
                    .charAt(0)
                    .toUpperCase();

            const conversationId =
                String(
                    chat._id ||
                    chat.id ||
                    ""
                );

            if (!conversationId) {
                return;
            }

            const unread =
                Number(
                    chat.unreadCount ||
                    0
                );

            const lastMessage =
                chat.lastMessage ||
                "Start a conversation";

            const item =
                document.createElement(
                    "div"
                );

            /*
                Existing home.html uses
                class="chat"
            */

            item.className =
                "chat";

            item.style.cursor =
                "pointer";

            item.dataset.id =
                conversationId;

            item.innerHTML = `

                <div class="avatar">

                    ${escapeHTML(
                        initial
                    )}

                    <div
                        class="online-dot"
                    ></div>

                </div>


                <div class="chat-info">

                    <div class="chat-top">

                        <div class="chat-name">

                            ${escapeHTML(
                                name
                            )}

                        </div>


                        <div class="chat-time">

                            ${escapeHTML(
                                formatTime(
                                    chat.lastMessageAt ||
                                    chat.updatedAt
                                )
                            )}

                        </div>

                    </div>


                    <div class="chat-bottom">

                        <div
                            class="chat-message"
                            style="
                                ${
                                    unread > 0
                                    ? "color:#f5f7fb;font-weight:600;"
                                    : ""
                                }
                            "
                        >

                            ${escapeHTML(
                                lastMessage
                            )}

                        </div>


                        ${
                            unread > 0
                            ? `

                                <div
                                    class="badge"
                                >

                                    ${
                                        unread > 99
                                            ? "99+"
                                            : unread
                                    }

                                </div>

                            `
                            : ""
                        }

                    </div>

                </div>

            `;

            /*
                CLICK
            */

            item.addEventListener(
                "click",
                function() {

                    openChat(
                        conversationId
                    );

                }
            );

            /*
                Extra fallback
                for mobile taps
            */

            item.addEventListener(
                "touchend",
                function() {

                    openChat(
                        conversationId
                    );

                },
                {
                    passive: true
                }
            );

            chatList.appendChild(
                item
            );

        }
    );
}

/* =========================================
   OPEN CHAT
========================================= */

function openChat(
    conversationId
) {

    if (!conversationId) {

        alert(
            "Conversation ID missing"
        );

        return;
    }

    window.location.href =
        "chat.html?id=" +
        encodeURIComponent(
            conversationId
        );
}

/* =========================================
   SEARCH USERS
========================================= */

async function searchUsers(
    query
) {

    if (!usersList) {
        return;
    }

    try {

        const data =
            await api(
                "/api/users?search=" +
                encodeURIComponent(
                    query
                )
            );

        const users =
            Array.isArray(
                data.users
            )
                ? data.users
                : [];

        usersList.innerHTML =
            "";

        const resultCount =
            document.getElementById(
                "resultCount"
            );

        if (resultCount) {

            resultCount.textContent =
                users.length +
                (
                    users.length === 1
                        ? " user"
                        : " users"
                );
        }

        if (!users.length) {

            usersList.innerHTML = `

                <div
                    class="center-message"
                >

                    No users found.

                </div>

            `;

            return;
        }

        users.forEach(
            function(user) {

                const name =
                    user.displayName ||
                    user.username ||
                    "User";

                const initial =
                    name
                        .charAt(0)
                        .toUpperCase();

                const row =
                    document.createElement(
                        "div"
                    );

                row.className =
                    "user-result";

                row.innerHTML = `

                    <div class="avatar">

                        ${escapeHTML(
                            initial
                        )}

                    </div>


                    <div
                        class="user-result-info"
                    >

                        <div
                            class="user-result-name"
                        >

                            ${escapeHTML(
                                name
                            )}

                        </div>

                        <div
                            class="user-result-username"
                        >

                            @${escapeHTML(
                                user.username
                            )}

                        </div>

                    </div>


                    <button
                        class="chat-btn"
                        type="button"
                    >

                        Chat

                    </button>

                `;

                const button =
                    row.querySelector(
                        ".chat-btn"
                    );

                button.addEventListener(
                    "click",
                    async function(
                        event
                    ) {

                        event.stopPropagation();

                        await createConversation(
                            user.id ||
                            user._id
                        );

                    }
                );

                row.addEventListener(
                    "click",
                    async function() {

                        await createConversation(
                            user.id ||
                            user._id
                        );

                    }
                );

                usersList.appendChild(
                    row
                );

            }
        );

    } catch (error) {

        console.error(
            "SEARCH ERROR:",
            error
        );

        usersList.innerHTML = `

            <div class="center-message">

                ${escapeHTML(
                    error.message
                )}

            </div>

        `;
    }
}

/* =========================================
   CREATE CONVERSATION
========================================= */

async function createConversation(
    userId
) {

    if (!userId) {

        alert(
            "User ID missing"
        );

        return;
    }

    try {

        const data =
            await api(
                "/api/conversations/" +
                encodeURIComponent(
                    userId
                ),
                {
                    method:
                        "POST"
                }
            );

        const conversation =
            data.conversation;

        const id =
            conversation &&
            (
                conversation._id ||
                conversation.id
            );

        if (!id) {

            alert(
                "Conversation ID missing"
            );

            return;
        }

        openChat(
            id
        );

    } catch (error) {

        console.error(
            "CREATE CHAT ERROR:",
            error
        );

        alert(
            error.message ||
            "Could not start chat"
        );
    }
}

/* =========================================
   SEARCH INPUT
========================================= */

if (searchInput) {

    searchInput.addEventListener(
        "input",
        function() {

            clearTimeout(
                searchTimer
            );

            const query =
                this.value.trim();

            if (!query) {

                if (searchResults) {

                    searchResults.style.display =
                        "none";
                }

                if (recentSection) {

                    recentSection.style.display =
                        "block";
                }

                return;
            }

            if (searchResults) {

                searchResults.style.display =
                    "block";
            }

            if (recentSection) {

                recentSection.style.display =
                    "none";
            }

            searchTimer =
                setTimeout(
                    function() {

                        searchUsers(
                            query
                        );

                    },
                    300
                );

        }
    );
}

/* =========================================
   REFRESH BUTTON
========================================= */

if (refreshBtn) {

    refreshBtn.addEventListener(
        "click",
        function() {

            loadChats();

        }
    );
}

/* =========================================
   NEW CHAT
========================================= */

if (newChatBtn) {

    newChatBtn.addEventListener(
        "click",
        function() {

            if (searchInput) {

                searchInput.focus();

            }

        }
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

        console.warn(
            "Socket.IO not loaded"
        );

        return;
    }

    homeSocket =
        io(
            API_URL,
            {
                transports: [
                    "websocket",
                    "polling"
                ]
            }
        );

    homeSocket.on(
        "connect",
        function() {

            console.log(
                "Home socket connected"
            );

            homeSocket.emit(
                "authenticate",
                token
            );

        }
    );

    /*
        New message / conversation update
    */

    homeSocket.on(
        "conversationUpdated",
        function(data) {

            console.log(
                "Conversation updated:",
                data
            );

            loadChats();

        }
    );

    /*
        New message while both
        users are inside conversation
    */

    homeSocket.on(
        "newMessage",
        function() {

            loadChats();

        }
    );

    /*
        Seen update
    */

    homeSocket.on(
        "messagesSeen",
        function() {

            loadChats();

        }
    );

}

/* =========================================
   RETURN TO HOME
========================================= */

window.addEventListener(
    "focus",
    function() {

        loadChats();

    }
);

document.addEventListener(
    "visibilitychange",
    function() {

        if (
            document.visibilityState ===
            "visible"
        ) {

            loadChats();

        }

    }
);

/* =========================================
   NAVIGATION
========================================= */

navButtons.forEach(
    function(button) {

        button.addEventListener(
            "click",
            function() {

                navButtons.forEach(
                    function(btn) {

                        btn.classList.remove(
                            "active"
                        );

                    }
                );

                button.classList.add(
                    "active"
                );

                const page =
                    button.dataset.page;

                if (
                    page !== "chats"
                ) {

                    alert(
                        page +
                        " section will be connected next."
                    );
                }

            }
        );

    }
);

/* =========================================
   START
========================================= */

async function startHome() {

    await loadMe();

    await loadChats();

    connectSocket();

}

startHome();
