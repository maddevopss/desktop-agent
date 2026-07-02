const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginFormBtn = document.getElementById("loginFormBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusDiv = document.getElementById("status");
const reasonDiv = document.getElementById("reason");

function setLoggedInUI(active) {
  if (active) {
    statusDiv.textContent = "Agent actif — suivi en cours";
    if (loginFormBtn) loginFormBtn.disabled = true;
    emailInput.disabled = true;
    passwordInput.disabled = true;
    if (refreshBtn) refreshBtn.disabled = true;
  } else {
    statusDiv.textContent = "Agent arrêté";
    if (loginFormBtn) loginFormBtn.disabled = false;
    emailInput.disabled = false;
    passwordInput.disabled = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function setStatus(message) {
  statusDiv.textContent = message;
}

function setReason(reason) {
  if (!reasonDiv) return;
  reasonDiv.textContent = reason ? String(reason) : "—";
}

function safeFilenamePart(s) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
}

if (loginFormBtn) {
  loginFormBtn.addEventListener("click", async () => {
    try {
      setStatus("Connexion...");

      const result = await window.agentAPI.login({
        email: emailInput.value,
        password: passwordInput.value,
      });

      if (result.success) {
        setLoggedInUI(true);
        setReason("—");
        setStatus("Agent actif — suivi en cours");
      } else {
        setReason(result.message || "login failed");
        setStatus(result.message || "Erreur de connexion");
        setLoggedInUI(false);
      }
    } catch (err) {
      console.error("LOGIN ERROR:", err);
      setReason(err?.message || "login failed");
      setStatus(err.message || "Erreur de connexion");
      setLoggedInUI(false);
    }
  });
}

// NOTE: ancien handler supprimé (mise en place ci-dessus).

// Le main process demande un refresh parce que l'access token a expiré.
// Le renderer appelle /api/refresh via agentAPI, puis redonne le nouveau token au main.
window.agentAPI?.onAgentRefreshNeeded?.(async () => {
  try {
    setStatus("Session expirée — renouvellement...");
    setReason("refresh demandé par le main process");

    const result = await window.agentAPI.refreshToken();

    if (!result?.success || !result?.token) {
      throw new Error("Refresh sans nouveau token.");
    }

    setLoggedInUI(true);
    setReason("—");
    setStatus("Agent actif — session renouvelée");
  } catch (err) {
    console.error("REFRESH ERROR:", err);

    await window.agentAPI?.agentRefreshFailed?.();

    setLoggedInUI(false);
    setReason(err?.message || "refresh failed");
    setStatus("Session expirée — reconnexion requise");
  }
});

refreshBtn?.addEventListener("click", async () => {
  try {
    setStatus("Relance refresh...");
    setReason("refresh (UI)");
    const result = await window.agentAPI.refreshToken();

    if (!result?.success || !result?.token) {
      throw new Error("Refresh sans nouveau token.");
    }

    setLoggedInUI(true);
    setStatus("Agent actif — refresh OK");
    setReason("—");
  } catch (err) {
    console.error("UI REFRESH ERROR:", err);
    await window.agentAPI?.agentRefreshFailed?.();
    setLoggedInUI(false);
    setStatus("Refresh échoué — reconnexion requise");
    setReason(err?.message || "refresh failed");
  }
});

window.agentAPI?.onAgentStateChanged?.(({ state, reason }) => {
  if (!state) return;

  const prettyReason = reason ? ` — ${reason}` : "";

  if (state === "AUTH_OK") {
    setLoggedInUI(true);
    setStatus(`Agent actif${prettyReason}`);
    setReason(reason);
    return;
  }

  if (state === "AUTH_EXPIRED") {
    setLoggedInUI(false);
    window.agentAPI?.clearLocalSession?.();
    setStatus(`Session expirée${prettyReason}`);
    setReason(reason);
    return;
  }

  if (state === "STARTING") {
    setLoggedInUI(false);
    setStatus(`Démarrage / refresh${prettyReason}`);
    setReason(reason);
    return;
  }

  // OFF / default
  setLoggedInUI(false);
  setStatus(`Agent arrêté${prettyReason}`);
  setReason(reason);
});

// Le main process redonne le nouveau token après un refresh réussi.
window.agentAPI?.onAgentTokenRefreshed?.((payload) => {
  if (payload?.token) {
    setLoggedInUI(true);
    setStatus("Agent actif — session renouvelée");
    setReason("—");
  }
});

// Stop tracking si token invalide/expiré et refresh impossible.
window.agentAPI?.onAuthExpired?.(() => {
  setLoggedInUI(false);
  window.agentAPI?.clearLocalSession?.();
  setStatus("Session expirée — reconnexion requise");
  setReason("auth expired");
});

const exportDiagnosticsBtn = document.getElementById("exportDiagnosticsBtn");

exportDiagnosticsBtn?.addEventListener("click", async () => {
  try {
    setStatus("Export diagnostics...");
    const result = await window.agentAPI?.exportDiagnostics?.();
    if (result?.success) {
      setStatus(`Diagnostics exportés: ${result.file}`);
    } else {
      setStatus(result?.message || "Export diagnostics échoué");
    }
  } catch (err) {
    console.error("EXPORT DIAGNOSTICS ERROR:", err);
    setStatus(err.message || "Export diagnostics échoué");
  }
});

// Compatibilité avec ton ancien event.
window.agentAPI?.onSessionExpired?.(() => {
  setLoggedInUI(false);
  window.agentAPI?.clearLocalSession?.();
  setStatus("Session expirée — reconnexion requise");
});
