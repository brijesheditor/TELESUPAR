/* ========================================
   TELESUPAR - REAL CHAT
   MongoDB + REST API + Socket.IO
======================================== */

const API_URL = "https://telesupar.onrender.com";

/* ========================================
   AUTH
======================================== */

const token =
  localStorage.getItem("telesupar_token");

let currentUser = null;

try {
  const savedUser =
    localStorage.getItem("telesupar_user");

  if (savedUser) {
    currentUser = JSON.parse(savedUser);
  }
} catch (error) {
  console.error("User data error:", error);
}

/* ========================================
   CONVERSATION ID
======================================== */

const params =
  new URLSearchParams(
    window.location.search
  );

const conversationId =
  String(
    params.get("id") || ""
  ).trim();

/* ========================================
   ELEMENTS
======================================== */

const messagesContainer =
  document.getElementById("messages");

const messageForm =
  document.getElementById("messageForm");

const messageInput =
  document.getElementById("messageInput");

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

const emojiBtn =
  document.getElementById("emojiBtn");

const chatMenuBtn =
  document.getElementById("chatMenuBtn");

/* ========================================
   SOCKET
======================================== */

let socket = null;

/* ========================================
   CHECK LOGIN
======================================== */

if (!token) {

  window.location.href =
    "login.html";

}

if (!conversationId) {

  alert(
    "Conversation ID missing"
  );

  window.location.href =
    "home.html";

}

/* ========================================
   API HELPER
======================================== */

async function api(
  endpoint,
  options = {}
) {

  const headers = {
    ...(options.headers || {}),
    "Authorization":
      "Bearer " + token
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
      API_URL + endpoint,
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

    throw new Error(
      data.message ||
      "Server request failed"
    );

  }

  return data;
}

/* ========================================
   FIND CHAT USER
======================================== */

async function loadChatUser() {

  try {

    const data =
      await api(
        "/api/conversations"
      );

    const list =
      Array.isArray(
        data.conversations
      )
        ? data.conversations
        : [];

    const conversation =
      list.find(
        function (item) {

          const id =
            String(
              item.id ||
              item._id ||
              ""
            );

          return id ===
            conversationId;

        }
      );

    if (
      conversation &&
      conversation.user
    ) {

      const user =
        conversation.user;

      const name =
        user.displayName ||
        user.username ||
        "User";

      chatUserName.textContent =
        name;

      headerAvatar.textContent =
        name
          .charAt(0)
          .toUpperCase();

    } else {

      chatUserName.textContent =
        "Chat";

      headerAvatar.textContent =
        "?";

    }

  } catch (error) {

    console.error(
      "USER LOAD ERROR:",
      error
    );

    chatUserName.textContent =
      "Chat";

  }
}

/* ========================================
   LOAD REAL MESSAGE HISTORY
======================================== */

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

    messagesContainer.innerHTML =
      "";

    if (list.length === 0) {

      showEmpty();

      return;

    }

    list.forEach(
      function (message) {

        renderMessage(
          message
        );

      }
    );

    scrollBottom();

  } catch (error) {

    console.error(
      "MESSAGE HISTORY ERROR:",
      error
    );

    messagesContainer.innerHTML =
      "";

    showError(
      error.message ||
      "Could not load messages"
    );

  }
}

/* ========================================
   EMPTY CHAT
======================================== */

function showEmpty() {

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

/* ========================================
   ERROR
======================================== */

function showError(text) {

  const error =
    document.createElement(
      "div"
    );

  error.className =
    "empty-chat";

  error.textContent =
    text;

  messagesContainer.appendChild(
    error
  );

}

/* ========================================
   RENDER MESSAGE
======================================== */

function renderMessage(
  message
) {

  if (!message) {
    return;
  }

  const empty =
    messagesContainer.querySelector(
      ".empty-chat"
    );

  if (empty) {
    empty.remove();
  }

  const messageId =
    String(
      message.id ||
      message._id ||
      ""
    );

  if (messageId) {

    const already =
      messagesContainer.querySelector(
        '[data-message-id="' +
        messageId +
        '"]'
      );

    if (already) {
      return;
    }

  }

  const senderId =
    String(
      message.senderId ||
      ""
    );

  const myId =
    currentUser
      ? String(
          currentUser.id ||
          currentUser._id ||
          ""
        )
      : "";

  const wrapper =
    document.createElement(
      "div"
    );

  wrapper.className =
    senderId === myId
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
    String(
      message.text || ""
    );

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

  wrapper.appendChild(
    bubble
  );

  wrapper.appendChild(
    time
  );

  messagesContainer.appendChild(
    wrapper
  );

}

/* ========================================
   TIME
======================================== */

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
      hour: "2-digit",
      minute: "2-digit"
    }
  );

}

/* ========================================
   SCROLL
======================================== */

function scrollBottom() {

  requestAnimationFrame(
    function () {

      messagesContainer.scrollTop =
        messagesContainer.scrollHeight;

    }
  );

}

/* ========================================
   SOCKET CONNECT
======================================== */

function connectSocket() {

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
    function () {

      console.log(
        "Connected:",
        socket.id
      );

      if (onlineStatus) {

        onlineStatus.textContent =
          "Connected";

        onlineStatus.classList.add(
          "connected"
        );

      }

      /*
        Authenticate logged-in user
      */

      socket.emit(
        "authenticate",
        token
      );

      /*
        Join exact conversation
      */

      socket.emit(
        "joinConversation",
        conversationId
      );

    }
  );

  socket.on(
    "connect_error",
    function (error) {

      console.error(
        "Socket error:",
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
    function () {

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
    REAL BACKEND EVENT
  */

  socket.on(
    "newMessage",
    function (message) {

      if (!message) {
        return;
      }

      if (
        String(
          message.conversationId ||
          ""
        ) !== conversationId
      ) {

        return;

      }

      renderMessage(
        message
      );

      scrollBottom();

    }
  );

  socket.on(
    "authError",
    function (message) {

      console.error(
        "Socket authentication:",
        message
      );

    }
  );

}

/* ========================================
   SEND MESSAGE
======================================== */

if (messageForm) {

  messageForm.addEventListener(
    "submit",
    async function (event) {

      event.preventDefault();

      const text =
        messageInput.value.trim();

      if (!text) {
        return;
      }

      if (!conversationId) {
        return;
      }

      messageInput.disabled =
        true;

      try {

        /*
          Backend saves the message
          into MongoDB.

          Backend then emits:
          "newMessage"

          Therefore we do NOT manually
          render the returned message.
        */

        await api(
          "/api/conversations/" +
          encodeURIComponent(
            conversationId
          ) +
          "/messages",
          {
            method: "POST",

            body: JSON.stringify({
              text: text
            })
          }
        );

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
          "Message could not be sent"
        );

      } finally {

        messageInput.disabled =
          false;

        messageInput.focus();

      }

    }
  );

}

/* ========================================
   ENTER TO SEND
======================================== */

if (messageInput) {

  messageInput.addEventListener(
    "keydown",
    function (event) {

      if (
        event.key === "Enter" &&
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

/* ========================================
   BACK
======================================== */

if (backBtn) {

  backBtn.addEventListener(
    "click",
    function () {

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

/* ========================================
   ATTACHMENT MENU
======================================== */

if (attachmentBtn) {

  attachmentBtn.addEventListener(
    "click",
    function (event) {

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
  function () {

    if (attachmentMenu) {

      attachmentMenu.classList.remove(
        "show"
      );

    }

  }
);

/* ========================================
   EMOJI
======================================== */

if (emojiBtn) {

  emojiBtn.addEventListener(
    "click",
    function () {

      if (!messageInput) {
        return;
      }

      messageInput.value +=
        messageInput.value
          ? " 😊"
          : "😊";

      messageInput.focus();

    }
  );

}

/* ========================================
   START CHAT
======================================== */

async function startChat() {

  if (!token) {
    return;
  }

  if (!conversationId) {
    return;
  }

  await loadChatUser();

  await loadMessages();

  connectSocket();

}

/* ========================================
   START
======================================== */

startChat();
