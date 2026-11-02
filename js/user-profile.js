"use strict";

const API = "https://telesupar.onrender.com";
const token = localStorage.getItem("telesupar_token");

const params = new URLSearchParams(location.search);
const userId = params.get("id");

const $ = id => document.getElementById(id);

let profileUser = null;
let privateContent = {
    media: [],
    files: [],
    links: []
};

if (!token) {
    location.href = "login.html";
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

async function apiGet(path) {
    const response = await fetch(API + path, {
        headers: {
            Authorization: "Bearer " + token
        }
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(data.message || "Request failed");
    }

    return data;
}

/* LOAD USER PROFILE */
async function loadProfile() {
    try {
        if (!userId) {
            throw new Error("User ID not found");
        }

        const data = await apiGet(
            "/api/users/" + encodeURIComponent(userId) + "/profile"
        );

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
            profileUser.isOnline ? "Online" : "Offline";

        if (profileUser.isOnline) {
            $("status").classList.add("online");
        }

        if (profileUser.avatar) {
            $("avatar").src = profileUser.avatar;
        } else {
            $("avatar").style.display = "none";
        }

        await loadPrivateContent();

    } catch (error) {
        console.error("PROFILE ERROR:", error);
        $("name").textContent = "Profile unavailable";
        $("error").textContent = error.message;
    }
}

/* LOAD PRIVATE CHAT CONTENT */
async function loadPrivateContent() {
    try {
        const data = await apiGet(
            "/api/users/" +
            encodeURIComponent(userId) +
            "/private-content"
        );

        
privateContent = {
    media: Array.isArray(data.media) ? data.media : [],
    files: Array.isArray(data.files) ? data.files : [],
    links: Array.isArray(data.links) ? data.links : []
};

updateVisibleTabs();


    } catch (error) {
        console.error("PRIVATE CONTENT ERROR:", error);
        $("content").textContent =
            "Private content could not be loaded.";
    }
}

/* EMPTY MESSAGE */
function showEmpty(message) {
    $("content").innerHTML =
        '<div class="placeholder">' +
        escapeHTML(message) +
        '</div>';
}

/* MEDIA TAB */
function renderMedia() {
    const items = privateContent.media;

    if (!items.length) {
        showEmpty("No photos or videos shared in this chat yet.");
        return;
    }

    $("content").innerHTML = `
        <div style="
            display:grid;
            grid-template-columns:repeat(2,minmax(0,1fr));
            gap:10px;
        ">
        ${items.map(item => {
            const url = escapeHTML(item.url);
            const type = escapeHTML(item.mimeType);
            const name = escapeHTML(item.fileName);

            if (type.startsWith("video/")) {
                return `
                    <div style="background:#111b2b;border-radius:12px;overflow:hidden;">
                        <video
                            src="${url}"
                            controls
                            playsinline
                            style="width:100%;display:block;max-height:220px;">
                        </video>
                        <div style="padding:8px;font-size:12px;">${name}</div>
                    </div>
                `;
            }

            return `
                <a href="${url}" target="_blank" rel="noopener"
                   style="display:block;background:#111b2b;border-radius:12px;overflow:hidden;">
                    <img src="${url}" alt="${name}"
                         loading="lazy"
                         style="width:100%;height:150px;object-fit:cover;display:block;">
                </a>
            `;
        }).join("")}
        </div>
    `;
}

/* FILES TAB */
function renderFiles() {
    const items = privateContent.files;

    if (!items.length) {
        showEmpty("No files shared in this chat yet.");
        return;
    }

    $("content").innerHTML = `
        <div style="display:grid;gap:10px;">
        ${items.map(item => `
            <a href="${escapeHTML(item.url)}"
               target="_blank"
               rel="noopener"
               style="
                 display:block;
                 padding:15px;
                 background:#172438;
                 border:1px solid #34445d;
                 border-radius:13px;
                 color:white;
                 text-decoration:none;
                 overflow-wrap:anywhere;
               ">
                📄 ${escapeHTML(item.fileName)}
                <div style="font-size:12px;color:#9eacc0;margin-top:6px;">
                    ${escapeHTML(item.mimeType)}
                </div>
            </a>
        `).join("")}
        </div>
    `;
}

/* LINKS TAB */
function renderLinks() {
    const items = privateContent.links;

    if (!items.length) {
        showEmpty("No links shared in this chat yet.");
        return;
    }

    $("content").innerHTML = `
        <div style="display:grid;gap:10px;">
        ${items.map(item => `
            <a href="${escapeHTML(item.url)}"
               target="_blank"
               rel="noopener noreferrer"
               style="
                 display:block;
                 padding:15px;
                 background:#172438;
                 border:1px solid #34445d;
                 border-radius:13px;
                 color:#8dc8ff;
                 text-decoration:none;
                 overflow-wrap:anywhere;
               ">
                🔗 ${escapeHTML(item.url)}
            </a>
        `).join("")}
        </div>
    `;
}


/* SHOW ONLY TABS THAT HAVE CONTENT */
function updateVisibleTabs() {
    const available = {
        media: privateContent.media.length > 0,
        files: privateContent.files.length > 0,
        links: privateContent.links.length > 0,

        // These will be enabled when their backend is ready
        posts: false,
        stories: false,
        groups: false
    };

    let firstTab = null;

    document.querySelectorAll(".tab").forEach(button => {
        const tabName = button.dataset.tab;
        const show = available[tabName] === true;

        button.style.display = show ? "" : "none";

        button.classList.remove("active");

        if (show && !firstTab) {
            firstTab = button;
        }
    });

    if (firstTab) {
        firstTab.classList.add("active");
        renderTab(firstTab.dataset.tab);
    } else {
        showEmpty("Abhi koi content shared nahi hua hai.");
    }
}


/* TAB CONTENT */
function renderTab(tab) {
    if (tab === "media") {
        renderMedia();
        return;
    }

    if (tab === "files") {
        renderFiles();
        return;
    }

    if (tab === "links") {
        renderLinks();
        return;
    }

    if (tab === "posts") {
        showEmpty("No posts yet.");
        return;
    }

    if (tab === "stories") {
        showEmpty("No stories yet.");
        return;
    }

    if (tab === "groups") {
        showEmpty("Groups feature is coming soon.");
        return;
    }

    showEmpty("Nothing to show.");
}

/* TAB BUTTONS */
document.querySelectorAll(".tab").forEach(button => {
    button.addEventListener("click", function() {
        document.querySelectorAll(".tab").forEach(tab => {
            tab.classList.remove("active");
        });

        this.classList.add("active");
        renderTab(this.dataset.tab);
    });
});

/* FULL SCREEN PROFILE PHOTO */
function openFullPhoto() {
    if (!profileUser?.avatar) {
        alert("Profile photo available nahi hai.");
        return;
    }

    $("fullPhoto").src = profileUser.avatar;
    $("photoViewer").classList.add("show");
}

function closeFullPhoto() {
    $("photoViewer").classList.remove("show");
    $("fullPhoto").src = "";
}

$("avatarWrap").addEventListener("click", openFullPhoto);

$("avatar").addEventListener("click", function(event) {
    event.stopPropagation();
    openFullPhoto();
});

$("closePhoto").addEventListener("click", closeFullPhoto);

$("photoViewer").addEventListener("click", function(event) {
    if (event.target === this) {
        closeFullPhoto();
    }
});

document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
        closeFullPhoto();
    }
});

/* START */
loadProfile();
