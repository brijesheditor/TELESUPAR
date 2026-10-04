/* =========================================
   TELESUPAR - REAL HOME / RECENT CHATS
========================================= */

const API_URL = "https://telesupar.onrender.com";

const token =
    localStorage.getItem("telesupar_token");

let socket = null;
let conversationCache = [];

/* =========================================
   AUTH CHECK
========================================= */

if (!token) {
    window.location.href = "login.html";
}

/* =========================================
   API HELPER
========================================= */

async function api(endpoint, options = {}) {

    const headers = {
        ...(options.headers || {}),
        "Authorization": "Bearer " + token
    };

    if (
        options.body &&
        !headers["Content-Type"]
    ) {
        headers["Content-Type"] =
            "application/json";
    }

    const response = await fetch(
        API_URL + endpoint,
        {
            ...options,
            headers
        }
    );

    let data = {};

    try {
        data = await response.json();
    } catch (error) {
        data = {};
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
            data.message ||
            "Server request failed"
        );
    }

    return data;
}

/* =========================================
   SEARCH
========================================= */

function openSearch() {

    const searchBox =
        document.getElementById(
            "searchBox"
        );

    const input =
        document.getElementById(
            "searchInput"
        );

    if (!searchBox) return;

    searchBox.classList.toggle(
        "show"
    );

    if (
        searchBox.classList.contains(
            "show"
        )
    ) {

        if (input) {
            input.focus();
        }
    }
}

/* =========================================
   SEARCH REAL CHATS
========================================= */

function searchChats() {

    const inputElement =
        document.getElementById(
            "searchInput"
        );

    if (!inputElement) return;

    const input =
        inputElement.value
            .trim()
            .toLowerCase();

    const chats =
        document.querySelectorAll(
            ".chat-item"
        );

    const empty =
        document.getElementById(
            "emptySearch"
        );

    let found = false;

    chats.forEach(function(chat) {

        const nameElement =
            chat.querySelector("h3");

        const messageElement =
            chat.querySelector("p");

        const name =
            nameElement
                ? nameElement.textContent
                    .toLowerCase()
                : "";

        const message =
            messageElement
                ? messageElement.textContent
                    .toLowerCase()
                : "";

        if (
            name.includes(input) ||
            message.includes(input)
        ) {

            chat.style.display =
                "flex";

            found = true;

        } else {

            chat.style.display =
                "none";
        }

    });

    if (empty) {

        empty.style.display =
            found || input === ""
                ? "none"
                : "block";
    }
}

/* =========================================
   LOAD REAL RECENT CHATS
========================================= */

async function loadRecentChats() {

    try {

        const data =
            await api(
                "/api/conversations"
            );

        conversationCache =
            Array.isArray(
                data.conversations
            )
                ? data.conversations
                : [];

        renderRecentChats(
            conversationCache
        );

    } catch (error) {

        console.error(
            "RECENT CHATS ERROR:",
            error
        );

        showChatError(
            error.message
        );
    }
}

/* =========================================
   RENDER REAL CHATS
========================================= */

function renderRecentChats(
    conversations
) {

    const chatList =
        document.getElementById(
            "chatList"
        );

    if (!chatList) return;

    /*
       Empty current demo chats
       but keep empty-search element.
    */

    chatList
        .querySelectorAll(
            ".chat-item"
        )
        .forEach(function(item) {
            item.remove();
        });

    if (
        !conversations ||
        conversations.length === 0
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "empty-search";

        empty.style.display =
            "block";

        empty.innerHTML = `
            <div style="
                font-size:32px;
                margin-bottom:10px;
            ">💬</div>

            <p>No chats yet</p>

            <small style="
                display:block;
                margin-top:6px;
                color:#687384;
            ">
                Start a conversation with a user
            </small>
        `;

        chatList.appendChild(
            empty
        );

        return;
    }

    /*
       Backend already sorts:
       updatedAt DESC
    */

    conversations.forEach(
        function(conversation) {

            if (
                !conversation ||
                !conversation.user
            ) {
                return;
            }

            const user =
                conversation.user;

            const name =
                user.displayName ||
                user.username ||
                "User";

            const username =
                user.username ||
                "";

            const lastMessage =
                conversation.lastMessage ||
                "Start a conversation";

            const time =
                formatChatTime(
                    conversation.lastMessageAt ||
                    conversation.updatedAt
                );

            const conversationId =
                String(
                    conversation.id ||
                    conversation._id ||
                    ""
                );

            if (!conversationId) {
                return;
            }

            const article =
                document.createElement(
                    "article"
                );

            article.className =
                "chat-item";

            article.dataset.name =
                name.toLowerCase();

            article.dataset.message =
                lastMessage.toLowerCase();

            article.dataset.conversationId =
                conversationId;

            article.innerHTML = `

                <div class="avatar">

                    ${escapeHTML(
                        name
                            .charAt(0)
                            .toUpperCase()
                    )}

                </div>


                <div class="chat-info">

                    <div class="chat-top">

                        <h3>
                            ${escapeHTML(name)}
                        </h3>

                        <time>
                            ${escapeHTML(time)}
                        </time>

                    </div>


                    <div class="chat-bottom">

                        <p>
                            ${escapeHTML(
                                lastMessage
                            )}
                        </p>

                    </div>

                </div>

            `;

            article.addEventListener(
                "click",
                function() {

                    openConversation(
                        conversationId
                    );

                }
            );

            chatList.insertBefore(
                article,
                document.getElementById(
                    "emptySearch"
                )
            );

        }
    );

}

/* =========================================
   OPEN REAL CONVERSATION
========================================= */

function openConversation(
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
   TIME FORMAT
========================================= */

function formatChatTime(
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

    const sameDay =
        date.toDateString() ===
        now.toDateString();

    if (sameDay) {

        return date.toLocaleTimeString(
            [],
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );
    }

    const yesterday =
        new Date(now);

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
            day: "2-digit",
            month: "short"
        }
    );
}

/* =========================================
   ESCAPE HTML
========================================= */

function escapeHTML(
    value
) {

    return String(value || "")
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
   SOCKET REAL-TIME HOME UPDATE
========================================= */

function connectHomeSocket() {

    if (
        typeof io ===
        "undefined"
    ) {

        console.warn(
            "Socket.IO library not loaded"
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
                "Home Socket connected"
            );

            socket.emit(
                "authenticate",
                token
            );

        }
    );

    /*
       Backend sends newMessage
       to conversation room.

       Home does not need to know
       the message contents manually.

       Reloading conversations makes
       the latest message + time appear.
    */

    socket.on(
        "newMessage",
        function(message) {

            if (!message) {
                return;
            }

            loadRecentChats();

        }
    );

}

/* =========================================
   REFRESH WHEN RETURNING TO HOME
========================================= */

window.addEventListener(
    "focus",
    function() {

        loadRecentChats();

    }
);

/* =========================================
   REFRESH AFTER BACK TO PAGE
========================================= */

document.addEventListener(
    "visibilitychange",
    function() {

        if (
            document.visibilityState ===
            "visible"
        ) {

            loadRecentChats();

        }

    }
);

/* =========================================
   NEW CHAT
========================================= */

function newChat() {

    /*
       For now send user to search.
       Search can be used to start chat.
    */

    openSearch();

}

/* =========================================
   OTHER NAVIGATION
========================================= */

function showContacts() {

    alert(
        "Contacts will be connected next."
    );

}

function showProfile() {

    alert(
        "Profile will be connected next."
    );

}

function showSettings() {

    alert(
        "Settings will be connected next."
    );

}

/* =========================================
   ERROR UI
========================================= */

function showChatError(
    message
) {

    const chatList =
        document.getElementById(
            "chatList"
        );

    if (!chatList) return;

    chatList.innerHTML = `

        <div class="empty-search"
             style="display:block;">

            <div style="
                font-size:30px;
                margin-bottom:10px;
            ">
                ⚠
            </div>

            <p>
                Could not load chats
            </p>

            <small style="
                display:block;
                margin-top:6px;
                color:#687384;
            ">
                ${escapeHTML(
                    message ||
                    "Please try again"
                )}
            </small>

        </div>

    `;

}

/* =========================================
   START HOME
========================================= */

async function startHome() {

    if (!token) {
        return;
    }

    await loadRecentChats();

    connectHomeSocket();

}

/* =========================================
   START
========================================= */

startHome();
