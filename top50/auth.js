// Top 50 access gate. The credential is never stored in plaintext in the site source.
// NOTE: This is a static-site gate, so it is not a substitute for server-side authentication.
(() => {
    const CREDENTIAL_HASH = "6b6a598164709e96ffc9b6d2c0ee756eadf796cb23f42c598e6f2fc61690aea5";
    const AUTH_KEY = "lcedit_top50_admin_auth";

    async function sha256(value) {
        const data = new TextEncoder().encode(value);
        const hash = await crypto.subtle.digest("SHA-256", data);
        return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
    }

    function lockPage() {
        document.documentElement.classList.add("top50-locked");
    }

    function unlockPage() {
        document.documentElement.classList.remove("top50-locked");
    }

    function showLogin() {
        lockPage();
        const overlay = document.createElement("div");
        overlay.id = "top50-auth-overlay";
        overlay.innerHTML = `
            <div class="top50-auth-card">
                <h1>Top 50 Access</h1>
                <p>Administrator credentials are required to access Top 50.</p>
                <form id="top50-auth-form" autocomplete="off">
                    <input id="top50-username" type="text" placeholder="Admin username" autocomplete="username" required>
                    <input id="top50-password" type="password" placeholder="Admin password" autocomplete="current-password" required>
                    <button type="submit">Sign in</button>
                    <p id="top50-auth-error" role="alert"></p>
                </form>
            </div>`;
        document.body.prepend(overlay);

        document.getElementById("top50-auth-form").addEventListener("submit", async (event) => {
            event.preventDefault();
            const username = document.getElementById("top50-username").value;
            const password = document.getElementById("top50-password").value;
            const hash = await sha256(`${username}:${password}`);
            if (hash === CREDENTIAL_HASH) {
                sessionStorage.setItem(AUTH_KEY, "1");
                overlay.remove();
                unlockPage();
            } else {
                document.getElementById("top50-auth-error").textContent = "Invalid administrator credentials.";
            }
        });
    }

    function init() {
        if (sessionStorage.getItem(AUTH_KEY) === "1") {
            unlockPage();
        } else {
            showLogin();
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
