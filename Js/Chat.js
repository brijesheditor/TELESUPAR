// ========================================
// TELESUPAR - REAL TIME CHAT
// ========================================

// Connect to Socket.IO server
const socket = io("https://telesupar.onrender.com");


// ========================================
// GET USER FROM URL
// ========================================

const params = new URLSearchParams(window.location.search);

const chatUser =
    params.get("user") || "Brijesh";


// ========================================
// ELEMENTS
// ========================================

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


// ========================================
// CURRENT USER
// ========================================

// Temporary username.
// Later this will come from real login.
let currentUsername =
    localStorage.getItem("telesupar_username");


// If username doesn't exist
if (!currentUsername) {

    currentUsername =
        "User_" +
        Math.floor(Math.random() * 10000);

    localStorage.setItem(
        "telesupar_username",
        currentUsername
    );
}


// ========================================
// SET CHAT USER
// ========================================

chatUserName.textContent = chatUser;

headerAvatar.textContent =
    chatUser.charAt(0).toUpperCase();


// ========================================
// JOIN SERVER
// ========================================

socket.on("connect", () => {

    console.log(
        "Connected to TELESUPAR server:",
        socket.id
    );

    onlineStatus.textContent =
        "Connected";

    socket.emit(
        "join",
        currentUsername
    );

});


// ========================================
// CONNECTION ERROR
// ========================================

socket.on("connect_error", () => {

    console.log(
        "Could not connect to server"
    );

    onlineStatus.textContent =
        "Connecting...";

});


// ========================================
// RECEIVE MESSAGE
// ========================================

socket.on(
    "receiveMessage",
    (data) => {

        if (!data) return;

        addMessage(
            data.username,
            data.message,
            data.time
        );

    }
);


// ========================================
// SEND MESSAGE
// ========================================

messageForm.addEventListener(
    "submit",
    function (event) {

        event.preventDefault();

        const message =
            messageInput.value.trim();

        if (!message) return;


        // Send message to server
        socket.emit(
            "sendMessage",
            {
                username: currentUsername,
                message: message
            }
        );


        // Clear input
        messageInput.value = "";

        messageInput.focus();

    }
);


// ========================================
// ADD MESSAGE TO SCREEN
// ========================================

function addMessage(
    username,
    message,
    time
) {

    const messageWrapper =
        document.createElement("div");


    // Check sender
    if (username === currentUsername) {

        messageWrapper.className =
            "message sent";

    } else {

        messageWrapper.className =
            "message received";

    }


    // Message bubble
    const bubble =
        document.createElement("div");

    bubble.className =
        "message-bubble";

    bubble.textContent =
        message;


    // Time
    const timeElement =
        document.createElement("span");

    timeElement.className =
        "message-time";


    // Convert server time
    const date =
        new Date(time);


    if (!isNaN(date.getTime())) {

        timeElement.textContent =
            date.toLocaleTimeString(
                [],
                {
                    hour: "2-digit",
                    minute: "2-digit"
                }
            );

    } else {

        timeElement.textContent =
            "now";

    }


    // Add message
    messageWrapper.appendChild(
        bubble
    );

    messageWrapper.appendChild(
        timeElement
    );


    messagesContainer.appendChild(
        messageWrapper
    );


    // Scroll bottom
    messagesContainer.scrollTop =
        messagesContainer.scrollHeight;

}


// ========================================
// ONLINE USERS
// ========================================

socket.on(
    "onlineUsers",
    (users) => {

        console.log(
            "Online users:",
            users
        );

        if (users.length > 1) {

            onlineStatus.textContent =
                "Online";

        } else {

            onlineStatus.textContent =
                "Connected";

        }

    }
);


// ========================================
// USER ONLINE
// ========================================

socket.on(
    "userOnline",
    (data) => {

        console.log(
            data.username +
            " is online"
        );

    }
);


// ========================================
// USER OFFLINE
// ========================================

socket.on(
    "userOffline",
    (data) => {

        console.log(
            data.username +
            " went offline"
        );

    }
);


// ========================================
// BACK BUTTON
// ========================================

backBtn.addEventListener(
    "click",
    () => {

        window.location.href =
            "home.html";

    }
);


// ========================================
// ATTACHMENT MENU
// ========================================

attachmentBtn.addEventListener(
    "click",
    (event) => {

        event.stopPropagation();

        attachmentMenu.classList.toggle(
            "show"
        );

    }
);


// ========================================
// PHOTO
// ========================================

document
    .getElementById("photoBtn")
    .addEventListener(
        "click",
        () => {

            alert(
                "Photo sending will be connected next."
            );

        }
    );


// ========================================
// FILE
// ========================================

document
    .getElementById("fileBtn")
    .addEventListener(
        "click",
        () => {

            alert(
                "File sending will be connected next."
            );

        }
    );


// ========================================
// CAMERA
// ========================================

document
    .getElementById("cameraBtn")
    .addEventListener(
        "click",
        () => {

            alert(
                "Camera will be connected next."
            );

        }
    );


// ========================================
// EMOJI
// ========================================

emojiBtn.addEventListener(
    "click",
    () => {

        messageInput.value += " 😊";

        messageInput.focus();

    }
);


// ========================================
// CHAT MENU
// ========================================

chatMenuBtn.addEventListener(
    "click",
    () => {

        alert(
            "Chat options will be added later."
        );

    }
);


// ========================================
// ENTER TO SEND
// ========================================

messageInput.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();

            messageForm.requestSubmit();

        }

    }
);


// ========================================
// CLOSE ATTACHMENT MENU
// ========================================

document.addEventListener(
    "click",
    () => {

        attachmentMenu.classList.remove(
            "show"
        );

    }
);
