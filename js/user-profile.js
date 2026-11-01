"use strict";

const API = "https://telesupar.onrender.com";
const token = localStorage.getItem("telesupar_token");

const params = new URLSearchParams(location.search);
const userId = params.get("id");

const $ = id => document.getElementById(id);

let profileUser = null;

if (!token) {
    location.href = "login.html";
}

async function loadProfile() {
    try {
        if (!userId) {
            throw new Error("User ID not found");
        }

        const response = await fetch(
            API + "/api/users/" +
            encodeURIComponent(userId) +
            "/profile",
            {
                headers: {
                    Authorization: "Bearer " + token
                }
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || "Profile load failed");
        }

        profileUser = data.profile;

        $("name").textContent =
            profileUser.displayName || "User";

        $("username").textContent =
            profileUser.username
                ? "@" + profileUser.username
                : "Username not available";

        $("bio").textContent =
            profileUser.bio || "No bio added yet.";

        $("statusText").textContent =
            profileUser.isOnline
                ? "Online"
                : "Offline";

        if (profileUser.isOnline) {
            $("status").classList.add("online");
        }

        if (profileUser.avatar) {
            $("avatar").src = profileUser.avatar;
        } else {
            $("avatar").style.display = "none";
        }

    } catch (error) {
        console.error("PROFILE ERROR:", error);
        $("name").textContent = "Profile unavailable";
        $("error").textContent = error.message;
    }
}

/* FULL SCREEN PROFILE PHOTO */

function openFullPhoto() {
    const avatar = document.getElementById("avatar");

    if (!avatar || !profileUser?.avatar) {
        alert("Profile photo available nahi hai.");
        return;
    }

    const viewer = document.getElementById("photoViewer");
    const fullPhoto = document.getElementById("fullPhoto");

    fullPhoto.src = profileUser.avatar;
    viewer.classList.add("show");
}

function closeFullPhoto() {
    const viewer = document.getElementById("photoViewer");
    const fullPhoto = document.getElementById("fullPhoto");

    viewer.classList.remove("show");
    fullPhoto.src = "";
}

document.getElementById("avatarWrap").addEventListener(
    "click",
    openFullPhoto
);

document.getElementById("avatar").addEventListener(
    "click",
    function(event) {
        event.stopPropagation();
        openFullPhoto();
    }
);

document.getElementById("closePhoto").addEventListener(
    "click",
    closeFullPhoto
);

document.getElementById("photoViewer").addEventListener(
    "click",
    function(event) {
        if (event.target === this) {
            closeFullPhoto();
        }
    }
);

document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
        closeFullPhoto();
    }
});
