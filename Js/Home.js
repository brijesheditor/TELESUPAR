function openSearch() {

  const searchBox = document.getElementById("searchBox");
  const input = document.getElementById("searchInput");

  searchBox.classList.toggle("show");

  if (searchBox.classList.contains("show")) {
    input.focus();
  }

}


function searchChats() {

  const input =
    document.getElementById("searchInput").value.toLowerCase();

  const chats =
    document.querySelectorAll(".chat-item");

  const empty =
    document.getElementById("emptySearch");

  let found = false;

  chats.forEach(chat => {

    const name =
      chat.querySelector("h3").textContent.toLowerCase();

    const message =
      chat.querySelector("p").textContent.toLowerCase();

    if (
      name.includes(input) ||
      message.includes(input)
    ) {

      chat.style.display = "flex";
      found = true;

    } else {

      chat.style.display = "none";

    }

  });

  empty.style.display =
    found || input === "" ? "none" : "block";

}


function openChat(name) {

  window.location.href =
    "chat.html?user=" + encodeURIComponent(name);

}


function newChat() {

  alert("New Chat screen will be connected soon.");

}


function showContacts() {

  alert("Contacts will be added soon.");

}


function showProfile() {

  alert("Profile will be added soon.");

}


function showSettings() {

  alert("Settings will be added soon.");

}
