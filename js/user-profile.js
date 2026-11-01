
"use strict";

const API = "https://telesupar.onrender.com";

const token = localStorage.getItem("telesupar_token");

const params = new URLSearchParams(location.search);
const userId = params.get("id");

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

        const user = data.profile;

        document.getElementById("name").textContent =
            user.displayName || "User";

        document.getElementById("username").textContent =
            user.username ? "@" + user.username : "";

        document.getElementById("bio").textContent =
            user.bio || "No bio available";

        document.getElementById("status").textContent =
            user.isOnline ? "● Online" : "● Offline";

        const avatar = document.getElementById("avatar");

        if (user.avatar) {
            avatar.src = user.avatar;
        } else {
            avatar.style.display = "none";
        }

    } catch (error) {
        document.getElementById("name").textContent =
            "Profile unavailable";

        document.getElementById("error").textContent =
            error.message;
    }
}

loadProfile();
