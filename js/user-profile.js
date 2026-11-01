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

/* OPEN FULL SCREEN PHOTO */

$("avatar").addEventListener("click", () => {
    if (!profileUser?.avatar) return;

    $("fullPhoto").src = profileUser.avatar;
    $("photoViewer").classList.add("show");
});

$("closePhoto").addEventListener("click", () => {
    $("photoViewer").classList.remove("show");
    $("fullPhoto").src = "";
});

$("photoViewer").addEventListener("click", event => {
    if (event.target === $("photoViewer")) {
        $("photoViewer").classList.remove("show");
        $("fullPhoto").src = "";
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        $("photoViewer").classList.remove("show");
        $("fullPhoto").src = "";
    }
});

/* PROFILE TABS */

document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {

        document.querySelectorAll(".tab").forEach(item => {
            item.classList.remove("active");
        });

        tab.classList.add("active");

        const type = tab.dataset.tab;

        const messages = {
            posts: "Posts will appear here.",
            stories: "Stories will appear here.",
            media: "Photos and videos will appear here.",
            files: "Shared files will appear here.",
            groups: "Groups will appear here."
        };

        $("content").textContent = messages[type];
    });
});

loadProfile();
