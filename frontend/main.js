let currentUser = null;
let evtSource = null;

/**
 * Wyświetla komunikat w obszarze #message.
 * @param {string} text Treść komunikatu.
 * @param {string} type Typ komunikatu ('info', 'success', 'error').
 */
function showMessage(text, type = "info") {
  const messageDiv = document.getElementById("message");
  messageDiv.innerText = text;
  messageDiv.className = type;
  setTimeout(() => {
    messageDiv.innerText = "";
    messageDiv.className = "";
  }, 5000);
}

/**
 * Wyświetla powiadomienie w obszarze #notification.
 * @param {string} text Treść powiadomienia.
 */
function showNotification(text) {
  const notifDiv = document.getElementById("notification");
  notifDiv.innerText = text;
  setTimeout(() => {
    notifDiv.innerText = "";
  }, 5000);
}

/**
 * Aktualizuje widoczność pozycji w menu oraz informację o zalogowanym użytkowniku.
 */
function renderNav() {
  if (currentUser) {
    document.getElementById("nav-profile").style.display = "inline";
    document.getElementById("nav-cars").style.display = "inline";
    document.getElementById("nav-buy").style.display = "inline";
    document.getElementById("nav-logout").style.display = "inline";
    document.getElementById("nav-login").style.display = "none";
    document.getElementById("nav-register").style.display = "none";

    document.getElementById(
      "user-info"
    ).innerText = `Zalogowany jako: ${currentUser.username} | Rola: ${currentUser.role} | Saldo: ${currentUser.balance}`;
  } else {
    document.getElementById("nav-profile").style.display = "none";
    document.getElementById("nav-cars").style.display = "none";
    document.getElementById("nav-buy").style.display = "none";
    document.getElementById("nav-logout").style.display = "none";
    document.getElementById("nav-login").style.display = "inline";
    document.getElementById("nav-register").style.display = "inline";

    document.getElementById("user-info").innerText = "Nie jesteś zalogowany";
  }
}

/**
 * Sprawdza, czy użytkownik jest zalogowany poprzez wywołanie endpointu /users.
 * Dla zwykłych userów zwracany jest obiekt, a dla admina (ze względu na uprawnienia)
 * – tablica wszystkich użytkowników. W tym przypadku wybieramy obiekt admina.
 */
async function checkAuth() {
  try {
    const res = await fetch("/auth/me", { credentials: "include" });
    if (res.ok) {
      const { user } = await res.json();
      currentUser = user;
    } else {
      currentUser = null;
    }
  } catch {
    currentUser = null;
  }
  renderNav();
}


/**
 * Pokazuje wskazany widok (sekcję) i ukrywa pozostałe.
 * @param {string} viewId ID widoku do pokazania.
 */
function showView(viewId) {
  const views = document.querySelectorAll(".view");
  views.forEach((view) => {
    view.style.display = "none";
  });
  const activeView = document.getElementById(viewId);
  if (activeView) {
    activeView.style.display = "block";
  }
}

/**
 * Ładuje dane profilu aktualnie zalogowanego użytkownika.
 */
async function loadProfile() {
  try {
    const res = await fetch("/auth/me", { credentials: "include" });
    if (res.status === 200) {
      const { user } = await res.json();
      if (user) {
        document.getElementById("profile-info").innerText =
          `Username: ${user.username}\nSaldo: ${user.balance}`;
      }
    }
  } catch (err) {
    showMessage("Błąd przy pobieraniu profilu", "error");
  }
}

/**
 * Ładuje listę samochodów i wyświetla je w sekcji #cars-list.
 */
async function loadCars() {
  try {
    const res = await fetch("/cars", { credentials: "include" });
    if (res.status === 200) {
      const cars = await res.json();
      let html = "";
      if (!Array.isArray(cars) || cars.length === 0) {
        html = "Brak samochodów.";
      } else {
        cars.forEach((car) => {
          html += `<div class="car-item">
                     <strong>ID:</strong> ${car.id} |
                     <strong>Model:</strong> ${car.model} |
                     <strong>Cena:</strong> ${car.price} |
                     <strong>Właściciel:</strong> ${car.ownerId}
                   </div>`;
        });
      }
      document.getElementById("cars-list").innerHTML = html;
    } else {
      showMessage("Błąd przy pobieraniu samochodów", "error");
    }
  } catch (err) {
    showMessage("Błąd przy pobieraniu samochodów", "error");
  }
}

/**
 * Ustawia wszystkie nasłuchiwacze zdarzeń dla formularzy oraz routingu.
 */
function setupEventListeners() {
  // Routing – zmiana widoku po zmianie fragmentu URL
  window.addEventListener("hashchange", route);
  route(); // inicjalizacja

  // Formularz logowania
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("loginUsername").value;
      const password = document.getElementById("loginPassword").value;
      const res = await fetch("/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.status === 200) {
        showMessage("Zalogowano pomyślnie", "success");
        await checkAuth();
        setupSSE(); // po poprawnym logowaniu uruchom SSE
        window.location.hash = "#home";
      } else {
        showMessage((data && data.error) || "Błąd logowania", "error");
      }
    });
  }

  // Formularz rejestracji
  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("regUsername").value;
      const password = document.getElementById("regPassword").value;
      const res = await fetch("/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.status === 201) {
        showMessage("Rejestracja powiodła się, możesz się zalogować", "success");
        window.location.hash = "#login";
      } else {
        showMessage((data && data.error) || "Błąd rejestracji", "error");
      }
    });
  }

  // Formularz aktualizacji profilu
  const profileForm = document.getElementById("profileForm");
  if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) return showMessage("Musisz być zalogowany", "error");
      const newUsername = document.getElementById("newUsername").value;
      const newPassword = document.getElementById("newPassword").value;
      const userId = currentUser.id;
      const res = await fetch(`/users/${encodeURIComponent(userId)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.status === 200) {
        showMessage("Profil zaktualizowany", "success");
        await checkAuth();
        loadProfile();
      } else {
        showMessage((data && data.error) || "Błąd aktualizacji profilu", "error");
      }
    });
  }

  // Formularz dodawania samochodu
  const addCarForm = document.getElementById("addCarForm");
  if (addCarForm) {
    addCarForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) return showMessage("Musisz być zalogowany", "error");
      const model = document.getElementById("carModel").value;
      const price = parseFloat(document.getElementById("carPrice").value);
      const res = await fetch("/cars", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, price, ownerId: currentUser.id }),
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.status === 201) {
        showMessage("Samochód dodany", "success");
        loadCars();
      } else {
        showMessage((data && data.error) || "Błąd dodawania samochodu", "error");
      }
    });
  }

  // Formularz zakupu samochodu
  const buyCarForm = document.getElementById("buyCarForm");
  if (buyCarForm) {
    buyCarForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const carId = document.getElementById("buyCarId").value.trim();
      if (!carId) return showMessage("Podaj ID samochodu", "error");
      const res = await fetch(`/cars/${encodeURIComponent(carId)}/buy`, {
        method: "POST",
        credentials: "include",
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (res.status === 200) {
        showMessage("Samochód zakupiony", "success");
        loadCars();
        await checkAuth(); // saldo i owner odświeżone
        document.getElementById("buyCarId").value = "";
      } else {
        showMessage((data && data.error) || "Błąd zakupu samochodu", "error");
      }
    });
  }
}


/**
 * Prosty router – na podstawie fragmentu adresu URL (hash) wyświetla odpowiedni widok.
 * Specjalnie obsługujemy #logout, aby "wylogować" użytkownika (symulacja).
 */
function route() {
  const hash = window.location.hash || "#home";
  const viewId = hash.substring(1) + "-view";

  if (hash === "#logout") {
    // "Wylogowanie" – resetujemy currentUser; w prawdziwej aplikacji warto by było mieć endpoint logout
    logout();
    return;
  }

  showView(viewId);
  if (viewId === "profile-view") {
    loadProfile();
  }
  if (viewId === "cars-view") {
    loadCars();
  }
}

/**
 * Ustawia nasłuchiwanie Server-Sent Events, które wyświetlają powiadomienia o zdarzeniach (np. zakupie samochodu).
 */
/**
 * Ustawia nasłuchiwanie Server-Sent Events, które wyświetlają powiadomienia o zdarzeniach (np. zakupie samochodu).
 */
function setupSSE() {
  try {
    if (evtSource) { try { evtSource.close(); } catch {} evtSource = null; }
    evtSource = new EventSource("/sse");

    evtSource.addEventListener("purchase", (event) => {
      const msg = JSON.parse(event.data);
      showNotification(`Zakup: ${msg.model} (ID: ${msg.carId}) za ${msg.price} — kupujący: ${msg.buyerId}`);
      loadCars(); checkAuth();
    });

    evtSource.addEventListener("fund", (event) => {
      const msg = JSON.parse(event.data);
      const who = msg.by === "admin" ? `admin ${msg.adminId}` : "faucet";
      showNotification(`Zasilenie (${who}): użytkownik ${msg.userId} +${msg.amount}`);
      checkAuth();
    });
  } catch {}
}


async function logout() {
  try {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
  } catch {}
  if (evtSource) {
    try {
      evtSource.close();
    } catch {}
    evtSource = null;
  }
  currentUser = null;
  renderNav();
  window.location.hash = "#login";
}

window.addEventListener("load", async () => {
  await checkAuth();
  setupEventListeners();
  setupSSE();
});
